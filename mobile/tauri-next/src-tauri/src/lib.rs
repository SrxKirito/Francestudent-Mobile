use francestudent_api::{
    models::{ChatCreate, ChatDetail, ChatHistory, ChatMessageRequest, Project},
    sse::Parser,
    ApiClient,
};
use futures_util::StreamExt;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, State};
use uuid::Uuid;

#[derive(Default)]
struct AppState {
    api: Mutex<Option<Arc<ApiClient>>>,
    streaming: AtomicBool,
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
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            list_chats,
            get_chat,
            list_projects,
            generate,
            cancel_generation
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de France Student");
}
