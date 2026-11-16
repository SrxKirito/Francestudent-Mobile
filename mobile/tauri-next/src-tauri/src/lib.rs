use francestudent_api::{
    models::{ChatCreate, ChatDetail, ChatHistory, ChatMessageRequest, Project},
    sse::Parser,
    ApiClient,
};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::ipc::Channel;
use tauri::{Emitter, State};
use tauri_plugin_secure_keystore::{ItemKey, SecureKeystoreExt, SetItemRequest};
use uuid::Uuid;

#[derive(Default)]
struct AppState {
    api: Mutex<Option<Arc<ApiClient>>>,
    streaming: AtomicBool,
    transfers: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
    uploads: Mutex<HashMap<String, Upload>>,
}

#[derive(Clone)]
struct Upload {
    chunks: tokio::sync::mpsc::Sender<Vec<u8>>,
    cancelled: tokio::sync::watch::Sender<bool>,
    received: Arc<AtomicU64>,
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum UploadEvent {
    Ready,
}

struct UploadGuard<'a> {
    state: &'a AppState,
    id: String,
}
impl Drop for UploadGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut uploads) = self.state.uploads.lock() {
            uploads.remove(&self.id);
        }
    }
}

fn supports_mime(supported: &[String], mime: &str) -> bool {
    let mime = mime.to_ascii_lowercase();
    !mime.is_empty()
        && supported.iter().any(|item| {
            let item = item.to_ascii_lowercase();
            item == mime
                || item == "*/*"
                || item
                    .strip_suffix("/*")
                    .is_some_and(|prefix| mime.starts_with(&format!("{prefix}/")))
        })
}

#[tauri::command]
async fn upload_begin(
    state: State<'_, AppState>,
    id: String,
    token: String,
    name: String,
    mime: String,
    size: u64,
    kind: String,
    on_event: Channel<UploadEvent>,
) -> Result<Value, String> {
    Uuid::parse_str(&id).map_err(|_| "Identifiant de transfert invalide")?;
    if name.is_empty() || name.len() > 1024 {
        return Err("Nom de fichier invalide.".into());
    }
    let api = ApiClient::new(&format!("Bearer {token}")).map_err(|e| e.to_string())?;
    match kind.as_str() {
        "file" => {
            let supported = api
                .supported_mime_types()
                .await
                .map_err(|e| e.to_string())?;
            if !supports_mime(&supported, &mime) {
                return Err("Ce type de fichier n'est pas accepté par le serveur.".into());
            }
        }
        "skill" => (),
        _ => return Err("Type de transfert non pris en charge.".into()),
    }
    let (chunks, receiver) = tokio::sync::mpsc::channel::<Vec<u8>>(2);
    let (cancelled, mut cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut uploads = state.uploads.lock().map_err(|_| "Transfert indisponible")?;
        if uploads.contains_key(&id) {
            return Err("Transfert déjà actif.".into());
        }
        uploads.insert(
            id.clone(),
            Upload {
                chunks,
                cancelled: cancelled.clone(),
                received: Arc::new(AtomicU64::new(0)),
                size,
            },
        );
    }
    let _guard = UploadGuard { state: &state, id };
    on_event
        .send(UploadEvent::Ready)
        .map_err(|e| e.to_string())?;
    let stream = tokio_stream::wrappers::ReceiverStream::new(receiver)
        .map(|bytes| Ok::<_, std::io::Error>(bytes::Bytes::from(bytes)));
    let upload = async {
        if kind == "skill" {
            api.upload_skill_stream(name, &mime, size, stream).await
        } else {
            api.upload_stream(name, &mime, size, stream).await
        }
    };
    tokio::select! {
        result = upload => result.map_err(|e| e.to_string()),
        _ = cancel_rx.changed() => Err("Transfert annulé.".into()),
    }
}

#[tauri::command]
async fn upload_chunk(
    state: State<'_, AppState>,
    id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 256 * 1024 {
        return Err("Bloc de transfert invalide.".into());
    }
    let upload = state
        .uploads
        .lock()
        .map_err(|_| "Transfert indisponible")?
        .get(&id)
        .cloned()
        .ok_or("Transfert terminé ou annulé.")?;
    upload
        .received
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |old| {
            old.checked_add(bytes.len() as u64)
                .filter(|&total| total <= upload.size)
        })
        .map_err(|_| "La taille annoncée a été dépassée.")?;
    upload
        .chunks
        .send(bytes)
        .await
        .map_err(|_| "Transfert interrompu.".into())
}

#[tauri::command]
fn upload_finish(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut uploads = state.uploads.lock().map_err(|_| "Transfert indisponible")?;
    let upload = uploads.get(&id).ok_or("Transfert terminé ou annulé.")?;
    if upload.received.load(Ordering::Acquire) != upload.size {
        return Err("Le fichier n'a pas été entièrement transmis.".into());
    }
    uploads.remove(&id);
    Ok(())
}

#[tauri::command]
fn upload_cancel(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(upload) = state
        .uploads
        .lock()
        .map_err(|_| "Transfert indisponible")?
        .remove(&id)
    {
        let _ = upload.cancelled.send(true);
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TransportEvent {
    Started {
        status: u16,
        content_type: Option<String>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    Finished,
}

#[tauri::command]
async fn legacy_exchange(session: String, device_id: String) -> Result<Value, String> {
    francestudent_api::exchange_session(&session, &device_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn legacy_login(
    input: francestudent_api::login::LoginRequest,
) -> Result<francestudent_api::login::LoginResponse, String> {
    francestudent_api::login::request(input)
        .await
        .map_err(|e| e.to_string())
}

const SESSION_KEY: &str = "france-student-session";

#[tauri::command]
async fn session_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.secure_keystore()
        .get_item(ItemKey {
            key: SESSION_KEY.into(),
        })
        .map(|result| result.value)
        .map_err(|_| "Stockage sécurisé indisponible.".into())
}

#[tauri::command]
async fn session_write(app: tauri::AppHandle, value: String) -> Result<(), String> {
    if value.is_empty() || value.len() > 16384 {
        return Err("Session invalide.".into());
    }
    app.secure_keystore()
        .set_item(SetItemRequest {
            key: SESSION_KEY.into(),
            value,
        })
        .map_err(|_| "Écriture de la session impossible.".into())
}

#[tauri::command]
async fn session_delete(app: tauri::AppHandle) -> Result<(), String> {
    app.secure_keystore()
        .delete_item(ItemKey {
            key: SESSION_KEY.into(),
        })
        .map_err(|_| "Suppression de la session impossible.".into())
}

struct TransferGuard<'a> {
    state: &'a AppState,
    id: String,
}
impl Drop for TransferGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut transfers) = self.state.transfers.lock() {
            transfers.remove(&self.id);
        }
    }
}

#[tauri::command]
async fn legacy_request(
    state: State<'_, AppState>,
    id: String,
    token: String,
    method: String,
    path: String,
    accept: String,
    body: Option<String>,
    on_event: Channel<TransportEvent>,
) -> Result<(), String> {
    Uuid::parse_str(&id).map_err(|_| "Identifiant de requête invalide")?;
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    {
        let mut transfers = state
            .transfers
            .lock()
            .map_err(|_| "Transfert indisponible")?;
        if transfers.contains_key(&id) {
            return Err("Requête déjà active".into());
        }
        transfers.insert(id.clone(), cancel);
    }
    let _guard = TransferGuard { state: &state, id };
    let api = ApiClient::new(&format!("Bearer {token}")).map_err(|e| e.to_string())?;
    let response = tokio::select! {
        result = api.compatibility_request(&method, &path, &accept, body) => result.map_err(|e| e.to_string())?,
        _ = cancelled.changed() => return Ok(()),
    };
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    on_event
        .send(TransportEvent::Started {
            status,
            content_type,
        })
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            next = stream.next() => next,
            _ = cancelled.changed() => return Ok(()),
        };
        match next {
            Some(Ok(bytes)) => on_event
                .send(TransportEvent::Chunk {
                    bytes: bytes.to_vec(),
                })
                .map_err(|e| e.to_string())?,
            Some(Err(error)) => return Err(error.to_string()),
            None => break,
        }
    }
    on_event
        .send(TransportEvent::Finished)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn legacy_cancel(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let transfers = state
        .transfers
        .lock()
        .map_err(|_| "Transfert indisponible")?;
    if let Some(cancel) = transfers.get(&id) {
        let _ = cancel.send(true);
    }
    Ok(())
}

fn client(state: &AppState) -> Result<Arc<ApiClient>, String> {
    state
        .api
        .lock()
        .map_err(|_| "Session indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Connecte-toi d'abord.".to_owned())
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, authorization: String) -> Result<Vec<Value>, String> {
    let api = Arc::new(ApiClient::new(authorization.trim()).map_err(|e| e.to_string())?);
    let agents = api.agents().await.map_err(|e| e.to_string())?;
    *state.api.lock().map_err(|_| "Session indisponible")? = Some(api);
    Ok(agents)
}

#[tauri::command]
async fn list_chats(
    state: State<'_, AppState>,
    cursor: Option<Uuid>,
) -> Result<ChatHistory, String> {
    client(&state)?
        .chats(50, cursor)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_chat(state: State<'_, AppState>, id: Uuid) -> Result<ChatDetail, String> {
    client(&state)?.chat(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    client(&state)?.projects().await.map_err(|e| e.to_string())
}

struct StreamGuard<'a>(&'a AtomicBool);
impl Drop for StreamGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
async fn generate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    chat_id: Option<Uuid>,
    agent_id: i32,
    content: String,
    files: Vec<String>,
    web_search: bool,
) -> Result<(), String> {
    if state
        .streaming
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Une réponse est déjà en cours.".into());
    }
    let _guard = StreamGuard(&state.streaming);
    let api = client(&state)?;
    let response = if let Some(id) = chat_id {
        api.send_message(
            id,
            &ChatMessageRequest {
                content,
                agent_id: Some(agent_id),
                images: vec![],
                files,
                enable_web_search: web_search,
            },
        )
        .await
    } else {
        api.create_chat(&ChatCreate {
            agent_id,
            initial_content: Some(content),
            project_id: None,
            images: vec![],
            files,
            enable_web_search: web_search,
        })
        .await
    }
    .map_err(|e| e.to_string())?;
    relay(app, response).await
}

async fn relay(app: tauri::AppHandle, response: reqwest::Response) -> Result<(), String> {
    let mut bytes = response.bytes_stream();
    let mut parser = Parser::default();
    while let Some(chunk) = bytes.next().await {
        for event in parser
            .feed(&chunk.map_err(|e| e.to_string())?)
            .map_err(str::to_owned)?
        {
            let terminal = matches!(event.event.as_str(), "completed" | "error" | "cancelled");
            app.emit("chat-stream", &event).map_err(|e| e.to_string())?;
            if terminal {
                return Ok(());
            }
        }
    }
    Err("Le flux a été interrompu avant la confirmation du serveur. Recharge la conversation avant de réessayer.".into())
}

#[tauri::command]
async fn cancel_generation(state: State<'_, AppState>, id: Uuid) -> Result<(), String> {
    client(&state)?
        .cancel_stream(id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_secure_keystore::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            list_chats,
            get_chat,
            list_projects,
            generate,
            cancel_generation,
            legacy_exchange,
            legacy_login,
            session_read,
            session_write,
            session_delete,
            legacy_request,
            legacy_cancel,
            upload_begin,
            upload_chunk,
            upload_finish,
            upload_cancel
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de France Student");
}

#[cfg(test)]
mod tests {
    use super::supports_mime;

    #[test]
    fn mime_types_are_checked_against_the_server_list() {
        let types = vec!["application/pdf".to_owned(), "image/*".to_owned()];
        assert!(supports_mime(&types, "application/pdf"));
        assert!(supports_mime(&types, "image/png"));
        assert!(!supports_mime(&types, "application/octet-stream"));
        assert!(!supports_mime(&types, ""));
    }
}
