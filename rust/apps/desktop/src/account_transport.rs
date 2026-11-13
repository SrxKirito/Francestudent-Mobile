use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{
    Client, Method, Url,
    header::{ACCEPT_ENCODING, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue, SET_COOKIE},
    redirect::Policy,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    runtime::{Builder, Runtime},
    sync::{mpsc, oneshot},
};
use uuid::Uuid;

use super::{Result, reply};
use crate::node_backend::ServiceBridge;

const API: &str = "https://api.francestudent.ai";
const TOKEN_URL: &str = "https://ia.francestudent.org/api/auth/api-token";
const CHUNK_BYTES: usize = 64 * 1024;

pub struct AccountTransport {
    client: Client,
    runtime: Runtime,
    requests: Arc<Mutex<HashMap<Uuid, RequestHandle>>>,
}

struct RequestHandle {
    pull: mpsc::Sender<Value>,
    _cancel: oneshot::Sender<()>,
}

#[derive(Deserialize)]
struct OpenRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

impl AccountTransport {
    pub fn new() -> Result<Self> {
        let runtime = Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .thread_name("frst-account")
            .build()?;
        let client = Client::builder()
            .use_native_tls()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(310))
            .build()
            .map_err(|_| "Le transport réseau Rust n’a pas pu être initialisé.")?;
        Ok(Self {
            client,
            runtime,
            requests: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn invoke(
        &self,
        id: &Value,
        payload: &Value,
        bridge: ServiceBridge,
    ) -> Result<Option<Value>> {
        let request_id = payload["request"]
            .as_str()
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or("Identifiant de transport invalide.")?;
        let mut active = self
            .requests
            .lock()
            .map_err(|_| "Le transport réseau Rust est indisponible.")?;
        match payload["action"].as_str() {
            Some("open") => {
                if active.contains_key(&request_id) {
                    return Err("Cette requête de transport existe déjà.".into());
                }
                let request: OpenRequest =
                    serde_json::from_value(payload["requestOptions"].clone())
                        .map_err(|_| "Requête de transport invalide.")?;
                let (request, token_request) = self.prepare(request)?;
                let (sender, pull) = mpsc::channel(1);
                let (cancel, stop) = oneshot::channel();
                active.insert(
                    request_id,
                    RequestHandle {
                        pull: sender,
                        _cancel: cancel,
                    },
                );
                let (requests, id) = (Arc::clone(&self.requests), id.clone());
                self.runtime.spawn(async move {
                    let emit = move |packet| {
                        tokio::task::block_in_place(|| bridge.send_reply(&packet).is_ok())
                    };
                    pump(request, token_request, id, pull, stop, emit).await;
                    if let Ok(mut active) = requests.lock() {
                        active.remove(&request_id);
                    }
                });
                Ok(None)
            }
            Some("pull") => {
                active
                    .get(&request_id)
                    .ok_or("Réponse de transport fermée.")?
                    .pull
                    .try_send(id.clone())
                    .map_err(|_| "Lecture de transport indisponible.")?;
                Ok(None)
            }
            Some("close") => {
                active.remove(&request_id);
                Ok(Some(Value::Null))
            }
            _ => Err("Action de transport inconnue.".into()),
        }
    }

    pub fn close(&self) {
        if let Ok(mut active) = self.requests.lock() {
            active.clear();
        }
    }

    fn prepare(&self, request: OpenRequest) -> Result<(reqwest::RequestBuilder, bool)> {
        let url = Url::parse(&request.url).map_err(|_| "Adresse de transport invalide.")?;
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|_| "Méthode de transport invalide.")?;
        let token_request = url.as_str() == TOKEN_URL && method == Method::GET;
        if !token_request && !allowed_api_route(&url, &method) {
            return Err("Adresse de transport FranceStudent refusée.".into());
        }
        let mut headers = HeaderMap::new();
        for (name, value) in request.headers {
            if !matches!(
                name.as_str(),
                "accept"
                    | "content-type"
                    | "user-agent"
                    | "origin"
                    | "referer"
                    | "francestudent-client-platform"
                    | "francestudent-client-version"
                    | "francestudent-device-id"
            ) && !(token_request && name == "cookie")
                && !(!token_request && name == "authorization")
            {
                return Err("En-tête de transport invalide.".into());
            }
            let mut value = HeaderValue::from_str(&value)
                .map_err(|_| "Valeur d’en-tête de transport invalide.")?;
            value.set_sensitive(matches!(name.as_str(), "cookie" | "authorization"));
            headers.insert(HeaderName::from_bytes(name.as_bytes())?, value);
        }
        let mut builder = self
            .client
            .request(method, url)
            .headers(headers)
            .header(ACCEPT_ENCODING, "identity");
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        Ok((builder, token_request))
    }
}

fn allowed_api_route(url: &Url, method: &Method) -> bool {
    if url.origin().ascii_serialization() != API
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let Some(path) = url.path_segments().map(Iterator::collect::<Vec<_>>) else {
        return false;
    };
    let is_id = |id: &str| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    };
    match path.as_slice() {
        ["chats" | "user", ..] if method == Method::GET => match path.as_slice() {
            ["chats"] => url
                .query_pairs()
                .all(|(key, _)| matches!(key.as_ref(), "limit" | "sortedBy" | "cursor_chat_id")),
            ["chats", "agents"] => url.query().is_none(),
            ["chats", id] | ["chats", id, "usage"] => is_id(id) && url.query().is_none(),
            ["chats", id, "stream"] => {
                is_id(id)
                    && url
                        .query_pairs()
                        .all(|(key, value)| key == "last_event_id" && value.len() <= 4096)
            }
            ["chats", id, "messages", message, "images", image] => {
                is_id(id) && is_id(message) && is_id(image) && url.query().is_none()
            }
            ["user", "instructions" | "me" | "usage"] => url.query().is_none(),
            ["user", "tokenusage"] => url.query_pairs().all(|(key, _)| key == "tokenUsageDays"),
            _ => false,
        },
        ["chats", "stream"] => method == Method::POST && url.query().is_none(),
        ["chats", id, "stream", "cancel"] => {
            method == Method::POST && is_id(id) && url.query().is_none()
        }
        _ => false,
    }
}

async fn pump(
    request: reqwest::RequestBuilder,
    token_request: bool,
    open_id: Value,
    mut pull: mpsc::Receiver<Value>,
    mut stop: oneshot::Receiver<()>,
    emit: impl Fn(Value) -> bool,
) {
    let send = |id, result| emit(reply(id, result));
    let result = tokio::select! {
        biased;
        _ = &mut stop => Err("Requête de transport interrompue."),
        response = request.send() => response.map_err(|_| "Impossible de joindre le service FranceStudent."),
    };
    let mut response = match result {
        Ok(response) => response,
        Err(error) => {
            send(open_id, Err(error.into()));
            return;
        }
    };
    let status = response.status().as_u16();
    let mut headers = Vec::new();
    if let Some(value) = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    {
        headers.push(("content-type", value));
    }
    if token_request {
        for value in response.headers().get_all(SET_COOKIE) {
            if let Ok(value) = value.to_str() {
                headers.push(("set-cookie", value));
            }
        }
    }
    let no_body = matches!(status, 204 | 205 | 304);
    if !send(
        open_id,
        Ok(json!({"status":status, "headers":headers, "noBody":no_body})),
    ) || no_body
    {
        return;
    }
    let mut buffered = None;
    loop {
        let Some(pull_id) = pull.recv().await else {
            break;
        };
        let result = match buffered.take() {
            Some(bytes) => Ok(Some(bytes)),
            None => tokio::select! {
                biased;
                _ = &mut stop => Err("Réponse de transport interrompue."),
                bytes = response.chunk() => bytes.map_err(|_| "La connexion à FranceStudent a été interrompue."),
            },
        };
        match result {
            Ok(Some(mut bytes)) => {
                let chunk = bytes.split_to(CHUNK_BYTES.min(bytes.len()));
                if !bytes.is_empty() {
                    buffered = Some(bytes);
                }
                if !send(pull_id, Ok(json!(STANDARD.encode(chunk)))) {
                    break;
                }
            }
            Ok(None) => {
                send(pull_id, Ok(Value::Null));
                break;
            }
            Err(error) => {
                send(pull_id, Err(error.into()));
                break;
            }
        }
    }
}
