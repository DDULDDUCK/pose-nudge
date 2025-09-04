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
use parking_lot::Mutex; // std::sync::Mutex보다 효율적인 Mutex 사용
use std::collections::VecDeque;
use std::sync::Arc;
use tauri::{path::BaseDirectory, AppHandle, Manager};

// 키포인트 데이터 구조체
#[derive(Debug, Clone)]
pub struct KeyPoint {
    pub x: f32,
    pub y: f32,
    pub confidence: f32,
}

// 전체 포즈 키포인트 구조체
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

// 자세 분석기 메인 구조체
pub struct PoseAnalyzer {
    session: Arc<Mutex<Option<Session>>>,
    analysis_interval: Arc<Mutex<u64>>,
    last_analysis_time: Arc<Mutex<std::time::Instant>>,
    confidence_threshold: f32,
    recent_turtle_neck_results: Mutex<VecDeque<bool>>,
    recent_shoulder_results: Mutex<VecDeque<bool>>,
    temporal_window_size: usize,
    baseline_face_shoulder_ratio: Mutex<Option<f32>>,
    baseline_shoulder_alignment: Mutex<Option<f32>>,
    baseline_head_forward_ratio: Mutex<Option<f32>>,

    // ✨ 추가된 설정 관련 필드들
    // Mutex로 감싸서 런타임에 동적으로 변경 가능하게 함
    temporal_threshold_count: Mutex<usize>, // 알림 빈도 (3번 중 N번)
    turtle_neck_thresholds: Mutex<(f32, f32)>, // 거북목 감지 강도 (RATIO_TOLERANCE, FORWARD_TOLERANCE)
    shoulder_alignment_thresholds: Mutex<(f32, f32)>, // 어깨 정렬 감지 강도 (TOLERANCE, MIN_ABSOLUTE_THRESHOLD)
}


impl PoseAnalyzer {
    // 생성자 함수
    pub fn new() -> Self {
        const WINDOW_SIZE: usize = 3;
        // ✨ 기본값 설정: 모두 '보통' 단계
        const DEFAULT_THRESHOLD_COUNT: usize = 2; // 3번 중 2번 감지 시 알림
        const DEFAULT_TURTLE_THRESHOLDS: (f32, f32) = (0.030, 0.020);
        const DEFAULT_SHOULDER_THRESHOLDS: (f32, f32) = (0.9, 0.18);

        Self {
            session: Arc::new(Mutex::new(None)),
            analysis_interval: Arc::new(Mutex::new(3000)),
            last_analysis_time: Arc::new(Mutex::new(std::time::Instant::now())),
            confidence_threshold: 0.5,
            recent_turtle_neck_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            recent_shoulder_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            temporal_window_size: WINDOW_SIZE,
            baseline_face_shoulder_ratio: Mutex::new(None),
            baseline_shoulder_alignment: Mutex::new(None),
            baseline_head_forward_ratio: Mutex::new(None),
            
            // ✨ 추가된 필드 초기화
            temporal_threshold_count: Mutex::new(DEFAULT_THRESHOLD_COUNT),
            turtle_neck_thresholds: Mutex::new(DEFAULT_TURTLE_THRESHOLDS),
            shoulder_alignment_thresholds: Mutex::new(DEFAULT_SHOULDER_THRESHOLDS),
        }
    }

    // ✨ 추가된 함수: 알림 빈도 설정
    pub fn set_notification_frequency(&self, level: u8) {
        let count = match level {
            1 => 1, // 민감 (3번 중 1번)
            3 => 3, // 둔감 (3번 중 3번)
            _ => 2, // 보통 (3번 중 2번)
        };
        *self.temporal_threshold_count.lock() = count;
        info!("알림 빈도 설정 변경: 3번 중 {}번", count);
    }

    // ✨ 추가된 함수: 거북목 감지 강도 설정
    pub fn set_turtle_neck_sensitivity(&self, level: u8) {
        let thresholds = match level {
            1 => (0.040, 0.030), // 느슨하게 (기준치 초과 허용 범위 넓음)
            3 => (0.020, 0.015), // 엄격하게 (기준치 초과 허용 범위 좁음)
            _ => (0.030, 0.020), // 보통 (기본값)
        };
        *self.turtle_neck_thresholds.lock() = thresholds;
        info!("거북목 감지 강도 변경: level {}", level);
    }
    
    // ✨ 추가된 함수: 어깨 정렬 감지 강도 설정
    pub fn set_shoulder_sensitivity(&self, level: u8) {
        let thresholds = match level {
            1 => (1.2, 0.22),  // 느슨하게
            3 => (0.7, 0.15),  // 엄격하게
            _ => (0.9, 0.18),  // 보통 (기본값)
        };
        *self.shoulder_alignment_thresholds.lock() = thresholds;
        info!("어깨 정렬 감지 강도 변경: level {}", level);
    }

    // ONNX 모델 초기화
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

    // 리소스 폴더에서 모델 파일 경로 확인
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
        info!("YOLO11n-pose 모델 로드: {:?}", model_path);
        Ok(model_path)
    }
    
    // 모델 초기화 여부 확인
    pub fn is_model_initialized(&self) -> bool {
        self.session.lock().is_some()
    }

    // 모델 상태 테스트용 함수
    pub fn test_analysis(&self) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if self.is_model_initialized() {
            Ok(r#"{"status": "verified_yolo_model_loaded", "test": "success"}"#.to_string())
        } else {
            Ok(r#"{"status": "verified_yolo_model_not_loaded", "test": "success"}"#.to_string())
        }
    }

    // 이미지 버퍼를 분석하는 핵심 함수
    pub fn analyze_image_buffer(
        &self,
        image_buffer: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_model_initialized() {
            return Ok(serde_json::json!({
                "status": "model_not_initialized",
                "recommendations": ["AI 모델을 먼저 초기화해주세요"],
            }).to_string());
        }

        let keypoints = self.extract_pose_keypoints(image_buffer)?;
        
        let current_turtle_neck = self.detect_turtle_neck(&keypoints);
        let current_shoulder_misalignment = self.detect_shoulder_misalignment(&keypoints);
        let realtime_posture_score = self.calculate_posture_score(current_turtle_neck, current_shoulder_misalignment);

        // ✨ 수정: 설정된 알림 빈도(threshold_count)를 사용
        let threshold_count = *self.temporal_threshold_count.lock();

        let final_turtle_neck = {
            let mut history = self.recent_turtle_neck_results.lock();
            if history.len() >= self.temporal_window_size { history.pop_front(); }
            history.push_back(current_turtle_neck);
            history.iter().filter(|&&detected| detected).count() >= threshold_count
        };

        let final_shoulder_misalignment = {
            let mut history = self.recent_shoulder_results.lock();
            if history.len() >= self.temporal_window_size { history.pop_front(); }
            history.push_back(current_shoulder_misalignment);
            history.iter().filter(|&&detected| detected).count() >= threshold_count
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
    
    // Base64 이미지 데이터를 분석하는 래퍼 함수
    pub fn analyze_image_sync(
        &self,
        base64_data: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let image_data = self.decode_base64_image(base64_data)?;
        self.analyze_image_buffer(&image_data)
    }

    // Base64 문자열을 이미지 버퍼로 디코딩
    fn decode_base64_image(&self, base64_data: &str) -> Result<ImageBuffer<Rgb<u8>, Vec<u8>>, Box<dyn std::error::Error + Send + Sync>> {
        let base64_clean = if base64_data.starts_with("data:") { base64_data.split(',').nth(1).unwrap_or(base64_data) } else { base64_data };
        let decoded = general_purpose::STANDARD.decode(base64_clean)?;
        let img = image::load_from_memory(&decoded)?;
        Ok(img.to_rgb8())
    }

    // 이미지에서 포즈 키포인트 추출
    fn extract_pose_keypoints(&self, image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<PoseKeypoints, Box<dyn std::error::Error + Send + Sync>> {
        let input_tensor = self.preprocess_image(image)?;
        let mut session_guard = self.session.lock();
        let session = session_guard.as_mut().ok_or("YOLO-pose 모델이 초기화되지 않았습니다")?;
        let outputs = session.run(ort::inputs!["images" => input_tensor])?;
        self.postprocess_output(&outputs, image.width(), image.height())
    }

    // 이미지를 모델 입력 형식에 맞게 전처리
    fn preprocess_image(&self, image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
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

    // 모델 출력값을 후처리하여 키포인트 데이터로 변환
    fn postprocess_output(&self, outputs: &SessionOutputs, orig_width: u32, orig_height: u32) -> Result<PoseKeypoints, Box<dyn std::error::Error + Send + Sync>> {
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

    // 후처리된 데이터에서 특정 키포인트 정보를 추출
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

    // 주요 키포인트의 평균 신뢰도 계산
    fn calculate_average_confidence(&self, keypoints: &PoseKeypoints) -> f32 {
        let confidences = vec![ keypoints.nose.confidence, keypoints.left_shoulder.confidence, keypoints.right_shoulder.confidence, keypoints.left_ear.confidence, keypoints.right_ear.confidence, ];
        let valid_confidences: Vec<f32> = confidences.into_iter().filter(|&c| c > 0.0).collect();
        if valid_confidences.is_empty() { 0.0 } else { valid_confidences.iter().sum::<f32>() / valid_confidences.len() as f32 }
    }

    // 거북목 감지 로직
    fn detect_turtle_neck(&self, keypoints: &PoseKeypoints) -> bool {
        // ✨ 수정: 설정된 감지 강도(thresholds)를 사용
        let (ratio_tolerance, forward_tolerance) = *self.turtle_neck_thresholds.lock();
        
        let is_face_too_close = {
            if let Some(baseline_ratio) = *self.baseline_face_shoulder_ratio.lock() {
                if let Some(current_ratio) = self.calculate_face_shoulder_ratio(keypoints) {
                    current_ratio > baseline_ratio + ratio_tolerance
                } else { false }
            } else { false }
        };

        let is_head_forward = {
            if let Some(baseline_forward) = *self.baseline_head_forward_ratio.lock() {
                if let Some(current_forward) = self.calculate_head_forward_ratio(keypoints) {
                    current_forward > baseline_forward + forward_tolerance
                } else { false }
            } else {
                if let Some(current_forward) = self.calculate_head_forward_ratio(keypoints) {
                    current_forward > 0.08 // 캘리브레이션 전 기본값
                } else { false }
            }
        };
        is_face_too_close || is_head_forward
    }

    // 어깨 비대칭 감지 로직
    fn detect_shoulder_misalignment(&self, keypoints: &PoseKeypoints) -> bool {
        if keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 || keypoints.nose.confidence < 0.5 { return false; }
        
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width < 1.0 { return false; }
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        if face_height_proxy < 1.0 { return false; }
        let corrected_ratio = shoulder_height_diff / face_height_proxy;
        
        // ✨ 수정: 설정된 감지 강도(thresholds)를 사용
        let (tolerance, min_absolute_threshold) = *self.shoulder_alignment_thresholds.lock();

        if let Some(baseline_corrected_ratio) = *self.baseline_shoulder_alignment.lock() {
            let is_worse_than_baseline = corrected_ratio > baseline_corrected_ratio + tolerance;
            let is_objectively_bad = corrected_ratio > min_absolute_threshold;
            is_worse_than_baseline && is_objectively_bad
        } else {
            let original_ratio = shoulder_height_diff / shoulder_width;
            original_ratio > 0.1 && corrected_ratio > 0.15 // 캘리브레이션 전 기본값
        }
    }

    // 자세 점수 계산
    fn calculate_posture_score(&self, turtle_neck_detected: bool, shoulder_misalignment_detected: bool) -> u8 {
        let mut score = 100u8;
        if turtle_neck_detected { score = score.saturating_sub(30); }
        if shoulder_misalignment_detected { score = score.saturating_sub(20); }
        score
    }

    // 얼굴-어깨 비율 계산 (거북목 감지용)
    fn calculate_face_shoulder_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_eye.confidence < 0.5 || keypoints.right_eye.confidence < 0.5 || keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 { return None; }
        let face_width = (keypoints.right_eye.x - keypoints.left_eye.x).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 { Some(face_width / shoulder_width) } else { None }
    }

    // 기준 자세 설정 (캘리브레이션)
    pub fn set_baseline_posture(&self, base64_data: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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

    // 어깨 정렬 비율 계산 (어깨 비대칭 감지용)
    fn calculate_shoulder_alignment_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 || keypoints.nose.confidence < 0.5 { return None; }
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        if face_height_proxy > 1.0 { Some(shoulder_height_diff / face_height_proxy) } else { None }
    }

    // 머리 전방 비율 계산 (거북목 감지용)
    fn calculate_head_forward_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_ear.confidence < 0.5 || keypoints.right_ear.confidence < 0.5 || keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 { return None; }
        let ear_center_x = (keypoints.left_ear.x + keypoints.right_ear.x) / 2.0;
        let shoulder_center_x = (keypoints.left_shoulder.x + keypoints.right_shoulder.x) / 2.0;
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 { Some((ear_center_x - shoulder_center_x).abs() / shoulder_width) } else { None } // 절대값으로 변경하여 좌우 방향에 무관하게 전방 기울기만 측정
    }

    // 감지 결과에 따른 추천 메시지 생성
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