use std::{
    borrow::Cow,
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use percent_encoding::percent_decode_str;
use serde_json::{Value, json};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::{Fullscreen, Icon, Window, WindowBuilder},
};
use wry::{
    NewWindowResponse, WebContext, WebView, WebViewBuilder,
    http::{Request, Response, StatusCode},
};

use crate::{
    agent,
    browser::Browser,
    node_backend::NodeBackend,
    terminal::{self, Terminals},
    versions,
};

#[path = "account_transport.rs"]
mod account_transport;
use account_transport::AccountTransport;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

const PROTOCOL: &str = "frst-ide";
const DOCUMENT: &str = "frst-ide://app/index.html";
#[cfg(target_os = "windows")]
const DISPLAY_DOCUMENT: &str = "https://frst-ide.app/index.html";
#[cfg(not(target_os = "windows"))]
const DISPLAY_DOCUMENT: &str = DOCUMENT;

pub enum HostEvent {
    Invoke(Value),
    MotionReply(Value),
    Backend(Value),
    LocalEvent(Value),
    NativeReply(Value),
    AgentEnded(Value),
    TerminalExited(u64),
    TerminalEnded {
        id: u64,
        pty: bool,
        code: Option<i64>,
    },
    Disconnected,
    CloseChecked(Instant, Option<bool>),
    BrowserPage {
        generation: u64,
        url: String,
        loading: bool,
    },
    BrowserTitle {
        generation: u64,
        title: String,
    },
}

pub fn launch() -> Result<()> {
    let root = repo_root()?;
    let renderer = root.join("desktop/renderer").canonicalize()?;
    if !renderer.join("vendor/codemirror.js").is_file() {
        return Err("Les ressources du bureau doivent être préparées avec npm ci --ignore-scripts puis npm run build:renderer.".into());
    }
    let (profile, lock) = crate::workbench::lock_profile()?;

    let events = EventLoopBuilder::<HostEvent>::with_user_event().build();
    let proxy = events.create_proxy();
    let icon =
        image::load_from_memory(include_bytes!("../../../../desktop/icon.png"))?.into_rgba8();
    let (width, height) = icon.dimensions();
    let icon = Icon::from_rgba(icon.into_raw(), width, height)?;
    let window = WindowBuilder::new()
        .with_title("FranceStudent IDE · Rust")
        .with_window_icon(Some(icon))
        .with_inner_size(LogicalSize::new(1400., 900.))
        .with_min_inner_size(LogicalSize::new(900., 600.))
        .build(&events)?;
    let account_transport = AccountTransport::new()
        .inspect_err(|error| eprintln!("Transport réseau Rust indisponible : {error}"))
        .ok();
    let mut backend =
        NodeBackend::start(&root, &profile, proxy.clone(), account_transport.is_some())?;
    let mut browser = Browser::new(proxy.clone());
    let mut terminals = Terminals::default();
    let mut running_agent: Option<(String, Arc<AtomicBool>)> = None;
    let mut pending_motion = None;
    let mut pending_close = None;
    let mut context = WebContext::new(Some(profile.join("webview")));
    let capability = uuid::Uuid::new_v4().to_string();
    let startup = startup_script(&capability)?;
    let ipc_proxy = proxy.clone();

    #[allow(unused_mut)]
    let mut builder = WebViewBuilder::new_with_web_context(&mut context);
    #[cfg(target_os = "windows")]
    {
        use wry::WebViewBuilderExtWindows;
        builder = builder.with_https_scheme(true);
    }
    let webview = builder
        .with_url(DOCUMENT)
        .with_background_color((20, 20, 20, 255))
        .with_initialization_script_for_main_only(startup, true)
        .with_navigation_handler(|url| trusted_document(&url))
        .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
        .with_custom_protocol(PROTOCOL.into(), move |_, req| serve(&renderer, req))
        .with_ipc_handler(move |req| receive_ipc(req, &capability, &ipc_proxy))
        .build(&window)?;

    events.run(move |event, _, flow| {
        // The lock and browser profile must outlive the window.
        let _ = (&lock, &context);
        *flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } if window_id == window.id() => {
                check_close(&webview, &proxy, &mut pending_close);
            }
            Event::UserEvent(HostEvent::CloseChecked(request, can_close)) if pending_close == Some(request) => {
                pending_close = None;
                if can_close == Some(true) || confirm_close(&window, can_close) {
                    terminals.stop_all();
                    if let Some((_, stop)) = &running_agent { stop.store(true, Ordering::Release); }
                    if let Some(transport) = &account_transport { transport.close(); }
                    backend.close();
                    *flow = ControlFlow::Exit;
                }
            }
            Event::UserEvent(HostEvent::Invoke(packet)) => {
                if let Err(error) = backend.send(&packet) {
                    deliver(&webview, json!({ "kind": "reply", "id": packet["id"], "ok": false, "error": error.to_string() }));
                }
            }
            Event::UserEvent(HostEvent::MotionReply(mut packet)) => {
                if packet["id"].as_u64().is_some() && packet["id"].as_u64() == pending_motion {
                    pending_motion = None;
                    packet["kind"] = json!("nativeReply");
                    let _ = backend.send(&packet);
                }
            }
            Event::UserEvent(HostEvent::LocalEvent(packet)) => deliver(&webview, packet),
            Event::UserEvent(HostEvent::NativeReply(packet)) => {
                let _ = backend.send(&packet);
            }
            Event::UserEvent(HostEvent::AgentEnded(packet)) => {
                running_agent = None;
                let _ = backend.send(&packet);
            }
            Event::UserEvent(HostEvent::TerminalExited(id)) => terminals.forget(id),
            Event::UserEvent(HostEvent::TerminalEnded { id, pty, code }) => {
                terminals.forget(id);
                deliver(&webview, json!({"kind":"event", "channel":if pty {"ptyExit"} else {"terminalExit"},
                    "data":{"id":id,"code":code,"signal":null}}));
            }
            Event::UserEvent(HostEvent::Backend(packet)) => match packet["kind"].as_str() {
                Some("reply" | "event") => deliver(&webview, packet),
                Some("native") => {
                    if packet["method"] == "effectCraftRequest" {
                        pending_motion = packet["id"].as_u64();
                        deliver(&webview, json!({"kind": "motion", "id": packet["id"], "payload": packet["payload"]}));
                        return;
                    }
                    let id = packet["id"].clone();
                    let request = &packet["payload"];
                    let result = match packet["method"].as_str() {
                        Some("accountTransport") => {
                            let result = match (account_transport.as_ref(), backend.service()) {
                                (Some(transport), Some(bridge)) => transport.invoke(&id, request, bridge),
                                _ => Err("Le transport réseau Rust est indisponible.".into()),
                            };
                            match result {
                                Ok(None) => return,
                                Ok(Some(value)) => Ok(value),
                                Err(error) => Err(error),
                            }
                        }
                        Some("terminal") => terminals.action(request, &proxy),
                        Some("terminalCd") => terminal::cd(
                            Path::new(request["workspace"].as_str().unwrap_or_default()),
                            request["current"].as_str().unwrap_or("."),
                            request["target"].as_str().unwrap_or_default(),
                        ),
                        Some("versions") => {
                            let (proxy, profile, request) = (proxy.clone(), profile.clone(), request.clone());
                            std::thread::spawn(move || {
                                let _ = proxy.send_event(HostEvent::NativeReply(reply(id, versions::action(&profile, &request))));
                            });
                            return;
                        }
                        Some("agentCancel") => {
                            if let Some((run, stop)) = &running_agent {
                                if request.as_str() == Some(run.as_str()) { stop.store(true, Ordering::Release); }
                            }
                            Ok(Value::Null)
                        }
                        Some("agentRun") if running_agent.is_none() => {
                            if let (Some(run), Some(bridge)) = (request["run"].as_str(), backend.service()) {
                                let stop = Arc::new(AtomicBool::new(false));
                                let run = run.to_owned();
                                running_agent = Some((run.clone(), stop.clone()));
                                let (proxy, profile, request) = (proxy.clone(), profile.clone(), request.clone());
                                std::thread::spawn(move || {
                                    let result = agent::run(&profile, &request, &stop, |method, payload| bridge.call(&run, method, payload, &stop));
                                    let result = if stop.load(Ordering::Acquire) { Ok(json!({"completed":false,"interrupted":true})) } else { result };
                                    let _ = proxy.send_event(HostEvent::AgentEnded(reply(id, result)));
                                });
                                return;
                            }
                            Err("Service de l’agent indisponible.".into())
                        }
                        Some("agentRun") => Err("Une demande est déjà en cours.".into()),
                        _ => native(&window, &mut browser, &packet),
                    };
                    if let Err(error) = backend.send(&reply(id, result)) {
                        eprintln!("{error}");
                    }
                }
                Some("error") => {
                    let title = packet["title"].as_str().unwrap_or("FranceStudent IDE");
                    let message = packet["message"].as_str().unwrap_or("Le service de l’IDE a échoué.");
                    alert(Some(&window), title, message);
                }
                Some("quit") => {
                    check_close(&webview, &proxy, &mut pending_close);
                }
                _ => {}
            },
            Event::UserEvent(HostEvent::Disconnected) => {
                terminals.stop_all();
                if let Some((_, stop)) = &running_agent { stop.store(true, Ordering::Release); }
                if let Some(transport) = &account_transport { transport.close(); }
                backend.offline();
                deliver(&webview, json!({"kind": "offline", "error": "Le service local de l’IDE s’est arrêté. Relance la fenêtre."}));
            }
            Event::UserEvent(HostEvent::BrowserPage { generation, url, loading }) => {
                if let Some(state) = browser.page(generation, url, loading) {
                    deliver(&webview, json!({"kind": "event", "channel": "localBrowser", "data": state}));
                }
            }
            Event::UserEvent(HostEvent::BrowserTitle { generation, title }) => {
                if let Some(state) = browser.title(generation, title) {
                    deliver(&webview, json!({"kind": "event", "channel": "localBrowser", "data": state}));
                }
            }
            _ => {}
        }
    });
}

fn reply(id: Value, result: Result<Value>) -> Value {
    match result {
        Ok(value) => json!({"kind":"nativeReply","id":id,"ok":true,"value":value}),
        Err(error) => json!({"kind":"nativeReply","id":id,"ok":false,"error":error.to_string()}),
    }
}

fn check_close(
    webview: &WebView,
    proxy: &EventLoopProxy<HostEvent>,
    pending: &mut Option<Instant>,
) {
    if pending.is_some() {
        return;
    }
    let request = Instant::now();
    *pending = Some(request);
    let checked = proxy.clone();
    let callback = move |value: String| {
        let can_close = serde_json::from_str::<bool>(&value).ok();
        let _ = checked.send_event(HostEvent::CloseChecked(request, can_close));
    };
    if webview
        .evaluate_script_with_callback(
            "window.dispatchEvent(new Event('beforeunload', { cancelable: true }))",
            callback,
        )
        .is_err()
    {
        let _ = proxy.send_event(HostEvent::CloseChecked(request, None));
        return;
    }
    let timeout = proxy.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let _ = timeout.send_event(HostEvent::CloseChecked(request, None));
    });
}

fn confirm_close(window: &Window, can_close: Option<bool>) -> bool {
    let message = if can_close == Some(false) {
        "Des fichiers sont encore modifiés. Fermer l’IDE sans les enregistrer ?"
    } else {
        "Impossible de vérifier si les fichiers sont enregistrés. Fermer l’IDE quand même ?"
    };
    rfd::MessageDialog::new()
        .set_parent(window)
        .set_title("Fermer FranceStudent IDE")
        .set_description(message)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            "Fermer".into(),
            "Annuler".into(),
        ))
        .show()
        == rfd::MessageDialogResult::Custom("Fermer".into())
}

pub fn alert(window: Option<&Window>, title: &str, message: &str) {
    let mut dialog = rfd::MessageDialog::new()
        .set_title(title)
        .set_description(message)
        .set_level(rfd::MessageLevel::Error);
    if let Some(window) = window {
        dialog = dialog.set_parent(window);
    }
    dialog.show();
}

fn repo_root() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let working = std::env::current_dir()?;
    exe.ancestors()
        .chain(working.ancestors())
        .find(|dir| {
            dir.join("desktop/main.js").is_file()
                && dir.join("desktop/renderer/index.html").is_file()
        })
        .map(Path::to_path_buf)
        .ok_or_else(|| "Ouvre l’IDE Rust depuis le dossier source FranceStudent-Code.".into())
}

fn startup_script(capability: &str) -> Result<String> {
    let (platform, preload) = (
        if cfg!(target_os = "windows") {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        },
        include_str!("../../../../desktop/preload.js"),
    );
    let preload = preload.replace(
        r#"const { contextBridge, ipcRenderer } = require("electron");"#,
        "",
    );
    Ok(include_str!("preload-adapter.js")
        .replace(
            "__FRST_DOCUMENT__",
            &serde_json::to_string(DISPLAY_DOCUMENT)?,
        )
        .replace("__FRST_CAPABILITY__", &serde_json::to_string(capability)?)
        .replace("__FRST_PLATFORM__", &serde_json::to_string(platform)?)
        .replace("__FRST_PRELOAD__", &preload))
}

fn trusted_document(uri: &str) -> bool {
    uri == DISPLAY_DOCUMENT || uri == DOCUMENT
}

fn receive_ipc(req: Request<String>, capability: &str, proxy: &EventLoopProxy<HostEvent>) {
    if !trusted_document(&req.uri().to_string())
        || req.body().len() > crate::node_backend::MAX_MESSAGE
    {
        return;
    }
    let Ok(Value::Object(mut packet)) = serde_json::from_str::<Value>(req.body()) else {
        return;
    };
    if packet
        .remove("capability")
        .and_then(|value| value.as_str().map(str::to_owned))
        .as_deref()
        != Some(capability)
        || packet.get("id").and_then(Value::as_u64).is_none()
    {
        return;
    }
    if packet.get("kind").and_then(Value::as_str) == Some("motionReply") {
        let _ = proxy.send_event(HostEvent::MotionReply(Value::Object(packet)));
        return;
    }
    if packet.get("kind").and_then(Value::as_str) != Some("invoke")
        || !packet
            .get("channel")
            .and_then(Value::as_str)
            .is_some_and(|name| name.starts_with("frst:") && name.len() <= 100)
        || !packet.get("args").is_some_and(Value::is_array)
    {
        return;
    }
    let _ = proxy.send_event(HostEvent::Invoke(Value::Object(packet)));
}

fn deliver(webview: &WebView, packet: Value) {
    if let Ok(json) = serde_json::to_string(&packet).and_then(|json| serde_json::to_string(&json)) {
        let _ = webview.evaluate_script(&format!("window.__frstRustReceive?.({json})"));
    }
}

fn serve(root: &Path, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    fn response(status: StatusCode, mime: &str, content: Vec<u8>) -> Response<Cow<'static, [u8]>> {
        Response::builder()
            .status(status)
            .header("Content-Type", mime)
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .header(
                "Permissions-Policy",
                "camera=(), geolocation=(), microphone=(self)",
            )
            .header("Cache-Control", "no-cache")
            .body(Cow::Owned(content))
            .expect("En-têtes statiques valides")
    }

    let missing = || response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    if !matches!(req.method().as_str(), "GET" | "HEAD") {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    let Ok(path) = percent_decode_str(req.uri().path().trim_start_matches('/')).decode_utf8()
    else {
        return missing();
    };
    if path.contains(['\\', ':', '\0'])
        || path
            .split('/')
            .any(|part| part.is_empty() || part.starts_with('.'))
    {
        return missing();
    }
    let relative = Path::new(path.as_ref());
    if !relative
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
    {
        return missing();
    }
    let mime = match relative
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
    {
        "html" if path == "index.html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => return missing(),
    };
    let Ok(file) = root.join(relative).canonicalize() else {
        return missing();
    };
    if !file.starts_with(root) || !file.is_file() {
        return missing();
    }
    if req.method() == wry::http::Method::HEAD {
        return response(StatusCode::OK, mime, Vec::new());
    }
    match fs::read(file) {
        Ok(data) => response(StatusCode::OK, mime, data),
        Err(_) => missing(),
    }
}

fn native(window: &Window, browser: &mut Browser, message: &Value) -> Result<Value> {
    let payload = &message["payload"];
    match message["method"].as_str() {
        Some("browser") => browser.action(window, payload),
        Some("openDialog" | "saveDialog") => {
            let mut dialog = rfd::FileDialog::new().set_parent(window);
            if let Some(title) = payload["title"].as_str() {
                dialog = dialog.set_title(title);
            }
            let save = message["method"] == "saveDialog";
            if let Some(default) = payload["defaultPath"].as_str() {
                let path = Path::new(default);
                if save {
                    if let Some(parent) = path.parent().filter(|parent| parent.is_dir()) {
                        dialog = dialog.set_directory(parent);
                    }
                    if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                        dialog = dialog.set_file_name(name);
                    }
                } else {
                    dialog = dialog.set_directory(path);
                }
            }
            if let Some(filters) = payload["filters"].as_array() {
                for filter in filters {
                    let extensions: Vec<_> = filter["extensions"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect();
                    if let Some(name) = filter["name"].as_str() {
                        dialog = dialog.add_filter(name, &extensions);
                    }
                }
            }
            if save {
                let path = dialog.save_file();
                return Ok(json!({ "canceled": path.is_none(), "filePath": path }));
            }
            let properties = payload["properties"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            let files: Vec<PathBuf> = if properties
                .iter()
                .any(|property| property == "openDirectory")
            {
                dialog.pick_folder().into_iter().collect()
            } else if properties
                .iter()
                .any(|property| property == "multiSelections")
            {
                dialog.pick_files().unwrap_or_default()
            } else {
                dialog.pick_file().into_iter().collect()
            };
            Ok(json!({ "canceled": files.is_empty(), "filePaths": files }))
        }
        Some("clipboard") => {
            arboard::Clipboard::new()?.set_text(
                payload
                    .as_str()
                    .ok_or("Texte du presse-papiers manquant.")?,
            )?;
            Ok(Value::Null)
        }
        Some("openExternal") => {
            let url = url::Url::parse(payload.as_str().ok_or("Adresse manquante.")?)?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Adresse refusée.".into());
            }
            open::that_detached(url.as_str())?;
            Ok(Value::Null)
        }
        Some("openPath" | "reveal" | "trash") => {
            let path = Path::new(payload.as_str().ok_or("Chemin manquant.")?);
            if !path.is_absolute() {
                return Err("Chemin absolu attendu.".into());
            }
            match message["method"].as_str() {
                Some("trash") => trash::delete(path)?,
                Some("reveal") if !path.is_dir() => {
                    open::that_detached(path.parent().ok_or("Dossier parent introuvable.")?)?
                }
                _ => open::that_detached(path)?,
            }
            Ok(Value::Null)
        }
        Some("fullscreen") => {
            let enabled = payload.as_bool().ok_or("État plein écran manquant.")?;
            window.set_fullscreen(enabled.then_some(Fullscreen::Borderless(None)));
            Ok(json!(enabled))
        }
        _ => Err("Action système indisponible dans l’IDE Rust.".into()),
    }
}
