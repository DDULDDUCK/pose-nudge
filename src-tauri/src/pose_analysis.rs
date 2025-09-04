// src-tauri/src/pose_analysis.rs

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use image::{ImageBuffer, Rgb};
use log::info;
use ndarray::Array4;
use ort::{
    session::{
        builder::{GraphOptimizationLevel, SessionBuilder},
        Session, SessionOutputs,
    },
    value::Value,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct KeyPoint {
    pub x: f32,
    pub y: f32,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
pub struct PoseKeypoints {
    pub nose: KeyPoint,
    pub left_eye: KeyPoint,
    pub right_eye: KeyPoint,
    pub left_ear: KeyPoint,
    pub right_ear: KeyPoint,
    pub left_shoulder: KeyPoint,
    pub right_shoulder: KeyPoint,
    pub left_elbow: KeyPoint,
    pub right_elbow: KeyPoint,
    pub left_wrist: KeyPoint,
    pub right_wrist: KeyPoint,
    pub left_hip: KeyPoint,
    pub right_hip: KeyPoint,
    pub left_knee: KeyPoint,
    pub right_knee: KeyPoint,
    pub left_ankle: KeyPoint,
    pub right_ankle: KeyPoint,
}

pub struct PoseAnalyzer {
    session: Arc<Mutex<Option<Session>>>,
    turtle_neck_threshold: f32,
    shoulder_alignment_threshold: f32,
    analysis_interval: Arc<Mutex<u64>>,
    last_analysis_time: Arc<Mutex<std::time::Instant>>,
    confidence_threshold: f32,
    recent_turtle_neck_results: Mutex<VecDeque<bool>>,
    recent_shoulder_results: Mutex<VecDeque<bool>>,
    temporal_window_size: usize,
    temporal_threshold_count: usize,
    baseline_face_shoulder_ratio: Mutex<Option<f32>>,
    baseline_shoulder_alignment: Mutex<Option<f32>>,
    baseline_head_forward_ratio: Mutex<Option<f32>>,
}

impl PoseAnalyzer {
    pub fn new() -> Self {
        const WINDOW_SIZE: usize = 3;
        const THRESHOLD_COUNT: usize = 2;

        Self {
            session: Arc::new(Mutex::new(None)),
            turtle_neck_threshold: 0.15,
            shoulder_alignment_threshold: 0.1,
            analysis_interval: Arc::new(Mutex::new(3000)), // 고정 간격
            last_analysis_time: Arc::new(Mutex::new(std::time::Instant::now())),
            confidence_threshold: 0.5,
            recent_turtle_neck_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            recent_shoulder_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            temporal_window_size: WINDOW_SIZE,
            temporal_threshold_count: THRESHOLD_COUNT,
            baseline_face_shoulder_ratio: Mutex::new(None),
            baseline_shoulder_alignment: Mutex::new(None),
            baseline_head_forward_ratio: Mutex::new(None),
        }
    }

    pub async fn initialize_model(&self, handle: AppHandle) -> Result<()> {
        info!("YOLO-pose 모델 초기화 시작...");
        let model_path = self.download_verified_yolo_model(handle).await?;
        let session = SessionBuilder::new()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;
        *self.session.lock() = Some(session);
        info!("YOLO-pose 모델 초기화 완료");
        Ok(())
    }

    async fn download_verified_yolo_model(&self, handle: AppHandle) -> Result<std::path::PathBuf> {
        let model_path = handle
            .path()
            .resolve("../models/yolo11n-pose.onnx", BaseDirectory::Resource)
            .map_err(|e| anyhow!("모델 리소스 경로를 확인하지 못했습니다: {}", e))?;

        if !model_path.exists() {
            return Err(anyhow!(
                "yolo11n-pose.onnx 모델 파일을 찾을 수 없습니다. 경로: {:?}",
                model_path
            ));
        }

        let metadata = tokio::fs::metadata(&model_path).await?;
        if metadata.len() < 1000000 {
            return Err(anyhow!(
                "모델 파일이 손상되었거나 크기가 너무 작습니다: {} bytes",
                metadata.len()
            ));
        }

        info!(
            "YOLO11n-pose 모델 로드: {:?} ({} bytes)",
            model_path,
            metadata.len()
        );
        Ok(model_path)
    }

    pub fn should_analyze(&self) -> bool {
        let last_time = *self.last_analysis_time.lock();
        let interval = *self.analysis_interval.lock();
        last_time.elapsed().as_millis() >= interval as u128
    }

    pub fn mark_analysis_time(&self) {
        *self.last_analysis_time.lock() = std::time::Instant::now();
    }

    pub fn is_model_initialized(&self) -> bool {
        self.session.lock().is_some()
    }

    pub fn test_analysis(&self) -> Result<String, Box<dyn std::error::Error>> {
        if self.is_model_initialized() {
            Ok(r#"{"status": "verified_yolo_model_loaded", "test": "success"}"#.to_string())
        } else {
            Ok(r#"{"status": "verified_yolo_model_not_loaded", "test": "success"}"#.to_string())
        }
    }

    pub fn analyze_image_sync(
        &self,
        base64_data: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        if !self.is_model_initialized() {
            return Ok(serde_json::json!({
                "status": "model_not_initialized",
                "recommendations": ["AI 모델을 먼저 초기화해주세요"],
            }).to_string());
        }

        if !self.should_analyze() {
            return Ok(serde_json::json!({ "skip": true }).to_string());
        }

        self.mark_analysis_time();

        let image_data = self.decode_base64_image(base64_data)?;
        let keypoints = self.extract_pose_keypoints(&image_data)?;
        
        let current_turtle_neck = self.detect_turtle_neck(&keypoints);
        let current_shoulder_misalignment = self.detect_shoulder_misalignment(&keypoints);
        let realtime_posture_score = self.calculate_posture_score(current_turtle_neck, current_shoulder_misalignment);

        let final_turtle_neck = {
            let mut history = self.recent_turtle_neck_results.lock();
            if history.len() >= self.temporal_window_size { history.pop_front(); }
            history.push_back(current_turtle_neck);
            history.iter().filter(|&&detected| detected).count() >= self.temporal_threshold_count
        };

        let final_shoulder_misalignment = {
            let mut history = self.recent_shoulder_results.lock();
            if history.len() >= self.temporal_window_size { history.pop_front(); }
            history.push_back(current_shoulder_misalignment);
            history.iter().filter(|&&detected| detected).count() >= self.temporal_threshold_count
        };

        let recommendations = self.generate_recommendations(final_turtle_neck, final_shoulder_misalignment);
        let avg_confidence = self.calculate_average_confidence(&keypoints);

        let result = serde_json::json!({
            "turtle_neck": final_turtle_neck,
            "shoulder_misalignment": final_shoulder_misalignment,
            "posture_score": realtime_posture_score,
            "recommendations": recommendations,
            "confidence": avg_confidence,
            "status": "yolo_analysis_success"
        });

        Ok(result.to_string())
    }
    
    // ... (이하 나머지 함수들은 이전과 동일하게 유지됩니다) ...
    fn decode_base64_image(&self, base64_data: &str) -> Result<ImageBuffer<Rgb<u8>, Vec<u8>>, Box<dyn std::error::Error>> {
        let base64_clean = if base64_data.starts_with("data:") { base64_data.split(',').nth(1).unwrap_or(base64_data) } else { base64_data };
        let decoded = general_purpose::STANDARD.decode(base64_clean)?;
        let img = image::load_from_memory(&decoded)?;
        Ok(img.to_rgb8())
    }

    fn extract_pose_keypoints(&self, image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<PoseKeypoints, Box<dyn std::error::Error>> {
        let input_tensor = self.preprocess_image(image)?;
        let mut session_guard = self.session.lock();
        let session = session_guard.as_mut().ok_or("YOLO-pose 모델이 초기화되지 않았습니다")?;
        let outputs = session.run(ort::inputs!["images" => input_tensor])?;
        self.postprocess_output(&outputs, image.width(), image.height())
    }

    fn preprocess_image(&self, image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<Value, Box<dyn std::error::Error>> {
        let resized_image = image::imageops::resize(image, 640, 640, image::imageops::FilterType::Triangle);
        let mut input_data = Vec::with_capacity(3 * 640 * 640);
        for channel in 0..3 {
            for pixel in resized_image.pixels() {
                input_data.push(pixel.0[channel] as f32 / 255.0);
            }
        }
        let input_array = Array4::from_shape_vec((1, 3, 640, 640), input_data)?;
        Ok(Value::from_array(input_array)?.into())
    }

    fn postprocess_output(&self, outputs: &SessionOutputs, orig_width: u32, orig_height: u32) -> Result<PoseKeypoints, Box<dyn std::error::Error>> {
        let output = outputs.get("output0").ok_or("모델 출력을 찾을 수 없습니다")?;
        let (shape, data) = output.try_extract_tensor::<f32>()?;
        if shape.len() != 3 || shape[1] != 56 { return Err("예상하지 못한 모델 출력 형식입니다".into()); }
        let detections = shape[2] as usize;
        let mut best_detection = None;
        let mut best_confidence = 0.0f32;
        for i in 0..detections {
            let confidence_idx = 4 * detections + i;
            let confidence = data[confidence_idx];
            if confidence > best_confidence && confidence > self.confidence_threshold {
                best_confidence = confidence;
                best_detection = Some(i);
            }
        }
        let detection_idx = best_detection.ok_or("신뢰할 수 있는 pose detection을 찾을 수 없습니다")?;
        let scale_x = orig_width as f32 / 640.0;
        let scale_y = orig_height as f32 / 640.0;
        let keypoints = PoseKeypoints {
            nose: self.extract_keypoint_from_data(data, shape, detection_idx, 0, scale_x, scale_y),
            left_eye: self.extract_keypoint_from_data(data, shape, detection_idx, 1, scale_x, scale_y),
            right_eye: self.extract_keypoint_from_data(data, shape, detection_idx, 2, scale_x, scale_y),
            left_ear: self.extract_keypoint_from_data(data, shape, detection_idx, 3, scale_x, scale_y),
            right_ear: self.extract_keypoint_from_data(data, shape, detection_idx, 4, scale_x, scale_y),
            left_shoulder: self.extract_keypoint_from_data(data, shape, detection_idx, 5, scale_x, scale_y),
            right_shoulder: self.extract_keypoint_from_data(data, shape, detection_idx, 6, scale_x, scale_y),
            left_elbow: self.extract_keypoint_from_data(data, shape, detection_idx, 7, scale_x, scale_y),
            right_elbow: self.extract_keypoint_from_data(data, shape, detection_idx, 8, scale_x, scale_y),
            left_wrist: self.extract_keypoint_from_data(data, shape, detection_idx, 9, scale_x, scale_y),
            right_wrist: self.extract_keypoint_from_data(data, shape, detection_idx, 10, scale_x, scale_y),
            left_hip: self.extract_keypoint_from_data(data, shape, detection_idx, 11, scale_x, scale_y),
            right_hip: self.extract_keypoint_from_data(data, shape, detection_idx, 12, scale_x, scale_y),
            left_knee: self.extract_keypoint_from_data(data, shape, detection_idx, 13, scale_x, scale_y),
            right_knee: self.extract_keypoint_from_data(data, shape, detection_idx, 14, scale_x, scale_y),
            left_ankle: self.extract_keypoint_from_data(data, shape, detection_idx, 15, scale_x, scale_y),
            right_ankle: self.extract_keypoint_from_data(data, shape, detection_idx, 16, scale_x, scale_y),
        };
        Ok(keypoints)
    }

    fn extract_keypoint_from_data(&self, data: &[f32], shape: &ort::tensor::Shape, detection_idx: usize, keypoint_idx: usize, scale_x: f32, scale_y: f32) -> KeyPoint {
        let detections = shape[2] as usize;
        let base_feature_idx = 5 + keypoint_idx * 3;
        let x_idx = base_feature_idx * detections + detection_idx;
        let y_idx = (base_feature_idx + 1) * detections + detection_idx;
        let conf_idx = (base_feature_idx + 2) * detections + detection_idx;
        let x = data.get(x_idx).unwrap_or(&0.0) * scale_x;
        let y = data.get(y_idx).unwrap_or(&0.0) * scale_y;
        let confidence = *data.get(conf_idx).unwrap_or(&0.0);
        KeyPoint { x, y, confidence }
    }

    fn calculate_average_confidence(&self, keypoints: &PoseKeypoints) -> f32 {
        let confidences = vec![ keypoints.nose.confidence, keypoints.left_shoulder.confidence, keypoints.right_shoulder.confidence, keypoints.left_ear.confidence, keypoints.right_ear.confidence, ];
        let valid_confidences: Vec<f32> = confidences.into_iter().filter(|&c| c > 0.0).collect();
        if valid_confidences.is_empty() { 0.0 } else { valid_confidences.iter().sum::<f32>() / valid_confidences.len() as f32 }
    }

    fn detect_turtle_neck(&self, keypoints: &PoseKeypoints) -> bool {
        let is_face_too_close = {
            if let Some(baseline_ratio) = *self.baseline_face_shoulder_ratio.lock() {
                if let Some(current_ratio) = self.calculate_face_shoulder_ratio(keypoints) {
                    const RATIO_TOLERANCE: f32 = 0.030;
                    current_ratio > baseline_ratio + RATIO_TOLERANCE
                } else { false }
            } else { false }
        };
        let is_head_forward = {
            if let Some(baseline_forward) = *self.baseline_head_forward_ratio.lock() {
                if let Some(current_forward) = self.calculate_head_forward_ratio(keypoints) {
                    const FORWARD_TOLERANCE: f32 = 0.020;
                    current_forward > baseline_forward + FORWARD_TOLERANCE
                } else { false }
            } else {
                if let Some(current_forward) = self.calculate_head_forward_ratio(keypoints) {
                    current_forward > 0.08
                } else { false }
            }
        };
        is_face_too_close || is_head_forward
    }

    fn detect_shoulder_misalignment(&self, keypoints: &PoseKeypoints) -> bool {
        if keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 || keypoints.nose.confidence < 0.5 { return false; }
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width < 1.0 { return false; }
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        if face_height_proxy < 1.0 { return false; }
        let corrected_ratio = shoulder_height_diff / face_height_proxy;
        if let Some(baseline_corrected_ratio) = *self.baseline_shoulder_alignment.lock() {
            const TOLERANCE: f32 = 0.9;
            const MIN_ABSOLUTE_THRESHOLD: f32 = 0.18;
            let is_worse_than_baseline = corrected_ratio > baseline_corrected_ratio + TOLERANCE;
            let is_objectively_bad = corrected_ratio > MIN_ABSOLUTE_THRESHOLD;
            is_worse_than_baseline && is_objectively_bad
        } else {
            let original_ratio = shoulder_height_diff / shoulder_width;
            original_ratio > 0.1 && corrected_ratio > 0.15
        }
    }

    fn calculate_posture_score(&self, turtle_neck_detected: bool, shoulder_misalignment_detected: bool) -> u8 {
        let mut score = 100u8;
        if turtle_neck_detected { score = score.saturating_sub(30); }
        if shoulder_misalignment_detected { score = score.saturating_sub(20); }
        score
    }

    fn calculate_face_shoulder_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_eye.confidence < 0.5 || keypoints.right_eye.confidence < 0.5 || keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 { return None; }
        let face_width = (keypoints.right_eye.x - keypoints.left_eye.x).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 { Some(face_width / shoulder_width) } else { None }
    }

    pub fn set_baseline_posture(&self, base64_data: &str) -> Result<(), Box<dyn std::error::Error>> {
        let image_data = self.decode_base64_image(base64_data)?;
        let keypoints = self.extract_pose_keypoints(&image_data)?;

        if let Some(ratio) = self.calculate_face_shoulder_ratio(&keypoints) { *self.baseline_face_shoulder_ratio.lock() = Some(ratio); }
        if let Some(shoulder_alignment) = self.calculate_shoulder_alignment_ratio(&keypoints) { *self.baseline_shoulder_alignment.lock() = Some(shoulder_alignment); }
        if let Some(forward_ratio) = self.calculate_head_forward_ratio(&keypoints) { *self.baseline_head_forward_ratio.lock() = Some(forward_ratio); }

        if self.baseline_face_shoulder_ratio.lock().is_some() || self.baseline_shoulder_alignment.lock().is_some() || self.baseline_head_forward_ratio.lock().is_some() {
            Ok(())
        } else {
            Err("기준 자세를 설정하기 위한 키포인트를 감지하지 못했습니다.".into())
        }
    }

    fn calculate_shoulder_alignment_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 || keypoints.nose.confidence < 0.5 { return None; }
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        if face_height_proxy > 1.0 { Some(shoulder_height_diff / face_height_proxy) } else { None }
    }

    fn calculate_head_forward_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_ear.confidence < 0.5 || keypoints.right_ear.confidence < 0.5 || keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 { return None; }
        let ear_center_x = (keypoints.left_ear.x + keypoints.right_ear.x) / 2.0;
        let shoulder_center_x = (keypoints.left_shoulder.x + keypoints.right_shoulder.x) / 2.0;
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 { Some((ear_center_x - shoulder_center_x) / shoulder_width) } else { None }
    }

    fn generate_recommendations(&self, turtle_neck: bool, shoulder_misalignment: bool) -> Vec<String> {
        let mut recommendations = Vec::new();
        if turtle_neck {
            recommendations.push("목을 곧게 펴고 턱을 당기세요".to_string());
            recommendations.push("모니터 높이를 눈높이에 맞춰주세요".to_string());
        }
        if shoulder_misalignment {
            recommendations.push("어깨를 수평으로 맞춰주세요".to_string());
            recommendations.push("등받이에 등을 완전히 기대주세요".to_string());
        }
        if recommendations.is_empty() {
            recommendations.push("좋은 자세를 유지하고 있습니다!".to_string());
        }
        recommendations
    }
}