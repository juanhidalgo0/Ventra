use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager};

struct BackendPort(u16);
struct BackendChild(Arc<Mutex<Option<std::process::Child>>>);

fn clean_unc_path(path: std::path::PathBuf) -> String {
    let path_str = path.to_string_lossy().to_string();
    if path_str.starts_with(r"\\?\") {
        path_str[4..].to_string()
    } else {
        path_str
    }
}

// El backend escucha en 0.0.0.0: probar solo 127.0.0.1 puede dar "libre" en Windows
// aunque otro proceso tenga el puerto en 0.0.0.0, y el backend moría con EADDRINUSE.
fn port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("0.0.0.0", port)).is_ok()
        && std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_available_port(start_port: u16) -> u16 {
    let mut port = start_port;
    loop {
        if port_is_free(port) {
            return port;
        }
        port += 1;
        if port > start_port + 100 {
            return start_port;
        }
    }
}

#[tauri::command]
fn save_performance_mode(enabled: bool) {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let path = std::path::PathBuf::from(appdata).join("com.godelivery.pos");
        std::fs::create_dir_all(&path).ok();
        let settings_file = path.join("performance_mode.txt");
        std::fs::write(settings_file, if enabled { "true" } else { "false" }).ok();
    }
}

#[tauri::command]
fn get_backend_port(port_state: tauri::State<'_, BackendPort>) -> u16 {
    port_state.0
}

// Called by the frontend right before installing a downloaded update. NSIS
// needs to overwrite the backend's files (including native .node addons like
// bcrypt_lib.node), which stay locked by Windows for as long as the spawned
// Node process that loaded them is alive. Waiting for our own process to exit
// isn't good enough — the old Updater.tsx flow never restarts the app at all,
// it just runs the installer while everything is still running — so this
// kills the backend and BLOCKS until the OS has actually released its file
// handles (kill() alone only requests termination; wait() is what confirms
// it's gone) before the frontend is allowed to proceed to update.install().
#[tauri::command]
fn stop_backend_for_update(state: tauri::State<'_, BackendChild>) {
    let mut lock = state.0.lock().unwrap();
    if let Some(mut child) = lock.take() {
        println!("[Tauri] Stopping backend before installing update...");
        child.kill().ok();
        child.wait().ok();
        println!("[Tauri] Backend stopped; file handles released.");
    }
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    if let Ok(is_fullscreen) = window.is_fullscreen() {
        if is_fullscreen {
            window.set_fullscreen(false).ok();
            window.maximize().ok();
        } else {
            window.set_fullscreen(true).ok();
        }
    }
}

#[tauri::command]
fn open_auth_window(app_handle: tauri::AppHandle, url: String) {
    if let Some(existing) = app_handle.get_webview_window("auth_popup") {
        existing.close().ok();
    }
    
    let _ = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "auth_popup",
        tauri::WebviewUrl::External(url.parse().unwrap())
    )
    .title("Vincular Google")
    .inner_size(450.0, 550.0)
    .resizable(false)
    .always_on_top(true)
    .center()
    .focused(true)
    .devtools(true)
    .build();
}

#[tauri::command]
fn restart_app(app_handle: tauri::AppHandle) {
    println!("[Tauri] Relaunching application...");
    app_handle.restart();
}

#[tauri::command]
fn open_browser(url: String) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(&["/C", "start", "", &url]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn().ok();
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().ok();
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let path = std::path::PathBuf::from(appdata).join("com.godelivery.pos");
            let settings_file = path.join("performance_mode.txt");
            if let Ok(content) = std::fs::read_to_string(settings_file) {
                if content.trim() == "true" {
                    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu --disable-software-rasterizer");
                    println!("[Tauri] Performance mode active. GPU hardware acceleration disabled.");
                }
            }
        }
    }

    let child_process: Arc<Mutex<Option<std::process::Child>>> = Arc::new(Mutex::new(None));
    let child_process_clone = Arc::clone(&child_process);
    let child_process_exit = Arc::clone(&child_process);
    let child_process_state = Arc::clone(&child_process);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BackendChild(child_process_state))
        .setup(move |app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            let db_path = app_data_dir.join("dev.db");
            let db_path_clean = clean_unc_path(db_path.clone());
            if !db_path.exists() {
                if let Ok(resource_db) = app.path().resolve("_up_/apps/backend/prisma/dev.db", tauri::path::BaseDirectory::Resource) {
                    if resource_db.exists() {
                        std::fs::copy(&resource_db, &db_path).ok();
                        println!("[Tauri] Database copied to AppData: {:?}", db_path);
                    }
                }
            }

            // Copy .env to AppData to make sure spawned backend can access keys (e.g. GEMINI_API_KEY)
            let env_path = app_data_dir.join(".env");
            let mut env_copied = false;

            // 1. Try to copy from the bundled resources (packaged in production)
            if let Ok(resource_env) = app.path().resolve("_up_/.env", tauri::path::BaseDirectory::Resource) {
                if resource_env.exists() {
                    if std::fs::copy(&resource_env, &env_path).is_ok() {
                        println!("[Tauri] Env file copied from resource bundle: {:?}", resource_env);
                        env_copied = true;
                    }
                }
            }

            // 2. Fallback to local paths in development
            if !env_copied {
                let possible_paths = [
                    "../.env",
                    "../../.env",
                    ".env",
                    "apps/backend/.env",
                ];
                for rel_path in &possible_paths {
                    let check_path = std::path::Path::new(rel_path);
                    if check_path.exists() {
                        if std::fs::copy(check_path, &env_path).is_ok() {
                            println!("[Tauri] Env file copied successfully to AppData from: {:?}", check_path);
                            break;
                        }
                    }
                }
            }

            let backend_path = app.path().resolve("_up_/apps/backend/dist/ncc/index.js", tauri::path::BaseDirectory::Resource).expect("failed to resolve backend path");
            let backend_path_clean = clean_unc_path(backend_path);
            let database_url = format!("file:{}", db_path_clean.replace('\\', "/"));

            // Kill any process currently occupying port 3001 on Windows to avoid conflicts
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                if let Ok(mut child) = std::process::Command::new("cmd")
                    .args(&["/C", "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :3001') do taskkill /F /PID %a"])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                {
                    child.wait().ok();
                }
            }

            // Esperar (hasta ~2 s) a que Windows libere el puerto del backend anterior,
            // en vez de una pausa fija que a veces no alcanzaba.
            for _ in 0..20 {
                if port_is_free(3001) { break; }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            // Determine active port
            let mut port = 3001;
            if !port_is_free(port) {
                port = find_available_port(3002);
            }
            println!("[Tauri] Using backend port: {}", port);
            app.manage(BackendPort(port));

            // In Tauri 2, the window loads its configured frontendDist index.html naturally in production.
            // In development, it points directly to devUrl (localhost:5180).
            // The frontend dynamically requests the backend_port using tauri::command `get_backend_port`.
            if let Some(main_window) = app.get_webview_window("main") {
                // Maximized (fills the screen, keeps window borders/titlebar so
                // the close button works) instead of true borderless fullscreen.
                main_window.maximize().ok();

                // The main window starts hidden (see tauri.conf.json) so the user
                // never sees a blank white frame while the webview boots. The
                // splashscreen window covers that gap instead. Once this window's
                // content actually finishes loading (either the dev navigate below,
                // or the bundled frontendDist in production), swap them: close the
                // splash and reveal the real window.
                let reveal_handle = app.handle().clone();
                main_window.once("tauri://load", move |_event| {
                    if let Some(splash) = reveal_handle.get_webview_window("splashscreen") {
                        splash.close().ok();
                    }
                    if let Some(main) = reveal_handle.get_webview_window("main") {
                        main.show().ok();
                        main.set_focus().ok();
                    }
                });

                // Safety net: if "tauri://load" never fires (navigation error, a
                // frontend that never resolves, etc.) don't leave the user staring
                // at the splash forever — reveal the main window anyway. Calling
                // show()/close() again once the normal path already ran is harmless.
                let fallback_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                    if let Some(splash) = fallback_handle.get_webview_window("splashscreen") {
                        splash.close().ok();
                    }
                    if let Some(main) = fallback_handle.get_webview_window("main") {
                        main.show().ok();
                    }
                });

                if tauri::is_dev() {
                    let dev_url = "http://localhost:5180/";
                    let target_url = match main_window.url() {
                        Ok(current_url) if current_url.as_str() != "about:blank" => {
                            let mut url = current_url;
                            url.query_pairs_mut().append_pair("backend_port", &port.to_string());
                            url
                        }
                        _ => {
                            let mut url = tauri::Url::parse(dev_url).unwrap();
                            url.query_pairs_mut().append_pair("backend_port", &port.to_string());
                            url
                        }
                    };
                    println!("[Tauri Dev] Navigating webview to: {}", target_url);
                    main_window.navigate(target_url).ok();
                } else {
                    println!("[Tauri Production] Relying on default asset loader...");
                }
            }

            let node_path = app.path().resolve("_up_/apps/backend/bin/node.exe", tauri::path::BaseDirectory::Resource).expect("failed to resolve node path");
            let node_path_clean = clean_unc_path(node_path);

            let log_file_out = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(app_data_dir.join("backend.log"))
                .ok();
            let log_file_err = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(app_data_dir.join("backend-err.log"))
                .ok();

            // Las credenciales de Firebase NO van en el código ni en el instalador:
            // la integración opcional con GoDelivery lee `firebase-credentials.json`
            // desde la carpeta de datos de la app (app_data_dir) si el comercio la
            // configuró. Sin ese archivo el backend arranca con la sincronización apagada.

            let gemini_api_key = std::env::var("GEMINI_API_KEY").unwrap_or_else(|_| {
                // Try to find it in the local .env file in the current directory
                if let Ok(content) = std::fs::read_to_string(".env") {
                    for line in content.lines() {
                        if line.starts_with("GEMINI_API_KEY=") {
                            return line.split('=').nth(1)
                                .map(|s| s.trim_matches('"').trim_matches('\'').trim().to_string())
                                .unwrap_or_default();
                        }
                    }
                }
                // Try to find it in the local .env file in the app_data_dir
                if let Ok(content) = std::fs::read_to_string(app_data_dir.join(".env")) {
                    for line in content.lines() {
                        if line.starts_with("GEMINI_API_KEY=") {
                            return line.split('=').nth(1)
                                .map(|s| s.trim_matches('"').trim_matches('\'').trim().to_string())
                                .unwrap_or_default();
                        }
                    }
                }
                "".to_string()
            });

            println!("[Tauri] Spawning Node backend using: {:?}", node_path_clean);
            let mut cmd = std::process::Command::new(node_path_clean);
            cmd.arg("--max-old-space-size=512")
                .arg(backend_path_clean)
                .env("NODE_ENV", "production")
                .env("PORT", port.to_string())
                .env("DATABASE_URL", database_url)
                .env("GODELIVERY_COMERCIO_ID", "7mdgE7txSCQqWQl1Hzrqa5PCo8C2")
                .env("LOCAL_SYNC_TOKEN", "paulos-local-sync-token-secret-2026")
                .env("GEMINI_API_KEY", gemini_api_key)
                .current_dir(&app_data_dir);

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }

            if let Some(file) = log_file_out {
                cmd.stdout(file);
            }
            if let Some(file) = log_file_err {
                cmd.stderr(file);
            }

            let child = cmd.spawn().expect("failed to start backend process");
 
             *child_process.lock().unwrap() = Some(child);
 
             Ok(())
         })
         .on_window_event(move |window, event| {
             // Only the "main" window closing means the app is actually exiting.
             // The splashscreen window is also destroyed (via .close()) a few
             // seconds after startup as part of the normal boot handoff — without
             // this guard, that close was being treated as "app closed" and killed
             // the freshly-started backend before it ever got used.
             if window.label() != "main" {
                 return;
             }
             if let tauri::WindowEvent::Destroyed = event {
                 let mut lock = child_process_clone.lock().unwrap();
                 if let Some(mut child) = lock.take() {
                     println!("[Tauri] Main window destroyed: Killing Node backend process...");
                     child.kill().ok();
                     // Block until the OS confirms the process is actually gone — kill()
                     // alone only sends the termination request. Without this, app.exe
                     // can finish tearing down (and anything waiting on it, like an
                     // updater installer, can start writing files) before Windows has
                     // released the native .node addons the backend had loaded.
                     child.wait().ok();
                 }
             }
         })
         .invoke_handler(tauri::generate_handler![save_performance_mode, get_backend_port, toggle_fullscreen, open_auth_window, open_browser, restart_app, stop_backend_for_update]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let mut lock = child_process_exit.lock().unwrap();
            if let Some(mut child) = lock.take() {
                println!("[Tauri] Exit event: Killing Node backend process...");
                child.kill().ok();
                child.wait().ok();
            }
        }
    });
}
