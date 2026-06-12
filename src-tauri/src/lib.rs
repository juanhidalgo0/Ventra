use std::sync::{Arc, Mutex};
use tauri::Manager;

struct BackendPort(u16);

fn clean_unc_path(path: std::path::PathBuf) -> String {
    let path_str = path.to_string_lossy().to_string();
    if path_str.starts_with(r"\\?\") {
        path_str[4..].to_string()
    } else {
        path_str
    }
}

fn find_available_port(start_port: u16) -> u16 {
    let mut port = start_port;
    loop {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
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

    tauri::Builder::default()
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

            let backend_path = app.path().resolve("_up_/apps/backend/dist/ncc/index.js", tauri::path::BaseDirectory::Resource).expect("failed to resolve backend path");
            let backend_path_clean = clean_unc_path(backend_path);
            let database_url = format!("file:{}", db_path_clean.replace('\\', "/"));

            // Kill any process currently occupying port 3001 on Windows to avoid conflicts
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                std::process::Command::new("cmd")
                    .args(&["/C", "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :3001') do taskkill /F /PID %a"])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .ok();
            }

            // Determine active port
            let mut port = 3001;
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_err() {
                port = find_available_port(3002);
            }
            println!("[Tauri] Using backend port: {}", port);
            app.manage(BackendPort(port));

            // In Tauri 2, the window loads its configured frontendDist index.html naturally in production.
            // In development, it points directly to devUrl (localhost:5180).
            // The frontend dynamically requests the backend_port using tauri::command `get_backend_port`.
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.set_fullscreen(true).ok();
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

            // Desencriptar credenciales de Firebase en memoria para máxima seguridad
            let encrypted_base64 = "JH0rJi86fWV9LDotKTY8OgA+PDwwKjErfXN9Ly0wNTo8KwA2O31lfTgwOzozNik6LSZyMj44Oz4zOjE+fXN9Ly02KT4rOgA0OiYANjt9ZX1vPTxpOjxvOzlqPD46ajs+PW9vZm1pbmttbG1uaT07PGo7Om9uaTs7fXN9Ly02KT4rOgA0OiZ9ZX1ycnJych0aGBYRfw8NFgkeCxp/FBoGcnJycnIDMRIWFhopOBYdHhseER04NC43NDYYZihvHR4OGhkeHgwcHRQ4KDg4DDQeOBoeHjAWHR4OGxcwBzUNFj4GJnAxKjIDMWt0KGkndGknEScQLAcTNigpEz4GMCUvLTYKEDRmLBQwCQccHmYJNhYHKx01OBIJOwkmEhU6GSVrbAsrHD0pCWcDMT0RaAwVGxk2FAsmGhMUNDc3CxM0CHAmaRo4DSUoNDsMOSgLcHQcKQttCBB0MTQvDSomEzUQDzI8bzZuOhMQdDwDMWkxaw0NLxArZxM2OgsmPA03bCwYJScpbREHKDwtFiYbNTkeJitvNzZqCwYXEikcJTILCQU8HTwODigYPi0GDm8DMQkNCjMIb28YGRY3Bgh0Nw0cGGoUJhgpDG4oMQ8pLxo6LioONw4FGxYTFRgmNRcsNyYXD2tuGhg4NwZ0FicWa2cDMWc5GWsbCmsabRtoFCsXDCgxNwglDjMxJWZwJyUmN3QxNRYYGQ86HWs8KDY5cG0UGjRqLy8yaytpJx0WaQ5rHgUDMQZqcA4qHitsHjgSHR4eGhw4OBoeDjkqEzgQOCVuGjgTbWcwPmcoCw0LLmgTFBlsDw1nZjgRDiccNmw6MS0FOxYDMRgTPh4nFjwLO2kQExozHTIUaTsGZ2YbOg85bm40GihsNxQNHTxnNm4tdBhnCBltODJtb2sqFgtuHh0JNTszCB0DMRgXFwgJaC4Nbjo3CRoNDDMsEAtwE2sFEWgtNBs6EiZtOhsYGzwTOwYuBQcIM2gbGG9rEy8rBhMoGQZuJxpmFAYDMTw7HR0yLD5tHCVrEgsyOj07a2oMGj09FBs0DDM5MjUlOzUHGAUKNRUwKgc1G24uPWdsKRBscBNpDSsJbAVrLjoDMRwPDzVrEzo8LhI7KWgRLDYUJxY7NWsqESYoOzZuODEzFxduGSovBhYLFwoqOCwtPj1rCjgWOHQZaSwpNippJR4DMWwFBTENCmg9HBl0dAUIBjoUDTVtFWg6KzIKFRcuEAxuPjMsDD43aAgFDhQdOA4bbT4dEW8lEDBrGCgHCzExEjwDMWoHaDZvaTcJOWkQbxYGBR4HDAluCxRwbDU1OhsaBigPNjhram06CgZoawk8KwYSGg8Ibi5pKnAFC2sNKTc9FTIDMQwPFhtqFy4wKjJqcC9rOxsUBx4dEDAWMW40J28uBh1wMWYSDGkRajUREyw7bw4WayptPm0PJzo1BS8zPS4+HTgDMT4ZNxoKGmc0dBQYDgguFG80FG88MRE2ExooFB04DhsPBSZoazocCjY1CXAJcBgcORkwKhk4KAhmDAsrMjtmDAoDMTIMbAkUbm4pBmkHMi4UGg0ZBh4IJi1qBzYyNzFtMD50FiYKKwYMGWppKhsvBg1rHhlrEj0UOmYeJgYHaCk3CTsDMRglFT4WNzppBhkMBQppChd0OjIVGSY7OycTORoLO3QYLDsVCWppLQ0UCxg2LxM+ER0zMwtnaRMbMRAGFwkdKDgDMQsUGjwmNiwYNQ4UHTgOHBoLLBYLK20oCjQbaxwsCQ8mEjUdZi1uC20eZxkrGAYsJiYZGiYqEDUTLTIqCgslMmgDMS80dAURFCUJDRE6HQ8zbRUMby4LBxhmFT4yZzwMKzkQFhgaGw44bSYnZjcVBSUKbxkQbG4IKisaBRI7EmoMZx4DMQgZKxYbOGoTNi49MjU9F2osFz4wPg0nDBAqPDduKgosMScubRZnGmg4K20RbWwldBZpNCg8OnRnCw4UHTgZHGYDMTgGLghnJwcrBQc+OQUzMTAGdGoGaxlrPGkLDysmGBIaZysQdC4oDgcbOzIuMDkZES8yJmodLS9oMzQRcCU7aSsDMQ86PQUxNTo3GAg6NxAdCDkaBTFnNRs3JTptBQwLGCUPNS9tFBo2DC0VPg90aA4sPmw1HQ0NGxtoJg8VJygyOTQDMQ1mPRM7NRIoJSUTPmwxMCoaa2o8GQgoGwZrCRJtHTBtbS5tNTgxBSseMBgdHhAtNW0yBygSFS9sCz4TE2k8NgsDMWcRD2wTNSoaESkqZ3BsbyhqNDxrb2wxPBAmBzQoFjcXbyY8BxUTFhE+GXQlBwozPjg2B2kJLjNnNzoLLj44LiwDMTxoajQVOWpsF2wMNDIFFCUxJzA3Bys0KA0nPDsaGDAUOD0UBTw6GhAoOhoKJxo4BjYZFwcwEzgzFzV0GWcSEhsDMSUwBw8GBTk5CAoTGzQvFy8JGG5rMhMcbQMxcnJycnIaERt/Dw0WCR4LGn8UGgZycnJycgMxfXN9PDM2OjErADoyPjYzfWV9OTYtOj0+LDpyPjsyNjEsOzRyOT0sKTwfODA7OjM2KTotJnIyPjg7PjM6MT5xNj4ycTgsOi0pNjw6Pjw8MCoxK3E8MDJ9c308MzY6MSsANjt9ZX1ub2tvbG1ubWhubm1vbmhnaWdnbG59c30+Kis3ACotNn1lfTcrKy8sZXBwPjw8MCoxKyxxODAwODM6cTwwMnAwcDA+Kis3bXA+Kis3fXN9KzA0OjEAKi02fWV9NysrLyxlcHAwPiorN21xODAwODM6Pi82LHE8MDJwKzA0OjF9c30+Kis3AC8tMCk2OzotACdqb2YAPDotKwAqLTN9ZX03KysvLGVwcCgoKHE4MDA4Mzo+LzYscTwwMnAwPiorN21wKW5wPDotKyx9c308MzY6MSsAJ2pvZgA8Oi0rACotM31lfTcrKy8sZXBwKCgocTgwMDgzOj4vNixxPDAycC0wPTArcClucDI6Kz47Pis+cCdqb2ZwOTYtOj0+LDpyPjsyNjEsOzRyOT0sKTx6a284MDs6MzYpOi0mcjI+ODs+MzoxPnE2PjJxOCw6LSk2PDo+PDwwKjErcTwwMn1zfSoxNik6LSw6ADswMj42MX1lfTgwMDgzOj4vNixxPDAyfSI=";
            let credentials_json = {
                use base64::{Engine as _, engine::general_purpose};
                let decoded = general_purpose::STANDARD.decode(encrypted_base64).unwrap_or_default();
                let key = 0x5F;
                let decrypted: Vec<u8> = decoded.into_iter().map(|b| b ^ key).collect();
                String::from_utf8(decrypted).unwrap_or_default()
            };

            println!("[Tauri] Spawning Node backend using: {:?}", node_path_clean);
            let mut cmd = std::process::Command::new(node_path_clean);
            cmd.arg("--max-old-space-size=256")
                .arg(backend_path_clean)
                .env("NODE_ENV", "production")
                .env("PORT", port.to_string())
                .env("DATABASE_URL", database_url)
                .env("FIREBASE_CREDENTIALS_JSON", credentials_json)
                .env("GODELIVERY_COMERCIO_ID", "7mdgE7txSCQqWQl1Hzrqa5PCo8C2")
                .env("LOCAL_SYNC_TOKEN", "paulos-local-sync-token-secret-2026")
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
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let mut lock = child_process_clone.lock().unwrap();
                if let Some(mut child) = lock.take() {
                    println!("[Tauri] Killing Node backend process...");
                    child.kill().ok();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![save_performance_mode, get_backend_port, toggle_fullscreen, open_auth_window, open_browser])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
