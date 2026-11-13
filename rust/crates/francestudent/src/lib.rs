use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{
    Client, Method, Response, StatusCode, Url,
    header::{ACCEPT, COOKIE, HeaderMap, HeaderValue, ORIGIN, REFERER, SET_COOKIE},
    redirect::Policy,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

mod attachments;
mod image_generation;
mod login;
mod mobile;
pub use attachments::{AttachmentUpload, MAX_ATTACHMENT_BYTES, UploadedAttachments};
pub use image_generation::{GeneratedImage, ImageModel, ImageProgress};
pub use mobile::{GeneralSettings, Project, WebDomainSettings, WebFilterType, WebSearchMode};

const SITE: &str = "https://ia.francestudent.org";
const API: &str = "https://api.francestudent.ai";
const COOKIE_NAME: &str = "next-auth.session-token";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Saisis une valeur valide pour le cookie de session FranceStudent.")]
    InvalidSession,
    #[error("Session refusée ou expirée. Reconnecte-toi avec un cookie valide.")]
    Unauthorized,
    #[error("{0}")]
    Login(&'static str),
    #[error("Le service FranceStudent a répondu avec le code HTTP {0}.")]
    Http(StatusCode),
    #[error("Impossible de joindre le service FranceStudent.")]
    Network,
    #[error("La réponse de FranceStudent est illisible.")]
    InvalidResponse,
    #[error("Aucun modèle disponible pour ce compte.")]
    NoModels,
    #[error("La réponse a été interrompue. Vérifie la discussion avant de renvoyer le message.")]
    Interrupted,
    #[error("Le service a signalé un échec de la génération.")]
    GenerationFailed,
}

#[derive(Clone)]
pub struct FranceStudent {
    http: Client,
    auth: Arc<Mutex<Auth>>,
    device: String,
    session_sink: Option<SessionSink>,
}

type SessionSink = Arc<dyn Fn(&str) + Send + Sync>;

struct Auth {
    cookie: HeaderValue,
    token: Option<Token>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Token {
    access_token: String,
    expires_at: Option<u64>,
    expires_in: Option<u64>,
}

#[derive(Clone, PartialEq)]
pub struct Model {
    pub id: i64,
    pub name: String,
    pub preferred: bool,
}

#[derive(Clone, PartialEq)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: Option<i64>,
    pub project: Option<String>,
    pub pinned: bool,
}

#[derive(Clone, PartialEq)]
pub struct Message {
    pub role: Role,
    pub text: String,
    pub images: Vec<GeneratedImage>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Clone, Default, PartialEq)]
pub struct StreamProgress {
    pub chat_id: Option<String>,
    pub cursor: Option<String>,
    pub text: String,
    pub images: Vec<GeneratedImage>,
    pub image_progress: ImageProgress,
}

impl StreamProgress {
    pub fn can_resume(&self) -> bool {
        self.chat_id.is_some() && self.cursor.is_some()
    }
}

impl FranceStudent {
    pub async fn login_cookie(email: &str, password: String) -> Result<String, Error> {
        login::login_cookie(email, password).await
    }

    pub fn with_session_sink(mut self, sink: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.session_sink = Some(Arc::new(sink));
        self
    }

    pub async fn session_value(&self) -> Option<String> {
        self.auth
            .lock()
            .await
            .cookie
            .to_str()
            .ok()?
            .split(';')
            .next()?
            .split_once('=')
            .map(|(_, value)| value.to_owned())
    }

    pub fn new(raw_session: &str) -> Result<Self, Error> {
        let device = uuid::Uuid::new_v4().to_string();
        let cookie = session_cookie(raw_session, &device)?;
        let http = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(120))
            .user_agent("FranceStudent-Rust/0.1")
            .build()
            .map_err(|_| Error::Network)?;
        Ok(Self {
            http,
            auth: Arc::new(Mutex::new(Auth {
                cookie,
                token: None,
            })),
            device,
            session_sink: None,
        })
    }

    pub async fn models(&self) -> Result<Vec<Model>, Error> {
        let data = self.get_json(&["chats", "agents"], &[]).await?;
        let models: Vec<_> = list(&data, "agents")
            .iter()
            .filter_map(|item| {
                let id = integer(&item["id"])?;
                if item["isActive"].as_bool() == Some(false) {
                    return None;
                }
                Some(Model {
                    id,
                    name: string(&item["name"])
                        .or_else(|| string(&item["model"]))
                        .unwrap_or_else(|| id.to_string()),
                    preferred: item["isDefault"].as_bool().unwrap_or(false),
                })
            })
            .collect();
        if models.is_empty() {
            return Err(Error::NoModels);
        }
        Ok(models)
    }

    pub async fn conversations(&self) -> Result<Vec<Conversation>, Error> {
        let data = self
            .get_json(
                &["chats"],
                &[("limit", "100"), ("sortedBy", "lastMessageAt")],
            )
            .await?;
        let mut chats: Vec<_> = list(&data, "chats")
            .iter()
            .filter_map(|item| {
                Some(Conversation {
                    id: string(&item["id"])?,
                    title: string(&item["title"]).unwrap_or_else(|| "Sans titre".into()),
                    model: integer(&item["agent"]["id"]),
                    project: string(&item["projectId"]),
                    pinned: item["isPinned"].as_bool().unwrap_or(false),
                })
            })
            .collect();
        chats.sort_by_key(|chat| !chat.pinned);
        Ok(chats)
    }

    pub async fn messages(&self, id: &str) -> Result<Vec<Message>, Error> {
        let data = self.get_json(&["chats", id], &[]).await?;
        let mut messages = Vec::new();
        for item in list(&data, "chatMessages") {
            let role = match item["role"]
                .as_str()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .as_str()
            {
                "user" => Role::User,
                "assistant" => Role::Assistant,
                _ => continue,
            };
            let text = message_text(item);
            let (mut images, references) = image_generation::images_for_message(item);
            if uuid::Uuid::parse_str(id).is_ok() {
                self.resolve_images(id, &references, &mut images).await;
            }
            if !text.is_empty() || !images.is_empty() {
                messages.push((
                    item["createdAt"].as_str().unwrap_or(""),
                    Message { role, text, images },
                ));
            }
        }
        messages.sort_by_key(|(time, _)| *time);
        Ok(messages.into_iter().map(|(_, message)| message).collect())
    }

    pub async fn send(
        &self,
        model: i64,
        chat: Option<&Conversation>,
        prompt: &str,
        search: bool,
        update: impl FnMut(&StreamProgress),
    ) -> Result<(), Error> {
        self.send_in_project(model, chat, None, prompt, search, update)
            .await
    }

    pub async fn send_in_project(
        &self,
        model: i64,
        chat: Option<&Conversation>,
        project: Option<&str>,
        prompt: &str,
        search: bool,
        update: impl FnMut(&StreamProgress),
    ) -> Result<(), Error> {
        self.send_with_attachments(
            model,
            chat,
            project,
            prompt,
            search,
            UploadedAttachments::default(),
            update,
        )
        .await
    }

    pub async fn send_with_attachments(
        &self,
        model: i64,
        chat: Option<&Conversation>,
        project: Option<&str>,
        prompt: &str,
        search: bool,
        attachments: UploadedAttachments,
        update: impl FnMut(&StreamProgress),
    ) -> Result<(), Error> {
        let mut body = json!({
            "agentId": model,
            "chatId": chat.map(|entry| &entry.id),
            "initialContent": prompt,
            "enableCanvas": false,
            "enableWebSearch": search,
            "images": attachments.images,
            "isIncognito": false,
            "isPrivate": false
        });
        let project = match chat {
            Some(entry) => entry.project.as_deref(),
            None => project,
        };
        if let Some(project) = project {
            body["projectId"] = json!(project);
        }
        if !attachments.files.is_empty() {
            body["files"] = json!(attachments.files);
        }
        let response = self
            .request(
                Method::POST,
                &["chats", "stream"],
                &[],
                Some(&body),
                "text/event-stream",
            )
            .await?;
        read_stream(
            response,
            StreamProgress {
                chat_id: chat.map(|entry| entry.id.clone()),
                ..StreamProgress::default()
            },
            update,
        )
        .await
    }

    /// Une étape interne de l’agent. Elle ne doit pas créer d’entrée dans
    /// l’historique du chat ni apparaître comme un message de l’utilisateur.
    pub async fn agent_prompt(
        &self,
        model: i64,
        prompt: &str,
        update: impl FnMut(&StreamProgress),
    ) -> Result<(), Error> {
        let body = json!({
            "agentId": model, "chatId": null, "initialContent": prompt,
            "enableCanvas": false, "enableWebSearch": false, "images": [],
            "isIncognito": true, "isPrivate": true
        });
        let response = self
            .request(
                Method::POST,
                &["chats", "stream"],
                &[],
                Some(&body),
                "text/event-stream",
            )
            .await?;
        read_stream(response, StreamProgress::default(), update).await
    }

    pub async fn resume(
        &self,
        progress: StreamProgress,
        update: impl FnMut(&StreamProgress),
    ) -> Result<(), Error> {
        let (Some(id), Some(cursor)) = (&progress.chat_id, &progress.cursor) else {
            return Err(Error::Interrupted);
        };
        let response = self
            .request(
                Method::GET,
                &["chats", id, "stream"],
                &[("last_event_id", cursor)],
                None,
                "text/event-stream",
            )
            .await?;
        read_stream(response, progress, update).await
    }

    pub async fn cancel(&self, id: &str) -> Result<(), Error> {
        self.request(
            Method::POST,
            &["chats", id, "stream", "cancel"],
            &[],
            None,
            "application/json",
        )
        .await?;
        Ok(())
    }

    async fn get_json(&self, path: &[&str], query: &[(&str, &str)]) -> Result<Value, Error> {
        self.request(Method::GET, path, query, None, "application/json")
            .await?
            .json()
            .await
            .map_err(|_| Error::InvalidResponse)
    }

    async fn request(
        &self,
        method: Method,
        path: &[&str],
        query: &[(&str, &str)],
        body: Option<&Value>,
        accept: &str,
    ) -> Result<Response, Error> {
        let mut url = Url::parse(API).expect("URL fixe valide");
        url.path_segments_mut()
            .expect("URL HTTP hiérarchique")
            .extend(path);
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        let token = self.token(false).await?;
        let send = |token: String| async {
            let mut request = self
                .headers(self.http.request(method.clone(), url.clone()))
                .bearer_auth(token)
                .header(ORIGIN, SITE)
                .header(ACCEPT, accept);
            if let Some(body) = body {
                request = request.json(body);
            }
            request.send().await.map_err(|_| Error::Network)
        };
        let response = send(token).await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            // Le serveur a rejeté l’authentification avant le traitement.
            return checked(send(self.token(true).await?).await?);
        }
        checked(response)
    }

    fn headers(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder
            .header("francestudent-client-platform", "web_fs_ai")
            .header("francestudent-client-version", "4005601")
            .header("francestudent-device-id", &self.device)
            .header(REFERER, "https://ia.francestudent.org/")
    }

    async fn token(&self, refresh: bool) -> Result<String, Error> {
        let mut auth = self.auth.lock().await;
        if !refresh {
            if let Some(token) = &auth.token {
                if token.expires_at.unwrap_or(0) > now().saturating_add(60) {
                    return Ok(token.access_token.clone());
                }
            }
        }
        let response = self
            .headers(self.http.get(format!("{SITE}/api/auth/api-token")))
            .header(COOKIE, auth.cookie.clone())
            .send()
            .await
            .map_err(|_| Error::Network)?;
        let response = checked(response)?;
        let renewed = session_from_headers(response.headers());
        let mut token: Token = response.json().await.map_err(|_| Error::Unauthorized)?;
        if token.access_token.is_empty() {
            return Err(Error::Unauthorized);
        }
        token.expires_at = Some(
            token
                .expires_at
                .unwrap_or_else(|| now().saturating_add(token.expires_in.unwrap_or(300))),
        );
        let access = token.access_token.clone();
        if let Some(renewed) = renewed {
            let cookie = session_cookie(&renewed, &self.device)?;
            if cookie != auth.cookie {
                auth.cookie = cookie;
                if let Some(sink) = &self.session_sink {
                    sink(&renewed);
                }
            }
        }
        auth.token = Some(token);
        Ok(access)
    }
}

fn session_cookie(raw_session: &str, device: &str) -> Result<HeaderValue, Error> {
    let session = raw_session.trim().trim_matches(['\'', '"']);
    let session = session
        .strip_prefix("next-auth.session-token=")
        .or_else(|| session.strip_prefix("__Secure-next-auth.session-token="))
        .unwrap_or(session)
        .trim();
    if session.is_empty()
        || session.len() > 32 * 1024
        || !session.bytes().all(|byte| {
            (0x21..=0x7e).contains(&byte) && !matches!(byte, b';' | b',' | b'"' | b'\\')
        })
    {
        return Err(Error::InvalidSession);
    }
    let mut cookie = HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={session}; francestudent-device-id={device}"
    ))
    .map_err(|_| Error::InvalidSession)?;
    cookie.set_sensitive(true);
    Ok(cookie)
}

fn session_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| {
            let mut parts = value.to_str().ok()?.split(';');
            let (name, cookie) = parts.next()?.split_once('=')?;
            let cookie = cookie.trim();
            if !matches!(
                name.trim(),
                COOKIE_NAME | "__Secure-next-auth.session-token"
            ) || parts.any(|attr| {
                attr.trim().split_once('=').is_some_and(|(key, value)| {
                    key.eq_ignore_ascii_case("max-age")
                        && value.trim().parse::<i64>().is_ok_and(|age| age <= 0)
                })
            }) || session_cookie(cookie, "").is_err()
            {
                return None;
            }
            Some(cookie.to_owned())
        })
        .last()
}

fn checked(response: Response) -> Result<Response, Error> {
    if response
        .headers()
        .get("cf-mitigated")
        .is_some_and(|value| value == "challenge")
    {
        return Err(Error::Login(
            "La connexion est bloquée par une vérification du service FranceStudent.",
        ));
    }
    match response.status() {
        status if status.is_success() => Ok(response),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(Error::Unauthorized),
        status => Err(Error::Http(status)),
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn list<'a>(data: &'a Value, key: &str) -> &'a [Value] {
    data.as_array()
        .or_else(|| data[key].as_array())
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_str()?.parse().ok())
}

fn message_text(message: &Value) -> String {
    if let Some(text) = string(&message["content"]) {
        return text;
    }
    ["content", "parts"]
        .into_iter()
        .filter_map(|field| message[field].as_array())
        .flatten()
        .filter_map(|part| {
            part.as_str().or_else(|| part["text"].as_str()).or_else(|| {
                part["type"]
                    .as_str()
                    .filter(|kind| kind.contains("text"))
                    .and_then(|_| part["content"].as_str())
            })
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

async fn read_stream(
    response: Response,
    mut progress: StreamProgress,
    mut update: impl FnMut(&StreamProgress),
) -> Result<(), Error> {
    let mut events = response.bytes_stream().eventsource();
    let mut completed = false;
    while let Some(event) = events.next().await {
        let event = match event {
            Ok(event) => event,
            Err(_) if completed => return Ok(()),
            Err(_) => return Err(Error::Interrupted),
        };
        if event.data == "[DONE]" {
            return Ok(());
        }
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else {
            continue;
        };
        if let Some(id) = string(&data["chat_id"]).or_else(|| string(&data["chatId"])) {
            progress.chat_id = Some(id);
        }
        if !event.id.is_empty() && event.id.bytes().all(|byte| byte.is_ascii_digit()) {
            progress.cursor = Some(event.id);
        }
        let kind = if event.event == "message" {
            data["type"].as_str().unwrap_or("message")
        } else {
            &event.event
        };
        image_generation::collect_stream_images(kind, &data, &mut progress);
        match kind {
            "error" | "response.failed" | "response.incomplete" => {
                return Err(Error::GenerationFailed);
            }
            "response.completed" if !data["response"]["error"].is_null() => {
                return Err(Error::GenerationFailed);
            }
            "response.output_text.delta" if !completed => {
                progress.text.push_str(data["delta"].as_str().unwrap_or(""))
            }
            "response.output_text.done" if progress.text.is_empty() => {
                progress.text.push_str(data["text"].as_str().unwrap_or(""));
            }
            "completed" if progress.text.is_empty() => {
                progress.text = message_text(&data["message"])
            }
            _ => {}
        }
        update(&progress);
        if kind == "completed" {
            return Ok(());
        }
        completed |= kind == "response.completed";
    }
    if completed {
        Ok(())
    } else {
        Err(Error::Interrupted)
    }
}
