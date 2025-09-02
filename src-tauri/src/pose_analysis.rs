use base64::{Engine as _, engine::general_purpose};
use image::{ImageBuffer, Rgb};
use std::collections::HashMap;
use std::sync::Arc;
use ort::{
    session::{Session, SessionOutputs, builder::{GraphOptimizationLevel, SessionBuilder}},
    value::Value,
};
use ndarray::{Array4};
use anyhow::{Result, anyhow};
use parking_lot::Mutex;
use log::info;
use std::collections::VecDeque;

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
    // --- 기존 필드 ---
    session: Arc<Mutex<Option<Session>>>,
    turtle_neck_threshold: f32,
    shoulder_alignment_threshold: f32,
    analysis_interval: Arc<Mutex<u64>>,
    last_analysis_time: Arc<Mutex<std::time::Instant>>,
    adaptive_mode: Arc<Mutex<bool>>,
    background_monitoring: Arc<Mutex<bool>>,
    confidence_threshold: f32,

    // --- 새로 추가된 필드 ---
    // Mutex로 감싸서 스레드 안전하게 만듭니다.
    recent_turtle_neck_results: Mutex<VecDeque<bool>>,
    recent_shoulder_results: Mutex<VecDeque<bool>>,
    temporal_window_size: usize, // 몇 개의 프레임을 기준으로 판단할지
    temporal_threshold_count: usize, // window_size 중 몇 개 이상일 때 true로 판단할지
    baseline_face_shoulder_ratio: Mutex<Option<f32>>,
    baseline_shoulder_alignment: Mutex<Option<f32>>, // 기준 어깨 기울기
}

impl PoseAnalyzer {
    pub fn new() -> Self {
        const WINDOW_SIZE: usize = 3; // 최근 3개 프레임
        const THRESHOLD_COUNT: usize = 2; // 그 중 2개 이상 감지되면 최종 판정

        Self {
            // --- 기존 초기화 ---
            session: Arc::new(Mutex::new(None)),
            turtle_neck_threshold: 0.15,
            shoulder_alignment_threshold: 0.1,
            analysis_interval: Arc::new(Mutex::new(3000)),
            last_analysis_time: Arc::new(Mutex::new(std::time::Instant::now())),
            adaptive_mode: Arc::new(Mutex::new(true)),
            background_monitoring: Arc::new(Mutex::new(false)),
            confidence_threshold: 0.5,

            // --- 새로 추가된 필드 초기화 ---
            recent_turtle_neck_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            recent_shoulder_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            temporal_window_size: WINDOW_SIZE,
            temporal_threshold_count: THRESHOLD_COUNT,
            baseline_face_shoulder_ratio: Mutex::new(None),
            baseline_shoulder_alignment: Mutex::new(None),
        }
    }

    // YOLO-pose 모델 초기화
    pub async fn initialize_model(&self) -> Result<()> {
        info!("YOLO-pose 모델 초기화 시작...");
        
        // 실제 검증된 YOLO-pose ONNX 모델 다운로드 및 로드
        let model_path = self.download_verified_yolo_model().await?;
        
        let session = SessionBuilder::new()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;
            
        *self.session.lock() = Some(session);
        info!("YOLO-pose 모델 초기화 완료");
        Ok(())
    }

    // 프로젝트 내 YOLO-pose 모델 로드
    async fn download_verified_yolo_model(&self) -> Result<std::path::PathBuf> {
        // 프로젝트 루트/models/ 폴더에서 모델 찾기
        let current_dir = std::env::current_dir()?;
        // src-tauri에서 실행되므로 상위 디렉토리로 이동
        let project_root = current_dir.parent().unwrap_or(&current_dir);
        let model_path = project_root.join("models").join("yolo11n-pose.onnx");
        
        if !model_path.exists() {
            return Err(anyhow!(
                "YOLO11n-pose.onnx 모델 파일을 찾을 수 없습니다.\n\
                다음 경로에 yolo11n-pose.onnx 파일을 넣어주세요: {:?}\n\
                \n\
                모델 다운로드 방법:\n\
                1. https://github.com/ultralytics/assets/releases 에서 yolo11n-pose.onnx 다운로드\n\
                2. 또는 Ultralytics YOLO 공식 사이트에서 다운로드\n\
                3. 다운로드한 파일을 models/ 폴더에 넣기",
                model_path
            ));
        }
        
        // 파일 크기 검증
        let metadata = tokio::fs::metadata(&model_path).await?;
        if metadata.len() < 1000000 { // 1MB 미만이면 손상된 파일
            return Err(anyhow!(
                "모델 파일이 손상되었거나 크기가 너무 작습니다: {} bytes\n\
                올바른 yolo11n-pose.onnx 파일을 다시 다운로드하여 넣어주세요.",
                metadata.len()
            ));
        }
        
        info!("YOLO11n-pose 모델 로드: {:?} ({} bytes)", model_path, metadata.len());
        Ok(model_path)
    }

    // 전력 절약 모드 설정
    pub fn set_adaptive_mode(&self, enabled: bool) {
        *self.adaptive_mode.lock() = enabled;
        if enabled {
            info!("적응형 전력 절약 모드 활성화");
        } else {
            info!("적응형 전력 절약 모드 비활성화");
        }
    }

    // 백그라운드 모니터링 설정
    pub fn set_background_monitoring(&self, enabled: bool) {
        *self.background_monitoring.lock() = enabled;
        if enabled {
            info!("백그라운드 모니터링 활성화");
            // 백그라운드에서는 분석 간격을 늘림
            *self.analysis_interval.lock() = 10000; // 10초
        } else {
            info!("백그라운드 모니터링 비활성화");
            *self.analysis_interval.lock() = 3000; // 3초
        }
    }

    // 분석 간격 동적 조정
    fn adjust_analysis_interval(&self, posture_score: u8) {
        if !*self.adaptive_mode.lock() {
            return;
        }

        let mut interval = self.analysis_interval.lock();
        
        if posture_score >= 80 {
            // 좋은 자세일 때는 간격을 늘림 (전력 절약)
            *interval = (*interval).min(8000).max(5000);
        } else if posture_score < 60 {
            // 나쁜 자세일 때는 간격을 줄임 (빠른 피드백)
            *interval = (*interval).max(2000).min(3000);
        } else {
            // 보통 자세일 때는 기본 간격
            *interval = 3000;
        }
    }

    // 분석 주기 확인
    pub fn should_analyze(&self) -> bool {
        // 적응형 모드가 비활성화되어 있으면 항상 분석을 허용합니다.
        if !*self.adaptive_mode.lock() {
            return true;
        }
        
        let last_time = *self.last_analysis_time.lock();
        let interval = *self.analysis_interval.lock();
        
        // 마지막 분석 시간으로부터 설정된 간격이 지났는지 확인합니다.
        last_time.elapsed().as_millis() >= interval as u128
    }

    pub fn mark_analysis_time(&self) {
        *self.last_analysis_time.lock() = std::time::Instant::now();
    }

    // 모델 초기화 상태 확인
    pub fn is_model_initialized(&self) -> bool {
        let session_guard = self.session.lock();
        session_guard.is_some()
    }
    
    // 테스트용 더미 분석 (모델 없이도 동작)
    pub fn test_analysis(&self) -> Result<String, Box<dyn std::error::Error>> {
        if self.is_model_initialized() {
            Ok(r#"{"status": "verified_yolo_model_loaded", "test": "success", "model_type": "onnx", "turtle_neck": false, "shoulder_misalignment": false}"#.to_string())
        } else {
            Ok(r#"{"status": "verified_yolo_model_not_loaded", "test": "success", "model_type": "onnx", "turtle_neck": false, "shoulder_misalignment": false}"#.to_string())
        }
    }

    pub async fn analyze_base64_image(&self, base64_data: &str) -> Result<String, Box<dyn std::error::Error>> {
        // Base64 이미지 디코딩
        let image_data = self.decode_base64_image(base64_data)?;
        
        // 간단한 자세 분석 (실제로는 더 복잡한 ML 모델 사용)
        let keypoints = self.extract_pose_keypoints(&image_data)?;
        let analysis_result = self.analyze_posture(&keypoints);
        
        Ok(serde_json::to_string(&analysis_result)?)
    }

    pub fn analyze_image_sync(&self, base64_data: &str) -> Result<String, Box<dyn std::error::Error>> {
        // 모델이 초기화되었는지 확인
        if !self.is_model_initialized() {
            return Ok(serde_json::json!({
                "turtle_neck": false,
                "shoulder_misalignment": false,
                "posture_score": 75,
                "recommendations": ["AI 모델을 먼저 초기화해주세요"],
                "confidence": 0.0,
                "status": "model_not_initialized"
            }).to_string());
        }

        // 분석 주기 확인 (전력 절약을 위해)
        if !self.should_analyze() {
            return Ok(serde_json::json!({
                "skip": true
            }).to_string());
        }
        
        self.mark_analysis_time();
        
        let image_data = self.decode_base64_image(base64_data)?;
        let keypoints = self.extract_pose_keypoints(&image_data)?;
        
            // 1. "현재 프레임"의 자세를 실시간으로 분석합니다.
        let current_turtle_neck = self.detect_turtle_neck(&keypoints);
        let current_shoulder_misalignment = self.detect_shoulder_misalignment(&keypoints);

        // 2. 이 "실시간" 결과를 사용하여 "실시간 점수"를 계산합니다.
        let realtime_posture_score = self.calculate_posture_score(current_turtle_neck, current_shoulder_misalignment);
        
        // 3. "시간적 안정성"을 적용하여 최종 판정을 내립니다 (알림용).
        let final_turtle_neck = {
            let mut history = self.recent_turtle_neck_results.lock();
            if history.len() >= self.temporal_window_size {
                history.pop_front();
            }
            history.push_back(current_turtle_neck); // 실시간 결과를 히스토리에 추가
            history.iter().filter(|&&detected| detected).count() >= self.temporal_threshold_count
        };

        let final_shoulder_misalignment = {
            let mut history = self.recent_shoulder_results.lock();
            if history.len() >= self.temporal_window_size {
                history.pop_front();
            }
            history.push_back(current_shoulder_misalignment); // 실시간 결과를 히스토리에 추가
            history.iter().filter(|&&detected| detected).count() >= self.temporal_threshold_count
        };
        
        // 4. "최종 판정" 결과를 사용하여 권장사항(알림 메시지)을 생성합니다.
        let recommendations = self.generate_recommendations(final_turtle_neck, final_shoulder_misalignment);
        
        // 기타 정보 계산
        let avg_confidence = self.calculate_average_confidence(&keypoints);
        self.adjust_analysis_interval(realtime_posture_score); // 적응형 절전은 실시간 점수 기준

        // 5. 프론트엔드에 "실시간 점수"와 "최종 판정"을 모두 전달합니다.
        // turtle_neck -> final_turtle_neck (최종 판정)
        // posture_score -> realtime_posture_score (실시간 점수)
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

    fn decode_base64_image(&self, base64_data: &str) -> Result<ImageBuffer<Rgb<u8>, Vec<u8>>, Box<dyn std::error::Error>> {
        // "data:image/jpeg;base64," 접두사 제거
        let base64_clean = if base64_data.starts_with("data:") {
            base64_data.split(',').nth(1).unwrap_or(base64_data)
        } else {
            base64_data
        };

        let decoded = general_purpose::STANDARD.decode(base64_clean)?;
        let img = image::load_from_memory(&decoded)?;
        Ok(img.to_rgb8())
    }

    fn extract_pose_keypoints(&self, image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<PoseKeypoints, Box<dyn std::error::Error>> {
        // 이미지 전처리
        let input_tensor = self.preprocess_image(image)?;
        
        // YOLO-pose 모델 실행
        // Mutex Lock을 여기서 한 번만, 그리고 변경 가능하게(mutable) 획득합니다.
        let mut session_guard = self.session.lock(); 
        let session = session_guard.as_mut()
            .ok_or("YOLO-pose 모델이 초기화되지 않았습니다")?;
            
        // 획득한 session을 사용하여 모델을 실행합니다.
        let outputs = session.run(ort::inputs!["images" => input_tensor])?;
        
        // 출력 후처리
        let keypoints = self.postprocess_output(&outputs, image.width(), image.height())?;
        
        Ok(keypoints)
    }

    // 이미지 전처리 (YOLO 입력 형식으로)
    fn preprocess_image(&self, image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<Value, Box<dyn std::error::Error>> {
        let (_width, _height) = (image.width(), image.height());
        
        // 640x640으로 리사이즈 (YOLO 표준 입력 크기)
        let resized_image = image::imageops::resize(
            image,
            640,
            640,
            image::imageops::FilterType::Triangle
        );
        
        // RGB 픽셀을 [0, 1] 범위로 정규화하고 CHW 형식으로 변환
        let mut input_data = Vec::with_capacity(3 * 640 * 640);
        
        // R, G, B 채널 순서로 데이터 배치
        for channel in 0..3 {
            for pixel in resized_image.pixels() {
                let value = pixel.0[channel] as f32 / 255.0;
                input_data.push(value);
            }
        }
        
        let input_array = Array4::from_shape_vec((1, 3, 640, 640), input_data)?;
        Ok(Value::from_array(input_array)?.into())
    }

    // YOLO 출력 후처리 (새로운 ort API 사용)
    fn postprocess_output(
        &self,
        outputs: &SessionOutputs,
        orig_width: u32,
        orig_height: u32
    ) -> Result<PoseKeypoints, Box<dyn std::error::Error>> {
        let output = outputs.get("output0")
            .ok_or("모델 출력을 찾을 수 없습니다")?;
        
        // 새로운 ort API에서는 tensor 데이터에 직접 접근
        let (shape, data) = output.try_extract_tensor::<f32>()?;
        
        // YOLOv8-pose 출력 형식: [batch, 56, detections]
        // 56 = 4 (bbox) + 1 (confidence) + 51 (17 keypoints * 3)
        if shape.len() != 3 || shape[1] != 56 {
            return Err("예상하지 못한 모델 출력 형식입니다".into());
        }
        
        let detections = shape[2] as usize;
        let mut best_detection = None;
        let mut best_confidence = 0.0f32;
        
        // 가장 높은 confidence를 가진 detection 찾기
        for i in 0..detections {
            let confidence_idx = 4 * detections + i; // [batch=0, confidence=4, detection=i]
            let confidence = data[confidence_idx];
            
            if confidence > best_confidence && confidence > self.confidence_threshold {
                best_confidence = confidence;
                best_detection = Some(i);
            }
        }
        
        let detection_idx = best_detection
            .ok_or("신뢰할 수 있는 pose detection을 찾을 수 없습니다")?;
        
        // 키포인트 추출 및 좌표 변환
        let scale_x = orig_width as f32 / 640.0;
        let scale_y = orig_height as f32 / 640.0;
        
        // COCO 17 keypoints 순서에 따라 추출
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

    // 개별 키포인트 추출 (새로운 데이터 형식)
    fn extract_keypoint_from_data(
        &self,
        data: &[f32],
        shape: &ort::tensor::Shape,
        detection_idx: usize,
        keypoint_idx: usize,
        scale_x: f32,
        scale_y: f32,
    ) -> KeyPoint {
        let detections = shape[2] as usize;
        let base_feature_idx = 5 + keypoint_idx * 3; // bbox(4) + conf(1) + keypoints
        
        // 3D tensor [batch, features, detections]에서 인덱스 계산
        let x_idx = base_feature_idx * detections + detection_idx;
        let y_idx = (base_feature_idx + 1) * detections + detection_idx;
        let conf_idx = (base_feature_idx + 2) * detections + detection_idx;
        
        let x = data.get(x_idx).unwrap_or(&0.0) * scale_x;
        let y = data.get(y_idx).unwrap_or(&0.0) * scale_y;
        let confidence = *data.get(conf_idx).unwrap_or(&0.0);
        
        KeyPoint { x, y, confidence }
    }

    fn analyze_posture(&self, keypoints: &PoseKeypoints) -> HashMap<String, serde_json::Value> {
        let mut results = HashMap::new();
        
        // (시간적 안정성 로직이 적용되었다고 가정)
        // 여기서는 간단하게 현재 프레임의 결과를 사용합니다.
        // 실제로는 final_turtle_neck, final_shoulder_misalignment 값을
        // 이 함수로 전달받거나 이 함수 내에서 계산해야 합니다.
        let turtle_neck_detected = self.detect_turtle_neck(keypoints);
        let shoulder_misalignment = self.detect_shoulder_misalignment(keypoints);

        // ★★★★★ 수정된 호출 방식 ★★★★★
        // 위에서 계산한 bool 타입의 결과 변수들을 전달합니다.
        let posture_score = self.calculate_posture_score(turtle_neck_detected, shoulder_misalignment);
        results.insert("posture_score".to_string(), serde_json::Value::Number(serde_json::Number::from(posture_score)));
        
        // 키포인트 신뢰도 검사
        let avg_confidence = self.calculate_average_confidence(keypoints);
        results.insert("confidence".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(avg_confidence as f64).unwrap_or(serde_json::Number::from(0))));
        
        // 권장사항
        let recommendations = self.generate_recommendations(turtle_neck_detected, shoulder_misalignment);
        results.insert("recommendations".to_string(), serde_json::Value::Array(recommendations));
        
        // 분석 간격 동적 조정
        self.adjust_analysis_interval(posture_score);
        
        results
    }

    // 평균 키포인트 신뢰도 계산
    fn calculate_average_confidence(&self, keypoints: &PoseKeypoints) -> f32 {
        let confidences = vec![
            keypoints.nose.confidence,
            keypoints.left_shoulder.confidence,
            keypoints.right_shoulder.confidence,
            keypoints.left_ear.confidence,
            keypoints.right_ear.confidence,
        ];
        
        let valid_confidences: Vec<f32> = confidences.into_iter()
            .filter(|&c| c > 0.0)
            .collect();
            
        if valid_confidences.is_empty() {
            0.0
        } else {
            valid_confidences.iter().sum::<f32>() / valid_confidences.len() as f32
        }
    }

    fn detect_turtle_neck(&self, keypoints: &PoseKeypoints) -> bool {
        // -----------------------------------------------------------------
        // 조건 1: 머리가 어깨선보다 앞으로 쏠렸는지 확인 (기존 로직 개선판)
        // -----------------------------------------------------------------
        let is_head_forward = {
            // 판단에 필요한 주요 키포인트들의 신뢰도 확인
            if keypoints.left_ear.confidence < 0.5 || keypoints.right_ear.confidence < 0.5 ||
            keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 {
                // 신뢰도가 낮으면 판단 불가, false 반환
                false
            } else {
                // 귀의 중심 x좌표와 어깨의 중심 x좌표를 계산
                let ear_center_x = (keypoints.left_ear.x + keypoints.right_ear.x) / 2.0;
                let shoulder_center_x = (keypoints.left_shoulder.x + keypoints.right_shoulder.x) / 2.0;
                
                // 어깨 너비를 기준으로 정규화(Normalization)하여 거리 왜곡을 줄임
                let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();

                // 어깨 너비가 유효한 경우에만 계산 (0으로 나누기 방지)
                if shoulder_width > 1.0 {
                    // (귀 중심 - 어깨 중심)의 수평 거리를 어깨 너비로 나눔
                    // 이 값이 양수이고 특정 임계값보다 크면 머리가 앞으로 쏠린 것으로 판단
                    let forward_ratio = (ear_center_x - shoulder_center_x) / shoulder_width;
                    
                    // 임계값 (예: 0.05). 이 값은 실험을 통해 조정이 필요할 수 있습니다.
                    // 정면 자세에서 귀는 어깨보다 약간 뒤에 있으므로, 이 비율이 양수가 되는 것 자체가
                    // 머리가 상당히 앞으로 나왔다는 신호일 수 있습니다.
                    forward_ratio > 0.05
                } else {
                    // 어깨 너비가 유효하지 않으면 판단 불가
                    false
                }
            }
        };

        // -----------------------------------------------------------------
        // 조건 2: 얼굴이 기준 자세보다 카메라에 가까워졌는지 확인 (새로운 비율 로직)
        // -----------------------------------------------------------------
        let is_face_too_close = {
            // 저장된 기준 비율 값을 가져옴
            let baseline_ratio_opt = *self.baseline_face_shoulder_ratio.lock();

            // baseline_ratio_opt가 Some(값)일 경우, 즉 기준값이 설정된 경우에만 로직 실행
            if let Some(baseline_ratio) = baseline_ratio_opt {
                // 현재 프레임의 얼굴-어깨 비율을 계산
                if let Some(current_ratio) = self.calculate_face_shoulder_ratio(keypoints) {
                    // 현재 비율이 기준 비율보다 20% 이상 크면 얼굴이 가까워진 것으로 판단
                    // (예: 기준이 0.5일 때, 현재가 0.6 이상이면 true)
                    current_ratio > baseline_ratio * 1.2
                } else {
                    // 현재 비율을 계산할 수 없으면, 이 조건은 통과하지 못한 것으로 간주
                    false
                }
            } else {
                // 기준값이 아직 설정되지 않았다면, 이 검사는 항상 통과시킴(true).
                // 이렇게 해야 캘리브레이션 전에도 기존 로직(is_head_forward)만으로도
                // 최소한의 거북목 감지가 가능합니다.
                // 만약 캘리브레이션을 필수로 하려면 false로 바꾸면 됩니다.
                true 
            }
        };

        // -----------------------------------------------------------------
        // 최종 판단: 두 조건 중 하나라도 만족하면 거북목으로 판단
        // 더 엄격하게 하려면 `&&` (AND) 연산자를 사용하세요.
        // 여기서는 `||` (OR)를 사용하여 둘 중 하나의 현상이라도 감지되면 알려주도록 합니다.
        // -----------------------------------------------------------------
        is_head_forward || is_face_too_close
    }

    fn detect_shoulder_misalignment(&self, keypoints: &PoseKeypoints) -> bool {
        if keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 ||
        keypoints.nose.confidence < 0.5 {
            return false;
        }
        
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();

        if shoulder_width < 1.0 {
            return false;
        }
        
        // 어깨-코의 평균 수직 거리를 계산하여 원근감 보정 요소로 사용
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        
        if face_height_proxy < 1.0 {
            return false;
        }

        // 보정된 비율: (어깨 높이 차이 / 얼굴 세로 길이)
        let corrected_ratio = shoulder_height_diff / face_height_proxy;
        
        // 기존 비율과 보정된 비율을 조합하여 사용
        let original_ratio = shoulder_height_diff / shoulder_width;
        
        // -----------------------------------------------------------------
        // 저장된 기준 어깨 정렬을 기반으로 한 개인화된 판단
        // -----------------------------------------------------------------
        let baseline_alignment_opt = *self.baseline_shoulder_alignment.lock();
        
        if let Some(baseline_corrected_ratio) = baseline_alignment_opt {
            // 기준 자세가 설정된 경우, 기준값 대비 변화량으로 판단
            // 현재 비율이 기준 비율보다 50% 이상 증가하면 불량으로 판단
            corrected_ratio > baseline_corrected_ratio * 1.5
        } else {
            // 기준 자세가 설정되지 않은 경우, 기존 절대적 임계값 사용
            original_ratio > 0.1 && corrected_ratio > 0.15
        }
    }

    fn calculate_posture_score(&self, turtle_neck_detected: bool, shoulder_misalignment_detected: bool) -> u8 {
        let mut score = 100u8;
        if turtle_neck_detected {
            score = score.saturating_sub(30);
        }
        if shoulder_misalignment_detected {
            score = score.saturating_sub(20);
        }
        score
    }

    // 얼굴과 어깨 크기 비율을 계산하는 헬퍼 함수
    fn calculate_face_shoulder_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_eye.confidence < 0.5 || keypoints.right_eye.confidence < 0.5 ||
           keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 {
            return None;
        }

        let face_width = (keypoints.right_eye.x - keypoints.left_eye.x).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();

        if shoulder_width > 1.0 {
            Some(face_width / shoulder_width)
        } else {
            None
        }
    }

    pub fn set_baseline_posture(&self, base64_data: &str) -> Result<(), Box<dyn std::error::Error>> {
        let image_data = self.decode_base64_image(base64_data)?;
        let keypoints = self.extract_pose_keypoints(&image_data)?;
        
        // 얼굴-어깨 비율 저장 (거북목 감지용)
        if let Some(ratio) = self.calculate_face_shoulder_ratio(&keypoints) {
            let mut baseline_ratio = self.baseline_face_shoulder_ratio.lock();
            *baseline_ratio = Some(ratio);
            info!("새로운 기준 자세 비율 설정됨: {}", ratio);
        }
        
        // 어깨 정렬 기준값 저장 (어깨 기울기 감지용)
        if let Some(shoulder_alignment) = self.calculate_shoulder_alignment_ratio(&keypoints) {
            let mut baseline_alignment = self.baseline_shoulder_alignment.lock();
            *baseline_alignment = Some(shoulder_alignment);
            info!("새로운 기준 어깨 정렬 설정됨: {}", shoulder_alignment);
        }
        
        // 둘 중 하나라도 설정되면 성공으로 간주
        let face_ratio_set = self.baseline_face_shoulder_ratio.lock().is_some();
        let shoulder_alignment_set = self.baseline_shoulder_alignment.lock().is_some();
        
        if face_ratio_set || shoulder_alignment_set {
            Ok(())
        } else {
            Err("기준 자세를 설정하기 위한 키포인트를 감지하지 못했습니다.".into())
        }
    }
    
    // 어깨 정렬 비율을 계산하는 헬퍼 함수
    fn calculate_shoulder_alignment_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_shoulder.confidence < 0.5 || keypoints.right_shoulder.confidence < 0.5 ||
           keypoints.nose.confidence < 0.5 {
            return None;
        }
        
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        
        if face_height_proxy > 1.0 {
            Some(shoulder_height_diff / face_height_proxy)
        } else {
            None
        }
    }
    fn generate_recommendations(&self, turtle_neck: bool, shoulder_misalignment: bool) -> Vec<serde_json::Value> {
        let mut recommendations = Vec::new();
        
        if turtle_neck {
            recommendations.push(serde_json::Value::String("목을 곧게 펴고 턱을 당기세요".to_string()));
            recommendations.push(serde_json::Value::String("모니터 높이를 눈높이에 맞춰주세요".to_string()));
        }
        
        if shoulder_misalignment {
            recommendations.push(serde_json::Value::String("어깨를 수평으로 맞춰주세요".to_string()));
            recommendations.push(serde_json::Value::String("등받이에 등을 완전히 기대주세요".to_string()));
        }
        
        if recommendations.is_empty() {
            recommendations.push(serde_json::Value::String("좋은 자세를 유지하고 있습니다!".to_string()));
        }
        
        recommendations
    }
}