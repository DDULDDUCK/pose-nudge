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
use tokio::time::interval;
use log::{info, warn, error, LevelFilter};
use std::fs;
use std::io::Write;
use base64::{Engine as _, engine::general_purpose::STANDARD};

use nokhwa::{
    pixel_format::RgbFormat,
    Camera,
    utils::{CameraIndex, RequestedFormat, RequestedFormatType},
    Buffer,
};
use image::{ImageBuffer, Rgb};

use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{Migration, MigrationKind, DbInstances};
use sqlx;

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

#[derive(Clone)]
struct AppState {
    pose_analyzer: Arc<PoseAnalyzer>,
    monitoring_active: Arc<Mutex<bool>>,
    last_alert_time: Arc<Mutex<Instant>>,
    alert_messages: Arc<Mutex<Vec<String>>>,
    camera: Arc<Mutex<Option<Camera>>>,
}

// (command 함수들은 이전과 동일)
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

async fn background_monitoring_task(app_handle: AppHandle, state: AppState) {
    let mut interval = interval(Duration::from_secs(3));
    loop {
        interval.tick().await;
        if !*state.monitoring_active.lock().unwrap() {
            continue;
        }
        
        // ★★★★★ 수정: 스트림이 열려있을 때만 프레임을 가져옵니다. ★★★★★
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

            let camera = {
                let index = CameraIndex::Index(0);
                let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
                match Camera::new(index, requested) {
                    Ok(cam) => {
                        info!("웹캠 초기화 성공: {}", cam.info().human_name());
                        // ★★★★★ 수정: 앱 시작 시 스트림을 열지 않습니다. ★★★★★
                        Arc::new(Mutex::new(Some(cam)))
                    }
                    Err(e) => {
                        error!("웹캠 초기화 실패: {}", e);
                        Arc::new(Mutex::new(None))
                    }
                }
            };

            let app_state = AppState {
                pose_analyzer: Arc::new(PoseAnalyzer::new()),
                monitoring_active: Arc::new(Mutex::new(false)),
                last_alert_time: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
                alert_messages: Arc::new(Mutex::new(Vec::new())),
                camera: camera.clone(),
            };
            app.manage(app_state.clone());
            let alert_app_handle = app.handle().clone();
            let alert_state = app_state.clone();
            tauri::async_runtime::spawn(async move { background_alert_task(alert_app_handle, alert_state).await; });
            let monitor_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { background_monitoring_task(monitor_app_handle, app_state).await; });

            // ★★★★★ 수정: 트레이 메뉴에서 직접 카메라 스트림을 제어합니다. ★★★★★
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
                            *state.monitoring_active.lock().unwrap() = true;
                            if let Some(cam) = &mut *state.camera.lock().unwrap() {
                                if !cam.is_stream_open() {
                                    if let Err(e) = cam.open_stream() {
                                        error!("웹캠 스트림 시작 실패: {}", e);
                                    } else {
                                        info!("웹캠 스트림 시작됨.");
                                    }
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
                        }
                        "stop_monitoring" => {
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
            set_detection_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}