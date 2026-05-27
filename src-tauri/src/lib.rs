mod recording;

use std::io::Write;
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

fn find_node() -> String {
    // GUI apps on macOS don't inherit shell PATH (nvm, volta, fnm, homebrew).
    // Check common locations, then fall back to `node` (inherits current PATH).
    let candidates = [
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    // Try resolving via login shell (picks up nvm/volta/fnm/homebrew)
    // Use `zsh -l -c` to simulate a login shell that sources all profile files.
    if let Ok(output) = std::process::Command::new("/bin/zsh")
        .args(["-l", "-c", "which node"])
        .output()
    {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() && std::path::Path::new(&path).exists() {
            return path;
        }
    }
    // Fallback: try explicit nvm default
    if let Ok(home) = std::env::var("HOME") {
        let nvm_default = format!("{}/.nvm/versions/node/v25.2.1/bin/node", home);
        if std::path::Path::new(&nvm_default).exists() {
            return nvm_default;
        }
        // Try scanning nvm versions directory for any installed node
        let nvm_dir = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().join("bin/node").exists())
                .collect();
            versions.sort_by(|a, b| b.file_name().cmp(&a.file_name())); // newest first
            if let Some(latest) = versions.first() {
                return latest.path().join("bin/node").to_string_lossy().into_owned();
            }
        }
    }
    "node".to_string()
}

fn app_support_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
    home.join("Library/Application Support/com.recording-dashboard.app")
}

fn sidecar_log_path() -> std::path::PathBuf {
    app_support_dir().join("sidecar.log")
}

/// Write a diagnostic line to sidecar.log. Always succeeds (falls back to /tmp).
fn log_to_file(msg: &str) {
    let path = sidecar_log_path();
    let _ = std::fs::create_dir_all(path.parent().unwrap_or(std::path::Path::new("/tmp")));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", msg);
    } else if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true)
        .open("/tmp/recording-dashboard-sidecar.log")
    {
        let _ = writeln!(f, "{}", msg);
    }
}

fn spawn_sidecar(app_root: &std::path::Path) -> Option<Child> {
    // In production (DMG), app_root is the Resources dir inside .app bundle.
    // In dev, it's the project root. Check for src/index.js to confirm.
    let src_index = app_root.join("src").join("index.js");
    let (cwd, script_path) = if src_index.exists() {
        (app_root.to_path_buf(), "src/index.js".to_string())
    } else {
        // Fallback: try current dir (dev mode launched from project root)
        let cwd = std::env::current_dir().unwrap_or_else(|_| app_root.to_path_buf());
        (cwd, "src/index.js".to_string())
    };

    let node_path = find_node();

    // Write diagnostics directly to log file (eprintln is invisible in .app context)
    log_to_file(&format!("=== sidecar spawn attempt ==="));
    log_to_file(&format!("node binary: {}", node_path));
    log_to_file(&format!("script: {}", script_path));
    log_to_file(&format!("cwd: {}", cwd.display()));
    log_to_file(&format!("app_root: {}", app_root.display()));
    log_to_file(&format!("src/index.js exists: {}", src_index.exists()));
    log_to_file(&format!("node binary exists: {}", std::path::Path::new(&node_path).exists()));

    // Open log file for child's stderr
    let log_path = sidecar_log_path();
    let log_file = std::fs::OpenOptions::new()
        .create(true).append(true).open(&log_path)
        .unwrap_or_else(|e| {
            log_to_file(&format!("WARN: cannot open {}, falling back to /tmp: {}", log_path.display(), e));
            std::fs::File::create("/tmp/recording-dashboard-sidecar.log").unwrap()
        });

    match Command::new(&node_path)
        .arg(&script_path)
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(log_file)
        .spawn()
    {
        Ok(child) => {
            log_to_file(&format!("sidecar spawned OK, pid={}", child.id()));
            Some(child)
        }
        Err(e) => {
            log_to_file(&format!("sidecar spawn FAILED: {}", e));
            None
        }
    }
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
    // Use Tauri path resolver: in production this returns <app>.app/Contents/Resources/
    // In dev it returns the project root.
    let app_root = handle.path().resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());

    if is_port_in_use(SIDECAR_PORT) {
        log_to_file("sidecar port already in use, skipping spawn");
        return;
    }

    let child = match spawn_sidecar(&app_root) {
        Some(c) => Arc::new(Mutex::new(Some(c))),
        None => {
            log_to_file("ERROR: spawn_sidecar returned None");
            send_notification(
                handle.clone(),
                "后端启动失败".into(),
                format!("无法启动 Node.js，请确认已安装 Node.js 22+。路径: {}", app_root.display()),
            );
            return;
        }
    };

    if !wait_for_health(SIDECAR_PORT, 20) {
        let log_path = sidecar_log_path();
        let log_hint = format!("查看日志: {}", log_path.display());
        log_to_file(&format!("ERROR: health check failed after 10s. {}", log_hint));
        send_notification(
            handle.clone(),
            "后端启动失败".into(),
            format!("Node.js 后端无法启动。{}", log_hint),
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
fn restart_sidecar(app: tauri::AppHandle) -> bool {
    let app_root = app.path().resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    // Just spawn a new sidecar — if the old one is dead, the new one takes the port.
    // The sidecar manager thread handles crash detection and restarts.
    if let Some(_child) = spawn_sidecar(&app_root) {
        // Give it a moment to start
        std::thread::sleep(std::time::Duration::from_secs(2));
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
    let home = std::env::var("HOME").map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = home.join("Library/Application Support/com.recording-dashboard.app/recordings");
    std::fs::create_dir_all(&dir).ok();
    dir.to_string_lossy().into_owned()
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
            // Register default global shortcut (graceful failure)
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyR);
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("Failed to register shortcut Cmd+Shift+R: {}", e);
                let handle = app.handle().clone();
                send_notification(
                    handle,
                    "快捷键注册失败".into(),
                    format!("Cmd+Shift+R 被其他应用占用，请在设置中更换快捷键。({})", e),
                );
            }

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
