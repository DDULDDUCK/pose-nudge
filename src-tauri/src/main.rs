#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{AppHandle, Emitter, Manager};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::time::interval;
use log::{info, warn, error, LevelFilter}; // <-- 1. 여기에 LevelFilter 추가
use std::fs;
use std::io::Write;
use base64::{Engine as _, engine::general_purpose::STANDARD};

use tauri_plugin_log::{Target, TargetKind}; // <-- LogLevel은 여기서 더 이상 필요 없음

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

// ... (AppState 및 command 함수들은 모두 그대로 유지, 수정할 필요 없음) ...
// (생략)

#[derive(Clone, serde::Serialize)]
struct PostureAlert {
    message: String,
    severity: String,
    timestamp: u64,
}

struct AppState {
    pose_analyzer: Arc<PoseAnalyzer>,
    monitoring_active: Arc<Mutex<bool>>,
    background_monitoring: Arc<Mutex<bool>>,
    last_alert_time: Arc<Mutex<Instant>>,
    alert_messages: Arc<Mutex<Vec<String>>>,
    power_save_mode: Arc<Mutex<bool>>,
}

#[tauri::command]
async fn initialize_pose_model(
    state: tauri::State<'_, AppState>, 
    handle: tauri::AppHandle
) -> Result<(), String> {
    info!("Pose 모델 초기화 시작");
    state.pose_analyzer
        .initialize_model(handle)
        .await
        .map_err(|e| {
            error!("Pose 모델 초기화 실패: {}", e);
            e.to_string()
        })?;
    info!("Pose 모델 초기화 완료");
    Ok(())
}

#[tauri::command]
async fn start_monitoring(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut monitoring_active = state.monitoring_active.lock().unwrap();
    *monitoring_active = true;
    info!("실시간 모니터링 시작");
    Ok(())
}

#[tauri::command]
async fn stop_monitoring(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut monitoring_active = state.monitoring_active.lock().unwrap();
    *monitoring_active = false;
    info!("실시간 모니터링 중지");
    Ok(())
}

#[tauri::command]
async fn start_background_monitoring(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut background_monitoring = state.background_monitoring.lock().unwrap();
    *background_monitoring = true;
    state.pose_analyzer.set_background_monitoring(true);
    info!("백그라운드 모니터링 시작");
    Ok(())
}

#[tauri::command]
async fn calibrate_user_posture(state: tauri::State<'_, AppState>, image_data: String) -> Result<(), String> {
    info!("사용자 자세 캘리브레이션 시작");
    match state.pose_analyzer.set_baseline_posture(&image_data) {
        Ok(_) => {
            info!("자세 캘리브레이션 성공");
            Ok(())
        }
        Err(e) => {
            error!("자세 캘리브레이션 실패: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn stop_background_monitoring(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut background_monitoring = state.background_monitoring.lock().unwrap();
    *background_monitoring = false;
    state.pose_analyzer.set_background_monitoring(false);
    info!("백그라운드 모니터링 중지");
    Ok(())
}

#[tauri::command]
async fn set_power_save_mode(
    state: tauri::State<'_, AppState>,
    enabled: bool
) -> Result<(), String> {
    let mut power_save_mode = state.power_save_mode.lock().unwrap();
    *power_save_mode = enabled;
    state.pose_analyzer.set_adaptive_mode(enabled);
    
    if enabled {
        info!("전력 절약 모드 활성화");
    } else {
        info!("전력 절약 모드 비활성화");
    }
    Ok(())
}

#[tauri::command]
async fn analyze_pose_data(
    state: tauri::State<'_, AppState>,
    image_data: String,
) -> Result<String, String> {
    
    state.pose_analyzer.mark_analysis_time();
    
    match state.pose_analyzer.analyze_image_sync(&image_data) {
        Ok(result_str) => {
            let result: serde_json::Value = serde_json::from_str(&result_str)
                .map_err(|e| format!("결과 파싱 실패: {}", e))?;
            
            if let Some(turtle_neck) = result.get("turtle_neck").and_then(|v| v.as_bool()) {
                if turtle_neck {
                    let mut last_alert = state.last_alert_time.lock().unwrap();
                    if last_alert.elapsed() >= Duration::from_secs(30) {
                        let mut alert_messages = state.alert_messages.lock().unwrap();
                        alert_messages.push("거북목이 감지되었습니다. 목을 곧게 펴주세요!".to_string());
                        *last_alert = Instant::now();
                    }
                }
            }
            
            if let Some(shoulder_misalignment) = result.get("shoulder_misalignment").and_then(|v| v.as_bool()) {
                if shoulder_misalignment {
                    let mut alert_messages = state.alert_messages.lock().unwrap();
                    alert_messages.push("어깨 정렬이 불량합니다. 등받이에 등을 기대주세요!".to_string());
                }
            }
            
            Ok(result_str)
        }
        Err(e) => {
            warn!("자세 분석 실패: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
fn get_pose_recommendations() -> Result<Vec<String>, String> {
    Ok(vec![
        "목을 곧게 펴고 어깨를 뒤로 당기세요".to_string(),
        "모니터를 눈높이에 맞춰 조정하세요".to_string(),
        "30분마다 스트레칭을 해주세요".to_string(),
        "의자에 등을 완전히 기대고 앉으세요".to_string(),
        "발은 바닥에 평평하게 놓으세요".to_string(),
    ])
}

#[tauri::command]
fn get_alert_messages(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut alert_messages = state.alert_messages.lock().unwrap();
    let messages = alert_messages.clone();
    alert_messages.clear();
    Ok(messages)
}

#[tauri::command]
fn get_monitoring_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let monitoring_active = *state.monitoring_active.lock().unwrap();
    let background_monitoring = *state.background_monitoring.lock().unwrap();
    let power_save_mode = *state.power_save_mode.lock().unwrap();
    
    Ok(serde_json::json!({
        "active": monitoring_active,
        "background": background_monitoring,
        "power_save": power_save_mode
    }))
}

#[tauri::command]
fn test_model_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let result = state.pose_analyzer.test_analysis()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

async fn background_monitoring_task(app_handle: AppHandle, state: Arc<AppState>) {
    let mut interval = interval(Duration::from_secs(30));
    
    loop {
        interval.tick().await;
        
        let background_active = *state.background_monitoring.lock().unwrap();
        if !background_active {
            continue;
        }
        
        info!("백그라운드 자세 체크 수행");
        
        let messages = {
            let mut alert_messages = state.alert_messages.lock().unwrap();
            if !alert_messages.is_empty() {
                let messages = alert_messages.clone();
                alert_messages.clear();
                Some(messages)
            } else {
                None
            }
        };
        
        if let Some(messages) = messages {
            for message in messages {
                let _ = app_handle.emit("posture-alert", &message);
            }
        }
    }
}

#[tauri::command]
async fn save_calibrated_image(handle: tauri::AppHandle, image_data: String) -> Result<String, String> {
    let base64_str = image_data.split(',').nth(1)
        .ok_or_else(|| "잘못된 Base64 데이터 형식입니다.".to_string())?;

    let decoded_image = STANDARD.decode(base64_str)
        .map_err(|e| format!("Base64 디코딩 실패: {}", e))?;

    let app_data_path = handle.path().app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리를 찾을 수 없습니다: {}", e))?;

    let image_dir = app_data_path.join("calibration_images");
    fs::create_dir_all(&image_dir)
        .map_err(|e| format!("이미지 저장 디렉토리 생성 실패: {}", e))?;

    let file_path = image_dir.join("calibrated_pose.jpeg");

    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("파일 생성 실패: {:?}", e))?;
    file.write_all(&decoded_image)
        .map_err(|e| format!("파일 쓰기 실패: {:?}", e))?;
    
    info!("캘리브레이션 이미지 덮어쓰기 완료: {:?}", file_path);

    Ok(file_path.to_string_lossy().into_owned())
}


fn main() {
    run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::Webview),
            ])
            // --- 2. 여기가 수정된 부분입니다 ---
            .level(LevelFilter::Info) // LogLevel::Info 대신 LevelFilter::Info 사용
            .build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init()) 
        .setup(|app| {
            let pose_analyzer = Arc::new(PoseAnalyzer::new());
            let monitoring_active = Arc::new(Mutex::new(false));
            let background_monitoring = Arc::new(Mutex::new(false));
            let last_alert_time = Arc::new(Mutex::new(Instant::now()));
            let alert_messages = Arc::new(Mutex::new(Vec::new()));
            let power_save_mode = Arc::new(Mutex::new(true));

            let state = Arc::new(AppState {
                pose_analyzer,
                monitoring_active,
                background_monitoring,
                last_alert_time,
                alert_messages,
                power_save_mode,
            });

            app.manage(AppState {
                pose_analyzer: state.pose_analyzer.clone(),
                monitoring_active: state.monitoring_active.clone(),
                background_monitoring: state.background_monitoring.clone(),
                last_alert_time: state.last_alert_time.clone(),
                alert_messages: state.alert_messages.clone(),
                power_save_mode: state.power_save_mode.clone(),
            });

            let app_handle = app.handle().clone();
            let state_clone = state.clone();
            tauri::async_runtime::spawn(async move {
                background_monitoring_task(app_handle, state_clone).await;
            });

            info!("Pose Nudge 애플리케이션 초기화 완료");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_pose_model,
            start_monitoring,
            stop_monitoring,
            start_background_monitoring,
            stop_background_monitoring,
            set_power_save_mode,
            analyze_pose_data,
            get_pose_recommendations,
            get_alert_messages,
            get_monitoring_status,
            test_model_status,
            calibrate_user_posture,
            save_calibrated_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}