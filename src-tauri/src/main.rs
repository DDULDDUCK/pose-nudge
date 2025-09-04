// src-tauri/src/main.rs

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{AppHandle, Manager, Emitter, State};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::time::interval;
use log::{info, warn, error, LevelFilter};
use std::fs;
use std::io::Write;
use base64::{Engine as _, engine::general_purpose::STANDARD};

use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{Migration, MigrationKind};

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

#[derive(Clone)]
struct AppState {
    pose_analyzer: Arc<PoseAnalyzer>,
    monitoring_active: Arc<Mutex<bool>>,
    last_alert_time: Arc<Mutex<Instant>>,
    alert_messages: Arc<Mutex<Vec<String>>>,
}

#[tauri::command]
async fn analyze_pose_data(
    state: State<'_, AppState>,
    image_data: String,
) -> Result<String, String> {
    match state.pose_analyzer.analyze_image_sync(&image_data) {
        Ok(result_str) => {
            let result_json: serde_json::Value = serde_json::from_str(&result_str)
                .map_err(|e| format!("결과 JSON 파싱 실패: {}", e))?;
            
            let turtle_neck = result_json.get("turtle_neck").and_then(|v| v.as_bool()).unwrap_or(false);
            let shoulder_mis = result_json.get("shoulder_misalignment").and_then(|v| v.as_bool()).unwrap_or(false);

            if turtle_neck || shoulder_mis {
                let mut last_alert = state.last_alert_time.lock().unwrap();
                if last_alert.elapsed() >= Duration::from_secs(10) {
                    let message = if turtle_neck && shoulder_mis { "거북목과 어깨 기울어짐이 감지되었습니다.".to_string() } else if turtle_neck { "거북목이 감지되었습니다. 목을 곧게 펴주세요!".to_string() } else { "어깨 정렬이 불량합니다. 등받이에 등을 기대주세요!".to_string() };
                    state.alert_messages.lock().unwrap().push(message);
                    *last_alert = Instant::now();
                }
            }
            Ok(result_str)
        }
        Err(e) => { warn!("자세 분석 실패: {}", e); Err(e.to_string()) }
    }
}

#[tauri::command]
async fn initialize_pose_model(state: State<'_, AppState>, handle: tauri::AppHandle) -> Result<(), String> {
    info!("Pose 모델 초기화 시작");
    state.pose_analyzer.initialize_model(handle).await.map_err(|e| { error!("Pose 모델 초기화 실패: {}", e); e.to_string() })
}

#[tauri::command]
async fn start_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    *state.monitoring_active.lock().unwrap() = true;
    info!("실시간 모니터링 시작");
    Ok(())
}

#[tauri::command]
async fn stop_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    *state.monitoring_active.lock().unwrap() = false;
    info!("실시간 모니터링 중지");
    Ok(())
}

#[tauri::command]
async fn calibrate_user_posture(state: State<'_, AppState>, image_data: String) -> Result<(), String> {
    info!("사용자 자세 캘리브레이션 시작");
    state.pose_analyzer.set_baseline_posture(&image_data).map_err(|e| { error!("자세 캘리브레이션 실패: {}", e); e.to_string() })
}

#[tauri::command]
fn get_pose_recommendations() -> Result<Vec<String>, String> {
    Ok(vec![ "목을 곧게 펴고 어깨를 뒤로 당기세요".to_string(), "모니터를 눈높이에 맞춰 조정하세요".to_string(), "30분마다 스트레칭을 해주세요".to_string(), "의자에 등을 완전히 기대고 앉으세요".to_string(), "발은 바닥에 평평하게 놓으세요".to_string(), ])
}

#[tauri::command]
fn get_alert_messages(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut alert_messages = state.alert_messages.lock().unwrap();
    let messages = alert_messages.clone();
    alert_messages.clear();
    Ok(messages)
}

#[tauri::command]
fn get_monitoring_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let monitoring_active = *state.monitoring_active.lock().unwrap();
    Ok(serde_json::json!({ "active": monitoring_active }))
}

#[tauri::command]
fn test_model_status(state: State<'_, AppState>) -> Result<String, String> {
    state.pose_analyzer.test_analysis().map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_calibrated_image(handle: tauri::AppHandle, image_data: String) -> Result<String, String> {
    let base64_str = image_data.split(',').nth(1).ok_or_else(|| "잘못된 Base64 데이터 형식입니다.".to_string())?;
    let decoded_image = STANDARD.decode(base64_str).map_err(|e| format!("Base64 디코딩 실패: {}", e))?;
    let app_data_path = handle.path().app_data_dir().map_err(|e| format!("앱 데이터 디렉토리를 찾을 수 없습니다: {}", e))?;
    let image_dir = app_data_path.join("calibration_images");
    fs::create_dir_all(&image_dir).map_err(|e| format!("이미지 저장 디렉토리 생성 실패: {}", e))?;
    let file_path = image_dir.join("calibrated_pose.jpeg");
    let mut file = fs::File::create(&file_path).map_err(|e| format!("파일 생성 실패: {:?}", e))?;
    file.write_all(&decoded_image).map_err(|e| format!("파일 쓰기 실패: {:?}", e))?;
    info!("캘리브레이션 이미지 덮어쓰기 완료: {:?}", file_path);
    Ok(file_path.to_string_lossy().into_owned())
}

async fn background_alert_task(app_handle: AppHandle, state: AppState) {
    let mut interval = interval(Duration::from_secs(3));
    loop {
        interval.tick().await;
        let messages_to_send = {
            let mut alert_messages = state.alert_messages.lock().unwrap();
            if !alert_messages.is_empty() {
                let messages = alert_messages.clone();
                alert_messages.clear();
                Some(messages)
            } else {
                None
            }
        };

        if let Some(messages) = messages_to_send {
            for message in messages {
                info!("백그라운드 알림 발생: {}", &message);
                let _ = app_handle.emit("posture-alert", &message);
            }
        }
    }
}

fn main() {
    run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) 
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_log::Builder::new()
            .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::Webview)])
            .level(LevelFilter::Info).build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::new()
            .add_migrations(
                "sqlite:posture_data.db",
                vec![Migration {
                    version: 1,
                    description: "create posture log table",
                    // ★★★★★ 수정: 안정적인 원본 SQL문으로 복원 ★★★★★
                    sql: "CREATE TABLE IF NOT EXISTS posture_log (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            score INTEGER NOT NULL,
                            is_turtle_neck BOOLEAN NOT NULL,
                            is_shoulder_misaligned BOOLEAN NOT NULL,
                            timestamp INTEGER NOT NULL
                          );",
                    kind: MigrationKind::Up,
                }],
            ).build())
        .setup(|app| {
            let app_state = AppState {
                pose_analyzer: Arc::new(PoseAnalyzer::new()),
                monitoring_active: Arc::new(Mutex::new(false)),
                last_alert_time: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
                alert_messages: Arc::new(Mutex::new(Vec::new())),
            };
            
            app.manage(app_state.clone());
            
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                background_alert_task(app_handle, app_state).await;
            });

            info!("Pose Nudge 애플리케이션 초기화 완료");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_pose_model,
            start_monitoring,
            stop_monitoring,
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