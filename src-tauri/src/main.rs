#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
// ✨ tokio::time::sleep을 직접 사용하기 위해 추가
use tokio::time::sleep;
use log::{info, warn, error, LevelFilter};
use std::fs;
use std::io::Write;
use base64::{Engine as _, engine::general_purpose::STANDARD};

use nokhwa::{
    pixel_format::RgbFormat,
    Camera,
    utils::{ApiBackend, CameraIndex, RequestedFormat, RequestedFormatType, CameraInfo},
    Buffer,
};
use image::{ImageBuffer, Rgb};

use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{Migration, MigrationKind, DbInstances};
use sqlx;

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

#[derive(serde::Serialize, Clone)]
struct CameraDetail {
    index: u32,
    name: String,
}

#[derive(Clone)]
struct AppState {
    pose_analyzer: Arc<PoseAnalyzer>,
    monitoring_active: Arc<Mutex<bool>>,
    last_alert_time: Arc<Mutex<Instant>>,
    alert_messages: Arc<Mutex<Vec<String>>>,
    camera: Arc<Mutex<Option<Camera>>>,
    selected_camera_index: Arc<Mutex<u32>>,
    // ✨ 모니터링 주기를 저장할 상태 추가 (단위: 초)
    monitoring_interval_secs: Arc<Mutex<u64>>,
}

// --- Tauri Commands ---

#[tauri::command]
async fn analyze_pose_data(
    state: State<'_, AppState>,
    image_data: String,
) -> Result<String, String> {
    match state.pose_analyzer.analyze_image_sync(&image_data) {
        Ok(result_str) => Ok(result_str),
        Err(e) => { warn!("자세 분석 실패 (캘리브레이션): {}", e); Err(e.to_string()) }
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

#[tauri::command]
async fn get_available_cameras() -> Result<Vec<CameraDetail>, String> {
    match nokhwa::query(ApiBackend::Auto) {
        Ok(cameras) => {
            info!("사용 가능한 카메라 {}개 발견", cameras.len());
            let camera_details = cameras.into_iter().map(|cam: CameraInfo| {
                CameraDetail {
                    index: cam.index().as_index().unwrap_or(0) as u32,
                    name: cam.human_name(),
                }
            }).collect();
            Ok(camera_details)
        },
        Err(e) => {
            error!("카메라 목록 조회 실패: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn set_selected_camera(state: State<'_, AppState>, index: u32) -> Result<(), String> {
    info!("선택된 카메라 변경: index {}", index);
    let mut current_cam_lock = state.camera.lock().unwrap();
    
    if *state.monitoring_active.lock().unwrap() && current_cam_lock.is_some() {
        info!("모니터링 중 카메라 변경 시도...");
        if let Some(mut cam) = current_cam_lock.take() {
            if cam.is_stream_open() {
                let _ = cam.stop_stream();
            }
        }
        
        let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
        match Camera::new(CameraIndex::Index(index), requested) {
            Ok(mut new_cam) => {
                info!("새 카메라 초기화 성공: {}", new_cam.info().human_name());
                if let Err(e) = new_cam.open_stream() {
                    error!("새 카메라 스트림 시작 실패: {}", e);
                } else {
                    info!("새 카메라 스트림 시작됨.");
                    *current_cam_lock = Some(new_cam);
                }
            }
            Err(e) => {
                error!("인덱스 {}번 새 카메라 초기화 실패: {}", index, e);
            }
        }
    }
    
    *state.selected_camera_index.lock().unwrap() = index;
    Ok(())
}

#[tauri::command]
async fn set_detection_settings(
    state: State<'_, AppState>,
    frequency: u8,
    turtle_sensitivity: u8,
    shoulder_sensitivity: u8,
) -> Result<(), String> {
    state.pose_analyzer.set_notification_frequency(frequency);
    state.pose_analyzer.set_turtle_neck_sensitivity(turtle_sensitivity);
    state.pose_analyzer.set_shoulder_sensitivity(shoulder_sensitivity);
    Ok(())
}

// ✨ 추가된 command: 프론트엔드에서 모니터링 주기를 설정
#[tauri::command]
async fn set_monitoring_interval(state: State<'_, AppState>, interval_secs: u64) -> Result<(), String> {
    // 0초 미만은 비정상적이므로 최소 1초로 제한
    let new_interval = if interval_secs > 0 { interval_secs } else { 1 };
    info!("모니터링 주기 변경: {}초", new_interval);
    *state.monitoring_interval_secs.lock().unwrap() = new_interval;
    Ok(())
}

// --- Background Tasks ---

async fn background_alert_task(app_handle: AppHandle, state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(3));
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

async fn background_monitoring_task(app_handle: AppHandle, state: AppState) {
    // ✨ 고정된 interval 대신 loop 안에서 동적으로 sleep
    loop {
        // ✨ 루프 시작 시점에서 현재 설정된 주기를 가져옴
        let interval_duration = {
            let secs = *state.monitoring_interval_secs.lock().unwrap();
            Duration::from_secs(secs)
        };
        // ✨ 설정된 주기만큼 대기
        sleep(interval_duration).await;
        
        // 모니터링이 활성화 상태가 아니면 다음 주기로 넘어감
        if !*state.monitoring_active.lock().unwrap() {
            continue;
        }
        
        let buffer_option = {
            let mut cam_lock = state.camera.lock().unwrap();
            if let Some(cam) = cam_lock.as_mut() {
                if cam.is_stream_open() {
                    cam.frame().ok()
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(buffer) = buffer_option {
            if let Ok(decoded_image) = buffer.decode_image::<RgbFormat>() {
                if let Some(rgb_image) = ImageBuffer::<Rgb<u8>, _>::from_raw(decoded_image.width(), decoded_image.height(), decoded_image.into_raw()) {
                    if let Ok(result_str) = state.pose_analyzer.analyze_image_buffer(&rgb_image) {
                        if let Ok(result_json) = serde_json::from_str::<serde_json::Value>(&result_str) {
                            let _ = app_handle.emit("analysis-update", &result_json);
                            let score = result_json.get("posture_score").and_then(|v| v.as_i64()).unwrap_or(0);
                            let is_turtle = result_json.get("turtle_neck").and_then(|v| v.as_bool()).unwrap_or(false);
                            let is_shoulder = result_json.get("shoulder_misalignment").and_then(|v| v.as_bool()).unwrap_or(false);
                            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
                            let db_path = "sqlite:posture_data.db";
                            let instances = app_handle.state::<DbInstances>();
                            let db_map = instances.0.read().await;
                            if let Some(pool) = db_map.get(db_path) {
                                if let tauri_plugin_sql::DbPool::Sqlite(sqlite_pool) = pool {
                                    let query = "INSERT INTO posture_log (score, is_turtle_neck, is_shoulder_misaligned, timestamp) VALUES (?, ?, ?, ?)";
                                    if let Err(e) = sqlx::query(query).bind(score).bind(is_turtle).bind(is_shoulder).bind(timestamp).execute(sqlite_pool).await {
                                        error!("데이터베이스 저장 실패: {}", e);
                                    }
                                }
                            }
                            if is_turtle || is_shoulder {
                                let mut last_alert = state.last_alert_time.lock().unwrap();
                                if last_alert.elapsed() >= Duration::from_secs(10) {
                                    let message = if is_turtle && is_shoulder { "거북목과 어깨 기울어짐이 감지되었습니다.".to_string() } else if is_turtle { "거북목이 감지되었습니다. 목을 곧게 펴주세요!".to_string() } else { "어깨 정렬이 불량합니다. 등받이에 등을 기대주세요!".to_string() };
                                    state.alert_messages.lock().unwrap().push(message);
                                    *last_alert = Instant::now();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// --- Main Application Setup ---

fn main() {
    run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) 
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_log::Builder::new().targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::Webview)]).level(LevelFilter::Info).build())
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
                    sql: "CREATE TABLE IF NOT EXISTS posture_log (id INTEGER PRIMARY KEY AUTOINCREMENT, score INTEGER NOT NULL, is_turtle_neck BOOLEAN NOT NULL, is_shoulder_misaligned BOOLEAN NOT NULL, timestamp INTEGER NOT NULL);",
                    kind: MigrationKind::Up,
                }],
            ).build())
        .setup(|app| {
            let quit = PredefinedMenuItem::quit(app, Some("Quit Pose Nudge"))?;
            let show = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let start_monitoring_item = MenuItem::with_id(app, "start_monitoring", "Start Monitoring", true, None::<&str>)?;
            let stop_monitoring_item = MenuItem::with_id(app, "stop_monitoring", "Stop Monitoring", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&start_monitoring_item, &stop_monitoring_item, &PredefinedMenuItem::separator(app)?, &show, &quit])?;

            // ✨ AppState 초기화 시 monitoring_interval_secs 필드 추가
            let app_state = AppState {
                pose_analyzer: Arc::new(PoseAnalyzer::new()),
                monitoring_active: Arc::new(Mutex::new(false)),
                last_alert_time: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
                alert_messages: Arc::new(Mutex::new(Vec::new())),
                camera: Arc::new(Mutex::new(None)),
                selected_camera_index: Arc::new(Mutex::new(0)),
                // ✨ 모니터링 주기 기본값 3초로 설정
                monitoring_interval_secs: Arc::new(Mutex::new(3)),
            };
            app.manage(app_state.clone());

            let alert_app_handle = app.handle().clone();
            let alert_state = app_state.clone();
            tauri::async_runtime::spawn(async move { background_alert_task(alert_app_handle, alert_state).await; });
            
            let monitor_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { background_monitoring_task(monitor_app_handle, app_state).await; });

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Pose Nudge")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    let state = app.state::<AppState>();
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        },
                        "start_monitoring" => {
                            info!("'Start Monitoring' 클릭됨");
                            *state.monitoring_active.lock().unwrap() = true;

                            let mut cam_lock = state.camera.lock().unwrap();
                            if let Some(cam) = cam_lock.as_mut() {
                                if !cam.is_stream_open() {
                                    if let Err(e) = cam.open_stream() {
                                        error!("기존 웹캠 스트림 시작 실패: {}", e);
                                    } else {
                                        info!("기존 웹캠 스트림 시작됨.");
                                    }
                                }
                            } else {
                                let index = *state.selected_camera_index.lock().unwrap();
                                info!("선택된 인덱스 {}번 카메라로 초기화 시도", index);
                                let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
                                match Camera::new(CameraIndex::Index(index), requested) {
                                    Ok(mut cam) => {
                                        info!("웹캠 초기화 성공: {}", cam.info().human_name());
                                        if let Err(e) = cam.open_stream() {
                                            error!("새 웹캠 스트림 시작 실패: {}", e);
                                        } else {
                                            info!("새 웹캠 스트림 시작됨.");
                                            *cam_lock = Some(cam);
                                        }
                                    }
                                    Err(e) => {
                                        error!("인덱스 {}번 웹캠 초기화 실패: {}", index, e);
                                    }
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
                        }
                        "stop_monitoring" => {
                            info!("'Stop Monitoring' 클릭됨");
                            *state.monitoring_active.lock().unwrap() = false;
                            if let Some(cam) = &mut *state.camera.lock().unwrap() {
                                if cam.is_stream_open() {
                                    if let Err(e) = cam.stop_stream() {
                                        error!("웹캠 스트림 중지 실패: {}", e);
                                    } else {
                                        info!("웹캠 스트림 중지됨.");
                                    }
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": false }));
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            info!("Pose Nudge 애플리케이션 초기화 완료");
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Destroyed => {
                let camera_to_stop = {
                    let state = window.state::<AppState>();
                    let mut guard = state.camera.lock().unwrap();
                    guard.take()
                };
                if let Some(mut cam) = camera_to_stop {
                    if cam.is_stream_open() {
                        if let Err(e) = cam.stop_stream() {
                             error!("웹캠 스트림 종료 실패: {}", e);
                        } else {
                            info!("웹캠 스트림을 안전하게 종료했습니다.");
                        }
                    }
                }
            }
            _ => {}
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
            save_calibrated_image,
            set_detection_settings,
            get_available_cameras,
            set_selected_camera,
            // ✨ 새로 추가한 command 등록
            set_monitoring_interval
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}