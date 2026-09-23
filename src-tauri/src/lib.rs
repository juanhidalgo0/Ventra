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

const WEBVIEW2_DOWNLOAD_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

fn ventra_data_dir() -> std::path::PathBuf {
    let base = std::env::var("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    base.join("com.godelivery.pos")
}

/// Deja constancia de cualquier problema de arranque en %APPDATA%\com.godelivery.pos\startup-error.log,
/// para poder diagnosticar una PC sin adivinar.
fn log_startup_error(msg: &str) -> std::path::PathBuf {
    use std::io::Write;
    let dir = ventra_data_dir();
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("startup-error.log");
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        writeln!(f, "[{}] v{} {}", secs, env!("CARGO_PKG_VERSION"), msg).ok();
    }
    path
}

/// Cuadro de Windows nativo: funciona aunque falte WebView2 o la app no haya creado ninguna ventana.
#[cfg(target_os = "windows")]
fn native_dialog(title: &str, text: &str, yes_no: bool) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::*;
    let style = MB_TOPMOST | MB_SETFOREGROUND | if yes_no { MB_YESNO | MB_ICONWARNING } else { MB_OK | MB_ICONERROR };
    unsafe { MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(title), style) == IDYES }
}

#[cfg(not(target_os = "windows"))]
fn native_dialog(title: &str, text: &str, _yes_no: bool) -> bool {
    eprintln!("{}: {}", title, text);
    false
}

/// Avisa sin frenar el arranque (el cuadro queda en su propio hilo).
fn notify_error(title: &'static str, text: String) {
    log_startup_error(&text);
    std::thread::spawn(move || { native_dialog(title, &text, false); });
}

#[cfg(target_os = "windows")]
fn webview2_installed() -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    let mut version = windows::core::PWSTR::null();
    unsafe { GetAvailableCoreWebView2BrowserVersionString(windows::core::PCWSTR::null(), &mut version).is_ok() && !version.is_null() }
}

/// Cierra el backend que haya quedado vivo de una sesión anterior de Ventra (por ejemplo,
/// si la app se cerró de golpe). Solo se toca el proceso cuyo PID se anotó al lanzarlo y
/// solo si sigue siendo un node.exe, así nunca se cierra un programa ajeno.
#[cfg(target_os = "windows")]
fn kill_orphan_backend(pid_file: &std::path::Path) {
    use std::os::windows::process::CommandExt;
    let Some(pid) = std::fs::read_to_string(pid_file).ok().and_then(|s| s.trim().parse::<u32>().ok()) else { return };
    std::fs::remove_file(pid_file).ok();
    let is_node = std::process::Command::new("tasklist")
        .args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("\"node.exe\""))
        .unwrap_or(false);
    if is_node {
        println!("[Tauri] Killing orphan backend from a previous session (PID {})", pid);
        std::process::Command::new("taskkill")
            .args(&["/F", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .output()
            .ok();
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
fn restart_app(app_handle: tauri::AppHandle, state: tauri::State<'_, BackendChild>) {
    println!("[Tauri] Relaunching application...");
    if let Some(mut child) = state.0.lock().unwrap().take() {
        child.kill().ok();
        child.wait().ok();
    }
    // Soltar el candado de instancia única antes de relanzar: si no, la copia nueva
    // encuentra a esta todavía viva y se cierra, y la app no vuelve a abrir.
    tauri_plugin_single_instance::destroy(&app_handle);
    app_handle.restart();
}

#[tauri::command]
fn open_browser(url: String) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // rundll32 abre la URL tal cual en el navegador predeterminado. Con "cmd /C start"
        // los enlaces con "&" (por ejemplo WhatsApp con texto) se cortaban.
        if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:") || url.starts_with("tel:")) {
            return;
        }
        let mut cmd = std::process::Command::new("rundll32.exe");
        cmd.args(&["url.dll,FileProtocolHandler", &url]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn().ok();
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().ok();
    }
}


/// Impresoras instaladas en Windows, para elegir la de tickets en Configuración.
#[tauri::command]
fn list_printers() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("powershell.exe")
            .args(&["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | ForEach-Object { $_.Name }"])
            .creation_flags(0x08000000)
            .output();
        if let Ok(o) = out {
            return String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        }
    }
    Vec::new()
}

/// Imprime la página actual (con su CSS de impresión, igual que window.print) directo a la
/// impresora, sin el cuadro de Windows. Sin nombre usa la impresora predeterminada.
#[tauri::command]
async fn silent_print(window: tauri::WebviewWindow, printer: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let tx2 = tx.clone();
        window
            .with_webview(move |wv| {
                if let Err(e) = unsafe { start_silent_print(wv, printer, tx2.clone()) } {
                    let _ = tx2.send(Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
        drop(tx);
        return tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(std::time::Duration::from_secs(90)).unwrap_or(Err("La impresora no respondió".into()))
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, printer);
        Err("Impresión directa no disponible".into())
    }
}

#[cfg(target_os = "windows")]
unsafe fn start_silent_print(
    wv: tauri::webview::PlatformWebview,
    printer: Option<String>,
    tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::PrintCompletedHandler;
    use windows::core::{Interface, HSTRING};
    let e = |x: windows::core::Error| x.message().to_string();
    let core = wv.controller().CoreWebView2().map_err(e)?;
    let core16: ICoreWebView2_16 = core.cast().map_err(|_| "WebView2 desactualizado".to_string())?;
    let env6: ICoreWebView2Environment6 = wv.environment().cast().map_err(|_| "WebView2 desactualizado".to_string())?;
    let settings = env6.CreatePrintSettings().map_err(e)?;
    settings.SetShouldPrintHeaderAndFooter(false).map_err(e)?;
    settings.SetShouldPrintBackgrounds(true).map_err(e)?;
    if let Some(name) = printer.filter(|p| !p.trim().is_empty()) {
        let s2: ICoreWebView2PrintSettings2 = settings.cast().map_err(e)?;
        s2.SetPrinterName(&HSTRING::from(name)).map_err(e)?;
    }
    let handler = PrintCompletedHandler::create(Box::new(move |res, status| {
        let r = match res {
            Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED => Ok(()),
            Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE => Err("La impresora no está disponible".to_string()),
            Ok(()) => Err("No se pudo imprimir".to_string()),
            Err(err) => Err(err.message().to_string()),
        };
        let _ = tx.send(r);
        Ok(())
    }));
    core16.Print(&settings, &handler).map_err(e)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Red de seguridad: si algo falla al arrancar, nunca cerrarse en silencio.
    // Se explica el problema en pantalla y queda guardado en startup-error.log.
    std::panic::set_hook(Box::new(|info| {
        let detail = info.to_string();
        let log_path = log_startup_error(&format!("PANIC: {}", detail));
        if std::thread::current().name() == Some("main") {
            native_dialog(
                "Ventra no pudo iniciar",
                &format!(
                    "Ventra no pudo iniciar en esta PC.\n\nDetalle: {}\n\nProbá reiniciar la PC y volver a abrir Ventra. Si sigue pasando, mandá a soporte el archivo:\n{}",
                    detail,
                    log_path.display()
                ),
                false,
            );
        }
    }));

    #[cfg(target_os = "windows")]
    if !webview2_installed() {
        log_startup_error("WebView2 no está instalado");
        let open = native_dialog(
            "Falta un componente de Windows",
            "Ventra necesita Microsoft WebView2 y no está instalado en esta PC.\n\n¿Querés descargarlo ahora? Al terminar de instalarlo, volvé a abrir Ventra.\n\n(Hace falta conexión a internet solo para esta descarga.)",
            true,
        );
        if open {
            open_browser(WEBVIEW2_DOWNLOAD_URL.to_string());
        }
        return;
    }

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
        // Tiene que ir primero: si Ventra ya está abierta, la segunda copia solo trae al
        // frente la ventana existente y se cierra antes de tocar el backend de la primera.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                main.unminimize().ok();
                main.show().ok();
                main.set_focus().ok();
            }
        }))
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

            // Cerrar solo el backend huérfano de una sesión anterior de Ventra. Si el 3001 lo
            // ocupa otro programa, no se lo toca: más abajo se elige otro puerto libre.
            let pid_file = app_data_dir.join("backend.pid");
            #[cfg(target_os = "windows")]
            kill_orphan_backend(&pid_file);

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

            // Arma y lanza el proceso del backend. Se reusa para relanzarlo si se cae.
            let spawn_backend = {
                let node_path = node_path_clean.clone();
                let app_data_dir = app_data_dir.clone();
                move || -> std::io::Result<std::process::Child> {
                    let log_file_out = std::fs::OpenOptions::new().create(true).append(true).open(app_data_dir.join("backend.log")).ok();
                    let log_file_err = std::fs::OpenOptions::new().create(true).append(true).open(app_data_dir.join("backend-err.log")).ok();

                    println!("[Tauri] Spawning Node backend using: {:?}", node_path);
                    let mut cmd = std::process::Command::new(&node_path);
                    cmd.arg("--max-old-space-size=512")
                        .arg(&backend_path_clean)
                        .env("NODE_ENV", "production")
                        .env("PORT", port.to_string())
                        .env("DATABASE_URL", &database_url)
                        .env("GODELIVERY_COMERCIO_ID", "7mdgE7txSCQqWQl1Hzrqa5PCo8C2")
                        .env("LOCAL_SYNC_TOKEN", "paulos-local-sync-token-secret-2026")
                        .env("GEMINI_API_KEY", &gemini_api_key)
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
                    let child = cmd.spawn()?;
                    std::fs::write(&pid_file, child.id().to_string()).ok();
                    Ok(child)
                }
            };

            // Si el backend no arranca, la ventana igual se abre y se explica el motivo,
            // en vez de que la app se cierre sin decir nada.
            if !std::path::Path::new(&node_path_clean).exists() {
                notify_error(
                    "Ventra: falta un archivo",
                    format!(
                        "Falta un archivo interno de Ventra:
{}

Casi siempre lo borra o bloquea el antivirus. Restauralo desde la cuarentena del antivirus, agregá la carpeta de Ventra a sus exclusiones y reinstalá Ventra.",
                        node_path_clean
                    ),
                );
                return Ok(());
            }
            match spawn_backend() {
                Ok(child) => *child_process.lock().unwrap() = Some(child),
                Err(e) => {
                    notify_error(
                        "Ventra no pudo iniciar el sistema",
                        format!(
                            "No se pudo iniciar el sistema interno de Ventra.

Detalle: {}

Suele ser el antivirus bloqueando Ventra. Agregá la carpeta de Ventra a las exclusiones del antivirus y volvé a abrirla.",
                            e
                        ),
                    );
                    return Ok(());
                }
            }

            // Vigilante: si el backend se cae, se relanza solo. Si se cae una y otra vez
            // en poco tiempo, se deja de insistir y se avisa. Cuando la app se cierra o se
            // instala una actualización, el proceso se saca del Mutex y el vigilante termina.
            let watchdog_child = Arc::clone(&child_process);
            std::thread::spawn(move || {
                let mut restarts = 0u32;
                let mut last_start = std::time::Instant::now();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let mut lock = watchdog_child.lock().unwrap();
                    let status = match lock.as_mut() {
                        None => break,
                        Some(child) => match child.try_wait() {
                            Ok(Some(status)) => status,
                            _ => continue,
                        },
                    };
                    if last_start.elapsed() > std::time::Duration::from_secs(120) {
                        restarts = 0;
                    }
                    if restarts >= 5 {
                        *lock = None;
                        notify_error(
                            "Ventra: el sistema se detuvo",
                            format!(
                                "El sistema interno de Ventra se detuvo varias veces seguidas ({}).

Cerrá Ventra y volvé a abrirla. Si sigue pasando, mandá a soporte el archivo:
{}",
                                status,
                                app_data_dir.join("backend-err.log").display()
                            ),
                        );
                        break;
                    }
                    restarts += 1;
                    log_startup_error(&format!("Backend terminó ({}); relanzando, intento {}", status, restarts));
                    match spawn_backend() {
                        Ok(child) => {
                            *lock = Some(child);
                            last_start = std::time::Instant::now();
                        }
                        Err(e) => {
                            *lock = None;
                            notify_error("Ventra no pudo iniciar el sistema", format!("No se pudo relanzar el sistema interno de Ventra.

Detalle: {}", e));
                            break;
                        }
                    }
                }
            });
 
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
         .invoke_handler(tauri::generate_handler![save_performance_mode, get_backend_port, toggle_fullscreen, open_auth_window, open_browser, restart_app, stop_backend_for_update, list_printers, silent_print]);

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
