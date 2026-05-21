mod recording;

use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn parse_shortcut(shortcut_str: &str) -> Option<Shortcut> {
    let mut modifiers = Modifiers::empty();
    let mut code = None;

    for part in shortcut_str.split('+') {
        match part {
            "CmdOrCtrl" | "Super" => modifiers |= Modifiers::SUPER,
            "Shift" => modifiers |= Modifiers::SHIFT,
            "Alt" => modifiers |= Modifiers::ALT,
            "Ctrl" => modifiers |= Modifiers::CONTROL,
            "Space" => code = Some(Code::Space),
            key if key.len() == 1 => {
                let ch = key.chars().next().unwrap().to_ascii_uppercase();
                code = Some(match ch {
                    'A' => Code::KeyA,
                    'B' => Code::KeyB,
                    'C' => Code::KeyC,
                    'D' => Code::KeyD,
                    'E' => Code::KeyE,
                    'F' => Code::KeyF,
                    'G' => Code::KeyG,
                    'H' => Code::KeyH,
                    'I' => Code::KeyI,
                    'J' => Code::KeyJ,
                    'K' => Code::KeyK,
                    'L' => Code::KeyL,
                    'M' => Code::KeyM,
                    'N' => Code::KeyN,
                    'O' => Code::KeyO,
                    'P' => Code::KeyP,
                    'Q' => Code::KeyQ,
                    'R' => Code::KeyR,
                    'S' => Code::KeyS,
                    'T' => Code::KeyT,
                    'U' => Code::KeyU,
                    'V' => Code::KeyV,
                    'W' => Code::KeyW,
                    'X' => Code::KeyX,
                    'Y' => Code::KeyY,
                    'Z' => Code::KeyZ,
                    _ => return None,
                });
            }
            _ => return None,
        }
    }

    code.map(|c| Shortcut::new(Some(modifiers), c))
}

const SIDECAR_PORT: u16 = 5174;
const MAX_RESTARTS: u32 = 3;

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn is_port_in_use(port: u16) -> bool {
    std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

fn spawn_sidecar(app_root: &std::path::Path) -> Option<Child> {
    Command::new("node")
        .arg("src/index.js")
        .current_dir(app_root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()
}

fn wait_for_health(port: u16, max_attempts: u32) -> bool {
    for _ in 0..max_attempts {
        if is_port_in_use(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    is_port_in_use(port)
}

fn start_sidecar_manager(app: &tauri::App) {
    let handle = app.handle().clone();
    let app_root = std::env::current_dir().unwrap();

    if is_port_in_use(SIDECAR_PORT) {
        return;
    }

    let child = match spawn_sidecar(&app_root) {
        Some(c) => Arc::new(Mutex::new(Some(c))),
        None => return,
    };

    if !wait_for_health(SIDECAR_PORT, 20) {
        send_notification(
            handle.clone(),
            "后端启动失败".into(),
            "Node.js 后端无法启动，请检查日志。".into(),
        );
        return;
    }

    let child_clone = Arc::clone(&child);
    let handle_clone = handle.clone();

    thread::spawn(move || {
        let mut restarts = 0u32;
        loop {
            thread::sleep(Duration::from_secs(2));
            let needs_restart = {
                let mut guard = child_clone.lock().unwrap();
                match guard.as_mut() {
                    Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                    None => true,
                }
            };
            if !needs_restart {
                continue;
            }
            if restarts >= MAX_RESTARTS {
                send_notification(
                    handle_clone.clone(),
                    "后端反复崩溃".into(),
                    format!("Node.js 后端已崩溃 {} 次，请手动重启应用。", MAX_RESTARTS),
                );
                break;
            }
            thread::sleep(Duration::from_secs(1));
            if let Some(new_child) = spawn_sidecar(&app_root) {
                let mut guard = child_clone.lock().unwrap();
                *guard = Some(new_child);
                restarts += 1;
            }
        }
    });
}

#[tauri::command]
fn restart_sidecar() -> bool {
    let app_root = std::env::current_dir().unwrap();
    if let Some(mut child) = spawn_sidecar(&app_root) {
        let _ = child.kill();
    }
    is_port_in_use(SIDECAR_PORT)
}

#[tauri::command]
fn set_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    let new_shortcut = parse_shortcut(&shortcut).ok_or("Invalid shortcut format")?;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister: {}", e))?;

    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(new_shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = handle.emit("toggle-recording", ());
            }
        })
        .map_err(|e| format!("Failed to register: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_recording_path() -> String {
    std::env::current_dir()
        .unwrap_or_default()
        .join("recordings")
        .to_string_lossy()
        .into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("toggle-recording", ());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            send_notification,
            restart_sidecar,
            set_shortcut,
            recording::start_recording,
            recording::stop_recording,
            recording::is_recording,
            recording::upload_recording,
            get_recording_path
        ])
        .setup(|app| {
            // Register default global shortcut
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyR);
            app.global_shortcut().register(shortcut)?;

            // System tray
            let toggle_item = MenuItem::with_id(app, "toggle", "开始录音 ⌘⇧R", true, None::<&str>)?;
            let open_item = MenuItem::with_id(app, "open", "打开看板", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle_item, &open_item, &settings_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("个人工作雷达")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "toggle" => {
                            let _ = app.emit("toggle-recording", ());
                        }
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "settings" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.eval("window.location.href='/settings.html'");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Keep app running when window is closed
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            start_sidecar_manager(app);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running recording dashboard");
}
