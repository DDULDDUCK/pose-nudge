#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use log::{error, info, warn, LevelFilter};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    path::{BaseDirectory, PathResolver},
    tray::TrayIconBuilder,
    AppHandle,
    Emitter,
    Manager,
    Runtime,
    State, // ✨ 제네릭을 위해 Runtime 트레이트 import
};
use tauri_plugin_notification::{Notification, NotificationExt};
use tokio::time::sleep;

use image::{ImageBuffer, Rgb};
use nokhwa::{
    pixel_format::RgbFormat,
    utils::{ApiBackend, CameraIndex, CameraInfo, RequestedFormat, RequestedFormatType},
    // Buffer, // ✨ 수정: 사용하지 않는 import 제거
    Camera,
};

use sqlx;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{DbInstances, Migration, MigrationKind};

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

// --- 번역 관리 구조체 ---
pub struct Translations {
    data: HashMap<String, HashMap<String, String>>,
}

impl Translations {
    // ✨ 수정: 함수를 제네릭으로 만들어 어떤 Runtime에서도 동작하게 함
    pub fn new<R: Runtime>(path_resolver: &PathResolver<R>) -> Self {
        let mut data = HashMap::new();
        let locales = vec!["en", "ko", "ja", "zh"]; // 지원하는 언어 목록

        for lang in locales {
            if let Ok(resource_path) =
                path_resolver.resolve(format!("../locales/{}.json", lang), BaseDirectory::Resource)
            {
                if let Ok(file_content) = fs::read_to_string(&resource_path) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&file_content)
                    {
                        data.insert(lang.to_string(), map);

                        info!("'{}' 언어 번역 파일 로드 성공.", lang);
                    } else {
                        error!("'{}' 언어 번역 파일 파싱 실패: {:?}", lang, resource_path);
                    }
                } else {
                    error!("'{}' 언어 번역 파일 읽기 실패: {:?}", lang, resource_path);
                }
            } else {
                error!("'{}' 언어 리소스 경로를 찾을 수 없습니다.", lang);
            }
        }
        Self { data }
    }

    pub fn get(&self, lang: &str, key: &str) -> String {
        self.data
            .get(lang)
            .and_then(|translations| translations.get(key))
            .cloned()
            .unwrap_or_else(|| {
                self.data
                    .get("en")
                    .and_then(|translations| translations.get(key))
                    .cloned()
                    .unwrap_or_else(|| key.to_string())
            })
    }
}

// --- App State ---
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
    monitoring_interval_secs: Arc<Mutex<u64>>,
    translations: Arc<Translations>,
    current_language: Arc<Mutex<String>>,
}

// --- Tauri Commands ---
#[tauri::command]
async fn analyze_pose_data(
    state: State<'_, AppState>,
    image_data: String,
) -> Result<String, String> {
    match state.pose_analyzer.analyze_image_sync(&image_data) {
        Ok(result_str) => Ok(result_str),
        Err(e) => {
            warn!("자세 분석 실패 (캘리브레이션): {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn initialize_pose_model(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
) -> Result<(), String> {
    info!("Pose 모델 초기화 시작");
    state
        .pose_analyzer
        .initialize_model(handle)
        .await
        .map_err(|e| {
            error!("Pose 모델 초기화 실패: {}", e);
            e.to_string()
        })
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
async fn calibrate_user_posture(
    state: State<'_, AppState>,
    image_data: String,
) -> Result<(), String> {
    info!("사용자 자세 캘리브레이션 시작");
    state
        .pose_analyzer
        .set_baseline_posture(&image_data)
        .map_err(|e| {
            error!("자세 캘리브레이션 실패: {}", e);
            e.to_string()
        })
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
    state
        .pose_analyzer
        .test_analysis()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_calibrated_image(
    handle: tauri::AppHandle,
    image_data: String,
) -> Result<String, String> {
    let base64_str = image_data
        .split(',')
        .nth(1)
        .ok_or_else(|| "잘못된 Base64 데이터 형식입니다.".to_string())?;
    let decoded_image = STANDARD
        .decode(base64_str)
        .map_err(|e| format!("Base64 디코딩 실패: {}", e))?;
    let app_data_path = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리를 찾을 수 없습니다: {}", e))?;
    let image_dir = app_data_path.join("calibration_images");
    fs::create_dir_all(&image_dir).map_err(|e| format!("이미지 저장 디렉토리 생성 실패: {}", e))?;
    let file_path = image_dir.join("calibrated_pose.jpeg");
    let mut file = fs::File::create(&file_path).map_err(|e| format!("파일 생성 실패: {:?}", e))?;
    file.write_all(&decoded_image)
        .map_err(|e| format!("파일 쓰기 실패: {:?}", e))?;
    info!("캘리브레이션 이미지 덮어쓰기 완료: {:?}", file_path);
    Ok(file_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn get_available_cameras() -> Result<Vec<CameraDetail>, String> {
    match nokhwa::query(ApiBackend::Auto) {
        Ok(cameras) => {
            info!("사용 가능한 카메라 {}개 발견", cameras.len());
            let camera_details = cameras
                .into_iter()
                .map(|cam: CameraInfo| CameraDetail {
                    index: cam.index().as_index().unwrap_or(0) as u32,
                    name: cam.human_name(),
                })
                .collect();
            Ok(camera_details)
        }
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

        let requested =
            RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
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
    state
        .pose_analyzer
        .set_turtle_neck_sensitivity(turtle_sensitivity);
    state
        .pose_analyzer
        .set_shoulder_sensitivity(shoulder_sensitivity);
    Ok(())
}

#[tauri::command]
async fn set_monitoring_interval(
    state: State<'_, AppState>,
    interval_secs: u64,
) -> Result<(), String> {
    let new_interval = if interval_secs > 0 { interval_secs } else { 1 };
    info!("모니터링 주기 변경: {}초", new_interval);
    *state.monitoring_interval_secs.lock().unwrap() = new_interval;
    Ok(())
}

#[tauri::command]
async fn set_current_language(state: State<'_, AppState>, lang: String) -> Result<(), String> {
    info!("현재 언어 변경: {}", lang);
    *state.current_language.lock().unwrap() = lang;
    Ok(())
}

#[tauri::command]
async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    info!("앱 재시작 요청");
    // 현재 실행 파일 경로 가져오기
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent().unwrap_or(&exe_path);
        let exe_name = exe_path.file_name().unwrap_or_default().to_string_lossy();

        // 새 프로세스로 앱 재시작
        let _ = std::process::Command::new(&exe_path)
            .current_dir(exe_dir)
            .spawn();

        // 현재 앱 종료
        app.exit(0);
    } else {
        return Err("실행 파일 경로를 찾을 수 없습니다.".to_string());
    }
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
                let message = alert_messages.drain(..).collect::<Vec<_>>().join("\n");
                Some(message)
            } else {
                None
            }
        };

        if let Some(message) = messages_to_send {
            if message.is_empty() {
                continue;
            }

            info!("시스템 알림 발생: {}", &message);

            // ✨ 이것이 Tauri v2의 표준적인 알림 호출 방식입니다.
            let builder = app_handle.notification().builder();
            let result = builder
                .title("🐢")
                .body(&message)
                .icon("icons/icon.png".to_string())
                .show();

            if let Err(e) = result {
                error!("시스템 알림을 보내는 데 실패했습니다: {}", e);
            }
        }
    }
}

async fn background_monitoring_task(app_handle: AppHandle, state: AppState) {
    loop {
        let interval_duration = {
            let secs = *state.monitoring_interval_secs.lock().unwrap();
            Duration::from_secs(secs)
        };
        sleep(interval_duration).await;

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
                if let Some(rgb_image) = ImageBuffer::<Rgb<u8>, _>::from_raw(
                    decoded_image.width(),
                    decoded_image.height(),
                    decoded_image.into_raw(),
                ) {
                    if let Ok(result_str) = state.pose_analyzer.analyze_image_buffer(&rgb_image) {
                        if let Ok(result_json) = serde_json::from_str::<Value>(&result_str) {
                            let _ = app_handle.emit("analysis-update", &result_json);
                            let score = result_json
                                .get("posture_score")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            let is_turtle = result_json
                                .get("turtle_neck")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let is_shoulder = result_json
                                .get("shoulder_misalignment")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let timestamp = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap()
                                .as_secs() as i64;

                            let instances = app_handle.state::<DbInstances>();
                            let db_map = instances.0.read().await;

                            // ✨ 수정: 중첩된 if let을 하나로 합쳐서 경고 제거
                            if let Some(tauri_plugin_sql::DbPool::Sqlite(sqlite_pool)) =
                                db_map.get("sqlite:posture_data.db")
                            {
                                let query = "INSERT INTO posture_log (score, is_turtle_neck, is_shoulder_misaligned, timestamp) VALUES (?, ?, ?, ?)";
                                if let Err(e) = sqlx::query(query)
                                    .bind(score)
                                    .bind(is_turtle)
                                    .bind(is_shoulder)
                                    .bind(timestamp)
                                    .execute(sqlite_pool)
                                    .await
                                {
                                    error!("데이터베이스 저장 실패: {}", e);
                                }
                            }

                            if is_turtle || is_shoulder {
                                let mut last_alert = state.last_alert_time.lock().unwrap();
                                if last_alert.elapsed() >= Duration::from_secs(10) {
                                    let lang = state.current_language.lock().unwrap().clone();
                                    let translations = &state.translations;

                                    let message_key = if is_turtle && is_shoulder {
                                        "alert_both"
                                    } else if is_turtle {
                                        "alert_turtle"
                                    } else {
                                        "alert_shoulder"
                                    };

                                    info!("번역 시도: lang='{}', key='{}'", lang, message_key);
                                    let message = translations.get(&lang, message_key);
                                    info!("번역 결과: '{}'", message);

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
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
            
            #[cfg(target_os = "macos")]
			app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            // 데스크탑에서 autostart(자동 시작) 등록 시도
            #[cfg(desktop)]
            {
                // ManagerExt 트레잇을 로컬 스코프에서 가져와 app.autolaunch()를 사용합니다.
                use tauri_plugin_autostart::ManagerExt;

                // 일부 환경에서는 플러그인이 이미 빌더 단계에서 등록되어 있으므로
                // autolaunch 매니저를 통해 활성화 상태를 설정합니다.
                let autostart_manager = app.autolaunch();
                // enable() 호출을 시도하고 상태를 로깅
                let _ = autostart_manager.enable();
                info!("registered for autostart? {}", autostart_manager.is_enabled().unwrap_or(false));
            }

            // ✨ 수정: app.path()가 PathResolver를 반환하므로 .resolver() 없이 바로 참조를 넘겨줍니다.
            let translations = Arc::new(Translations::new(&app.path()));
            
            let app_state = AppState {
                pose_analyzer: Arc::new(PoseAnalyzer::new()),
                monitoring_active: Arc::new(Mutex::new(false)),
                last_alert_time: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
                alert_messages: Arc::new(Mutex::new(Vec::new())),
                camera: Arc::new(Mutex::new(None)),
                selected_camera_index: Arc::new(Mutex::new(0)),
                monitoring_interval_secs: Arc::new(Mutex::new(3)),
                translations: translations,
                current_language: Arc::new(Mutex::new("ko".to_string())),
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
            set_monitoring_interval,
            set_current_language,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
