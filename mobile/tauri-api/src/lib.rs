//! Centralized France Student API client, based on the checked-in OpenAPI snapshot.
pub mod login;
pub mod models;
pub mod sse;

use models::{ChatCreate, ChatDetail, ChatHistory, ChatMessageRequest, FilesUsage, Project};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, RETRY_AFTER},
    multipart, Client, Method, Response,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{path::Path, time::Duration};
use url::Url;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Identifiant d'authentification invalide")]
    InvalidCredential,
    #[error("Impossible de joindre le serveur")]
    Network(#[from] reqwest::Error),
    #[error("Le serveur a refusé la requête (HTTP {status})")]
    Http {
        status: u16,
        retry_after: Option<String>,
    },
    #[error("Limite de requêtes atteinte (HTTP 429). {message}")]
    RateLimited { message: String },
    #[error("Fichier inaccessible : {0}")]
    File(#[from] std::io::Error),
    #[error("Cette route API n'est pas autorisée")]
    UnsupportedRoute,
    #[error("Réponse trop volumineuse")]
    ResponseTooLarge,
    #[error("Contenu de fichier encodé de façon non reconnue")]
    InvalidFileEncoding,
    #[error("Accès aux conversations verrouillées requis : saisis ton code PIN")]
    LockedAccessRequired,
    #[error("Jeton d'accès aux conversations verrouillées invalide")]
    InvalidLockedAccess,
}

/// Header carrying the in-memory Locked Chats access token (never persisted).
const LOCKED_CHATS_ACCESS_HEADER: &str = "X-Locked-Chats-Access";

/// Path without query string, fragment or trailing slash.
fn route_only(path: &str) -> &str {
    path.split(|c| c == '?' || c == '#')
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
}

/// Routes that must never be reached without an access token.
fn locked_access_required(route: &str) -> bool {
    route == "/locked-chats" || route.starts_with("/locked-chats/chats/")
}

/// The token is only ever sent to Locked Chats routes and to chat routes.
fn locked_access_allowed(route: &str) -> bool {
    route == "/locked-chats"
        || route.starts_with("/locked-chats/")
        || route == "/chats"
        || route.starts_with("/chats/")
}

pub struct ApiClient {
    http: Client,
    base: Url,
    authorization: HeaderValue,
}

impl ApiClient {
    /// `authorization` is the complete header value; no undocumented prefix is added.
    pub fn new(authorization: &str) -> Result<Self, ApiError> {
        Self::with_base(
            Url::parse("https://api.francestudent.ai/").expect("fixed URL"),
            authorization,
        )
    }

    fn with_base(base: Url, authorization: &str) -> Result<Self, ApiError> {
        if authorization.trim().is_empty() {
            return Err(ApiError::InvalidCredential);
        }
        let mut authorization =
            HeaderValue::from_str(authorization).map_err(|_| ApiError::InvalidCredential)?;
        authorization.set_sensitive(true);
        // Reuse connection pools across calls without sharing credentials.
        static HTTP: std::sync::OnceLock<Client> = std::sync::OnceLock::new();
        let http = match HTTP.get() {
            Some(client) => client.clone(),
            None => {
                let client = Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(Duration::from_secs(15))
                    .read_timeout(Duration::from_secs(300))
                    .build()?;
                HTTP.get_or_init(|| client).clone()
            }
        };
        Ok(Self {
            http,
            base,
            authorization,
        })
    }

    fn url(&self, segments: &[&str]) -> Url {
        let mut url = self.base.clone();
        let mut path = url.path_segments_mut().expect("API URL has a host");
        path.clear();
        for segment in segments {
            path.push(segment);
        }
        drop(path);
        url
    }

    fn request(&self, method: Method, url: Url) -> reqwest::RequestBuilder {
        self.http
            .request(method, url)
            .header(AUTHORIZATION, self.authorization.clone())
    }

    /// Transitional transport for the existing interface. The destination and
    /// methods are checked against the captured OpenAPI; two existing legacy
    /// operations remain explicitly allowed until their replacements are known.
    pub async fn compatibility_request(
        &self,
        method: &str,
        path: &str,
        accept: &str,
        locked_access: Option<&str>,
        body: Option<String>,
    ) -> Result<Response, ApiError> {
        let method =
            Method::from_bytes(method.as_bytes()).map_err(|_| ApiError::UnsupportedRoute)?;
        let route = route_only(path);
        // DELETE /locked-chats/pin permanently deletes the locked conversations:
        // it is refused here whatever the caller asks.
        if method == Method::DELETE && route == "/locked-chats/pin" {
            return Err(ApiError::UnsupportedRoute);
        }
        let locked_access = locked_access.filter(|token| !token.is_empty());
        if locked_access_required(route) && locked_access.is_none() {
            return Err(ApiError::LockedAccessRequired);
        }
        let url = checked_route(&self.base, &method, path)?;
        let mut request = self.request(method, url).header("Accept", accept);
        if let Some(token) = locked_access {
            if !locked_access_allowed(route) || token.len() > 4096 {
                return Err(ApiError::InvalidLockedAccess);
            }
            let mut value =
                HeaderValue::from_str(token).map_err(|_| ApiError::InvalidLockedAccess)?;
            value.set_sensitive(true);
            request = request.header(LOCKED_CHATS_ACCESS_HEADER, value);
        }
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body);
        }
        Ok(request.send().await?)
    }

    async fn check(response: Response) -> Result<Response, ApiError> {
        if response.status().is_success() {
            return Ok(response);
        }
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        if response.status().as_u16() == 429 {
            let seconds = retry_after.as_deref().and_then(|value| {
                if value.len() <= 8
                    && !value.is_empty()
                    && value.bytes().all(|b| b.is_ascii_digit())
                {
                    value.parse::<u32>().ok()
                } else {
                    None
                }
            });
            return Err(ApiError::RateLimited {
                message: seconds
                    .map(|value| format!("Réessaie dans {value} secondes."))
                    .unwrap_or_else(|| "Réessaie plus tard.".into()),
            });
        }
        Err(ApiError::Http {
            status: response.status().as_u16(),
            retry_after,
        })
    }

    async fn json<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, ApiError> {
        Ok(
            Self::check(request.timeout(Duration::from_secs(30)).send().await?)
                .await?
                .json()
                .await?,
        )
    }

    pub async fn chats(&self, limit: i32, cursor: Option<Uuid>) -> Result<ChatHistory, ApiError> {
        let mut request = self
            .request(Method::GET, self.url(&["chats"]))
            .query(&[("limit", limit.to_string())]);
        if let Some(cursor) = cursor {
            request = request.query(&[("cursor_chat_id", cursor.to_string())]);
        }
        self.json(request).await
    }

    pub async fn chat(&self, id: Uuid) -> Result<ChatDetail, ApiError> {
        self.json(self.request(Method::GET, self.url(&["chats", &id.to_string()])))
            .await
    }

    pub async fn projects(&self) -> Result<Vec<Project>, ApiError> {
        self.json(self.request(Method::GET, self.url(&["projects"])))
            .await
    }

    pub async fn project_chats(
        &self,
        id: Uuid,
        limit: i32,
        cursor: Option<Uuid>,
    ) -> Result<ChatHistory, ApiError> {
        let mut request = self
            .request(
                Method::GET,
                self.url(&["projects", &id.to_string(), "chats"]),
            )
            .query(&[("limit", limit.to_string())]);
        if let Some(cursor) = cursor {
            request = request.query(&[("cursor_chat_id", cursor.to_string())]);
        }
        self.json(request).await
    }

    pub async fn agents(&self) -> Result<Vec<Value>, ApiError> {
        self.json(self.request(Method::GET, self.url(&["chats", "agents"])))
            .await
    }

    pub async fn supported_mime_types(&self) -> Result<Vec<String>, ApiError> {
        self.json(self.request(Method::GET, self.url(&["filesv2", "supported-mime-types"])))
            .await
    }

    pub async fn files(&self, after: Option<&str>, limit: Option<i64>) -> Result<Value, ApiError> {
        let mut request = self.request(Method::GET, self.url(&["filesv2"]));
        if let Some(after) = after {
            request = request.query(&[("after", after)]);
        }
        if let Some(limit) = limit {
            request = request.query(&[("limit", limit)]);
        }
        self.json(request).await
    }

    /// Server-side quota (`GET /filesv2/usage`).
    pub async fn files_usage(&self) -> Result<FilesUsage, ApiError> {
        self.json(self.request(Method::GET, self.url(&["filesv2", "usage"])))
            .await
    }

    /// File metadata (`GET /filesv2/{file_id}`).
    pub async fn file(&self, id: &str) -> Result<Value, ApiError> {
        let id = file_id(id)?;
        self.json(self.request(Method::GET, self.url(&["filesv2", id])))
            .await
    }

    /// Permanent server-side deletion (`DELETE /filesv2/{file_id}`). Callers
    /// must have asked the user for confirmation first.
    pub async fn delete_file(&self, id: &str) -> Result<Value, ApiError> {
        let id = file_id(id)?;
        self.json(self.request(Method::DELETE, self.url(&["filesv2", id])))
            .await
    }

    /// File bytes (`GET /filesv2/{file_id}/content`). The server may answer with
    /// a JSON base64 string (OpenAPI `format: byte`) or raw bytes; both are
    /// returned decoded. Larger files are refused without being buffered.
    pub async fn file_content(&self, id: &str, max_bytes: usize) -> Result<Vec<u8>, ApiError> {
        let id = file_id(id)?;
        let mut response = Self::check(
            self.request(Method::GET, self.url(&["filesv2", id, "content"]))
                .header("Accept", "*/*")
                .send()
                .await?,
        )
        .await?;
        let is_json = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("application/json"));
        // Base64 inflates by 4/3; allow the quotes and a little slack.
        let limit = if is_json {
            max_bytes.saturating_mul(4) / 3 + 1024
        } else {
            max_bytes
        };
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(ApiError::ResponseTooLarge);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > limit {
                return Err(ApiError::ResponseTooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        if !is_json {
            return Ok(body);
        }
        let decoded = decode_json_base64(&body)?;
        if decoded.len() > max_bytes {
            return Err(ApiError::ResponseTooLarge);
        }
        Ok(decoded)
    }

    /// FileObject is intentionally JSON: OpenAPI wraps its fields in generic SDK types.
    pub async fn upload_file(&self, path: &Path) -> Result<Value, ApiError> {
        let part = multipart::Part::file(path).await?;
        let request = self
            .request(Method::POST, self.url(&["filesv2"]))
            .multipart(multipart::Form::new().part("file", part));
        // Large uploads use the read timeout, not the short JSON request timeout.
        Ok(Self::check(request.send().await?).await?.json().await?)
    }

    /// Upload a bounded stream with a known length, without buffering the file.
    pub async fn upload_stream<S>(
        &self,
        filename: String,
        mime: &str,
        size: u64,
        stream: S,
    ) -> Result<Value, ApiError>
    where
        S: futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static,
    {
        self.multipart_stream("filesv2", "file", filename, mime, size, stream)
            .await
    }

    pub async fn upload_skill_stream<S>(
        &self,
        filename: String,
        mime: &str,
        size: u64,
        stream: S,
    ) -> Result<Value, ApiError>
    where
        S: futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static,
    {
        self.multipart_stream("skills", "files", filename, mime, size, stream)
            .await
    }

    async fn multipart_stream<S>(
        &self,
        route: &str,
        field: &str,
        filename: String,
        mime: &str,
        size: u64,
        stream: S,
    ) -> Result<Value, ApiError>
    where
        S: futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static,
    {
        let part = multipart::Part::stream_with_length(reqwest::Body::wrap_stream(stream), size)
            .file_name(filename)
            .mime_str(mime)?;
        let request = self
            .request(Method::POST, self.url(&[route]))
            .multipart(multipart::Form::new().part(field.to_owned(), part));
        let response = Self::check(request.send().await?).await?;
        if response.content_length() == Some(0) {
            return Ok(Value::Null);
        }
        Ok(response.json().await?)
    }

    pub async fn create_chat(&self, body: &ChatCreate) -> Result<Response, ApiError> {
        Self::check(
            self.request(Method::POST, self.url(&["chats", "stream"]))
                .header("Accept", "text/event-stream")
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    pub async fn send_message(
        &self,
        id: Uuid,
        body: &ChatMessageRequest,
    ) -> Result<Response, ApiError> {
        Self::check(
            self.request(Method::POST, self.url(&["chats", &id.to_string()]))
                .header("Accept", "text/event-stream")
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    pub async fn resume_stream(
        &self,
        id: Uuid,
        last_event_id: Option<i64>,
    ) -> Result<Response, ApiError> {
        let mut request = self
            .request(Method::GET, self.url(&["chats", &id.to_string(), "stream"]))
            .header("Accept", "text/event-stream");
        if let Some(cursor) = last_event_id {
            request = request.query(&[("last_event_id", cursor)]);
        }
        Self::check(request.send().await?).await
    }

    pub async fn cancel_stream(&self, id: Uuid) -> Result<(), ApiError> {
        Self::check(
            self.request(
                Method::POST,
                self.url(&["chats", &id.to_string(), "stream", "cancel"]),
            )
            .timeout(Duration::from_secs(30))
            .send()
            .await?,
        )
        .await?;
        Ok(())
    }
}

/// A server file id is one non-empty path segment: no separator, no control character.
fn file_id(id: &str) -> Result<&str, ApiError> {
    if id.is_empty()
        || id.len() > 256
        || id.chars().any(|c| c == '/' || c == '\\' || c.is_control())
    {
        return Err(ApiError::UnsupportedRoute);
    }
    Ok(id)
}

/// Strict decoder for a JSON string holding standard base64 (`"QUJD"`,
/// `\/` escapes accepted, whitespace around the string ignored).
fn decode_json_base64(body: &[u8]) -> Result<Vec<u8>, ApiError> {
    let text = std::str::from_utf8(body).map_err(|_| ApiError::InvalidFileEncoding)?;
    let text = text.trim();
    let inner = text
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .ok_or(ApiError::InvalidFileEncoding)?;
    let inner = inner.replace("\\/", "/");
    let bytes = inner.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(ApiError::InvalidFileEncoding);
    }
    fn value(byte: u8) -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some((byte - b'A') as u32),
            b'a'..=b'z' => Some((byte - b'a') as u32 + 26),
            b'0'..=b'9' => Some((byte - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let groups = bytes.len() / 4;
    for (index, group) in bytes.chunks(4).enumerate() {
        let padding = group.iter().rev().take_while(|b| **b == b'=').count();
        // Padding is only valid in the last group, at most two characters.
        if padding > 2 || (padding > 0 && index + 1 != groups) {
            return Err(ApiError::InvalidFileEncoding);
        }
        let mut acc = 0_u32;
        for byte in &group[..4 - padding] {
            acc = (acc << 6) | value(*byte).ok_or(ApiError::InvalidFileEncoding)?;
        }
        acc <<= 6 * padding as u32;
        let triple = acc.to_be_bytes();
        out.extend_from_slice(&triple[1..4 - padding]);
    }
    Ok(out)
}

fn checked_route(base: &Url, method: &Method, path: &str) -> Result<Url, ApiError> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') || path.contains('#')
    {
        return Err(ApiError::UnsupportedRoute);
    }
    let url = base.join(path).map_err(|_| ApiError::UnsupportedRoute)?;
    if url.origin() != base.origin()
        || url.path().to_ascii_lowercase().contains("%2f")
        || url.path().to_ascii_lowercase().contains("%5c")
    {
        return Err(ApiError::UnsupportedRoute);
    }
    let actual: Vec<_> = url.path().split('/').collect();
    static SPEC: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let spec = SPEC.get_or_init(|| {
        serde_json::from_str(include_str!("../../../docs/api-audit/openapi.json"))
            .expect("checked-in OpenAPI snapshot is valid")
    });
    let allowed = spec["paths"].as_object().is_some_and(|paths| {
        paths.iter().any(|(pattern, item)| {
            let segments: Vec<_> = pattern.split('/').collect();
            segments.len() == actual.len()
                && segments.iter().zip(&actual).all(|(expected, received)| {
                    expected == received
                        || (expected.starts_with('{')
                            && expected.ends_with('}')
                            && !received.is_empty())
                })
                && item.get(method.as_str().to_ascii_lowercase()).is_some()
        })
    });
    let legacy = (method == Method::GET && url.path() == "/user/me")
        || (method == Method::POST
            && actual.len() == 5
            && actual[1] == "mcp"
            && actual[2] == "servers"
            && !actual[3].is_empty()
            && actual[4] == "discover");
    if !allowed && !legacy {
        return Err(ApiError::UnsupportedRoute);
    }
    Ok(url)
}

/// Existing site session exchange; this is a compatibility endpoint of the
/// current application, not an OpenAPI operation.
pub async fn exchange_session(session: &str, device_id: &str) -> Result<Value, ApiError> {
    let base = Url::parse("https://ia.francestudent.org/").expect("fixed URL");
    exchange_session_at(&base, session, device_id).await
}

async fn exchange_session_at(
    base: &Url,
    session: &str,
    device_id: &str,
) -> Result<Value, ApiError> {
    if session.is_empty()
        || device_id.is_empty()
        || session.bytes().any(|c| c <= 32 || c == b';' || c >= 127)
        || device_id.bytes().any(|c| c <= 32 || c == b';' || c >= 127)
    {
        return Err(ApiError::InvalidCredential);
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()?;
    let mut cookie = HeaderValue::from_str(&format!(
        "next-auth.session-token={session}; francestudent-device-id={device_id}"
    ))
    .map_err(|_| ApiError::InvalidCredential)?;
    cookie.set_sensitive(true);
    let response = client
        .get(base.join("api/auth/api-token").expect("valid base"))
        .header("Cookie", cookie)
        .header("Referer", "https://ia.francestudent.org/")
        .header("francestudent-client-platform", "web_fs_ai")
        .header("francestudent-client-version", "4005601")
        .header("francestudent-device-id", device_id)
        .send()
        .await?;
    Ok(ApiClient::check(response).await?.json().await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn compatibility_routes_are_confined_to_the_snapshot() {
        let base = Url::parse("https://api.francestudent.ai/").unwrap();
        assert!(checked_route(&base, &Method::GET, "/chats?limit=20").is_ok());
        assert!(checked_route(
            &base,
            &Method::POST,
            "/chats/11111111-1111-1111-1111-111111111111"
        )
        .is_ok());
        assert!(checked_route(&base, &Method::GET, "/user/me").is_ok());
        assert!(checked_route(&base, &Method::POST, "/mcp/servers/abc/discover").is_ok());
        for path in [
            "//evil.example/chats",
            "https://evil.example/",
            "/chats/%2fsecret",
            "/not-in-spec",
            "/chats#fragment",
        ] {
            assert!(checked_route(&base, &Method::GET, path).is_err(), "{path}");
        }
        assert!(checked_route(&base, &Method::POST, "/public/health").is_err());
    }

    #[tokio::test]
    async fn session_exchange_sends_cookie_only_to_the_fixed_endpoint() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = String::from_utf8(read_request(&mut socket).await)
                .unwrap()
                .to_ascii_lowercase();
            assert!(request.starts_with("get /api/auth/api-token http/1.1"));
            assert!(request.contains(
                "cookie: next-auth.session-token=test-session; francestudent-device-id=device"
            ));
            let body = b"{\"accessToken\":\"test-token\",\"expiresIn\":300}";
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            socket.write_all(body).await.unwrap();
        });
        let base = Url::parse(&format!("http://{addr}/")).unwrap();
        assert_eq!(
            exchange_session_at(&base, "test-session", "device")
                .await
                .unwrap()["accessToken"],
            "test-token"
        );
        assert!(matches!(
            exchange_session_at(&base, "x;other=y", "device").await,
            Err(ApiError::InvalidCredential)
        ));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn chat_history_request_and_auth_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            let n = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..n]).to_lowercase();
            assert!(request.starts_with("get /chats?limit=20 "));
            assert!(request.contains("authorization: test-token"));
            socket
                .write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let api = ApiClient::with_base(
            Url::parse(&format!("http://{addr}/")).unwrap(),
            "test-token",
        )
        .unwrap();
        assert!(matches!(
            api.chats(20, None).await,
            Err(ApiError::Http { status: 401, .. })
        ));
        server.await.unwrap();
    }

    #[test]
    fn creation_payload_uses_documented_names() {
        let payload = ChatCreate {
            agent_id: 7,
            initial_content: Some("Bonjour".into()),
            project_id: None,
            images: vec![],
            files: vec!["file-1".into()],
            enable_web_search: false,
        };
        let value = serde_json::to_value(payload).unwrap();
        assert_eq!(value["agentId"], 7);
        assert_eq!(value["files"][0], "file-1");
        assert!(value.get("isPrivate").is_none());
    }

    async fn read_request(socket: &mut tokio::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let n = socket.read(&mut buffer).await.unwrap();
            assert_ne!(n, 0, "requête HTTP incomplète");
            request.extend_from_slice(&buffer[..n]);
            if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    return request;
                }
            }
        }
    }

    #[tokio::test]
    async fn upload_uses_multipart_file_field() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with("POST /filesv2 HTTP/1.1"));
            assert!(request.contains("name=\"file\""));
            assert!(request.contains("contenu de test"));
            let body = b"{\"id\":\"file-test\"}";
            let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(body).await.unwrap();
        });
        let path = std::env::temp_dir().join(format!(
            "fs-upload-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        tokio::fs::write(&path, "contenu de test").await.unwrap();
        let api = ApiClient::with_base(
            Url::parse(&format!("http://{addr}/")).unwrap(),
            "test-token",
        )
        .unwrap();
        let result = api.upload_file(&path).await;
        tokio::fs::remove_file(&path).await.unwrap();
        assert_eq!(result.unwrap()["id"], "file-test");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn upload_stream_sends_multiple_chunks_with_length() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = String::from_utf8(read_request(&mut socket).await).unwrap();
            assert!(request.starts_with("POST /filesv2 HTTP/1.1"));
            assert!(request.contains("name=\"file\"; filename=\"test.txt\""));
            assert!(
                request.contains("Content-Type: text/plain")
                    || request.contains("content-type: text/plain")
            );
            assert!(request.contains("abcd"));
            let body = b"{\"id\":\"file-stream\"}";
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            socket.write_all(body).await.unwrap();
        });
        let api = ApiClient::with_base(
            Url::parse(&format!("http://{addr}/")).unwrap(),
            "test-token",
        )
        .unwrap();
        let stream = futures_util::stream::iter(vec![
            Ok(bytes::Bytes::from_static(b"ab")),
            Ok(bytes::Bytes::from_static(b"cd")),
        ]);
        assert_eq!(
            api.upload_stream("test.txt".into(), "text/plain", 4, stream)
                .await
                .unwrap()["id"],
            "file-stream"
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn skill_upload_uses_documented_files_field_and_accepts_empty_response() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = String::from_utf8(read_request(&mut socket).await).unwrap();
            assert!(request.starts_with("POST /skills HTTP/1.1"));
            assert!(request.contains("name=\"files\"; filename=\"SKILL.md\""));
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
        });
        let api = ApiClient::with_base(
            Url::parse(&format!("http://{addr}/")).unwrap(),
            "test-token",
        )
        .unwrap();
        let stream = futures_util::stream::iter(vec![Ok(bytes::Bytes::from_static(b"abc"))]);
        assert_eq!(
            api.upload_skill_stream("SKILL.md".into(), "text/markdown", 3, stream)
                .await
                .unwrap(),
            Value::Null
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn resume_uses_last_event_cursor() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let id = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = String::from_utf8(read_request(&mut socket).await).unwrap();
            assert!(request.starts_with(
                "GET /chats/11111111-1111-1111-1111-111111111111/stream?last_event_id=4 HTTP/1.1"
            ));
            let body = b"id: 5\nevent: completed\ndata: {}\n\n";
            let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(body).await.unwrap();
        });
        let api = ApiClient::with_base(
            Url::parse(&format!("http://{addr}/")).unwrap(),
            "test-token",
        )
        .unwrap();
        let bytes = api
            .resume_stream(id, Some(4))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let events = sse::Parser::default().feed(&bytes).unwrap();
        assert_eq!(events[0].id.as_deref(), Some("5"));
        assert_eq!(events[0].event, "completed");
        server.await.unwrap();
    }

    /// Serves one canned HTTP response and checks the request line it receives.
    async fn serve_once(
        request_line: &'static str,
        content_type: &'static str,
        body: &'static [u8],
    ) -> (ApiClient, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = String::from_utf8(read_request(&mut socket).await).unwrap();
            assert!(request.starts_with(request_line), "{request}");
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: test-token"));
            let head = format!(
  "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
         body.len()
     );
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(body).await.unwrap();
        });
        let api = ApiClient::with_base(
            Url::parse(&format!("http://{addr}/")).unwrap(),
            "test-token",
        )
        .unwrap();
        (api, server)
    }

    #[tokio::test]
    async fn usage_comes_from_the_server_and_percent_is_derived_only_from_it() {
        let (api, server) = serve_once(
     "GET /filesv2/usage HTTP/1.1",
            "application/json",
            br#"{"usedBytes":250,"maxBytes":1000,"remainingBytes":750,"filesBytes":200,"skillsBytes":50,"usedGb":0.1}"#,
        )
        .await;
        let usage = api.files_usage().await.unwrap();
        assert_eq!(usage.used_bytes, Some(250));
        assert_eq!(usage.remaining_bytes, Some(750));
        assert_eq!(usage.skills_bytes, Some(50));
        assert_eq!(usage.percent(), Some(25.0));
        server.await.unwrap();
    }

    #[test]
    fn percent_is_absent_without_a_usable_quota_and_never_exceeds_100() {
        let usage = |used, max| FilesUsage {
            used_bytes: used,
            max_bytes: max,
            remaining_bytes: None,
            files_bytes: None,
            skills_bytes: None,
        };
        assert_eq!(usage(None, Some(10)).percent(), None);
        assert_eq!(usage(Some(5), None).percent(), None);
        assert_eq!(usage(Some(5), Some(0)).percent(), None);
        assert_eq!(usage(Some(20), Some(10)).percent(), Some(100.0));
    }

    #[tokio::test]
    async fn delete_uses_the_delete_method_on_one_encoded_segment() {
        let (api, server) = serve_once(
            "DELETE /filesv2/file%20x HTTP/1.1",
            "application/json",
            br#"{"id":"file x","deleted":true,"object":"file"}"#,
        )
        .await;
        assert_eq!(api.delete_file("file x").await.unwrap()["deleted"], true);
        server.await.unwrap();
        for bad in ["", "a/b", "a\\b", "a\nb"] {
            assert!(matches!(
                api.delete_file(bad).await,
                Err(ApiError::UnsupportedRoute)
            ));
            assert!(matches!(
                api.file_content(bad, 10).await,
                Err(ApiError::UnsupportedRoute)
            ));
        }
    }

    #[tokio::test]
    async fn content_json_base64_is_decoded() {
        let (api, server) = serve_once(
            "GET /filesv2/file-1/content HTTP/1.1",
            "application/json",
            br#""aGVsbG8gZmlsZXM=""#,
        )
        .await;
        assert_eq!(
            api.file_content("file-1", 100).await.unwrap(),
            b"hello files"
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn content_raw_bytes_are_returned_unchanged() {
        let (api, server) = serve_once(
            "GET /filesv2/file-2/content HTTP/1.1",
            "application/octet-stream",
            &[0, 255, 1, 254],
        )
        .await;
        assert_eq!(
            api.file_content("file-2", 100).await.unwrap(),
            vec![0, 255, 1, 254]
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn oversized_content_is_refused_before_buffering() {
        let (api, server) = serve_once(
            "GET /filesv2/big/content HTTP/1.1",
            "application/octet-stream",
            b"0123456789",
        )
        .await;
        assert!(matches!(
            api.file_content("big", 4).await,
            Err(ApiError::ResponseTooLarge)
        ));
        let _ = server.await;
    }

    #[tokio::test]
    async fn decoded_content_larger_than_the_limit_is_refused() {
        // 12 raw bytes encoded; the encoded form fits the base64 allowance but
        // the decoded size exceeds the limit of 8.
        let (api, server) = serve_once(
            "GET /filesv2/dec/content HTTP/1.1",
            "application/json",
            br#""MDEyMzQ1Njc4OTBh""#,
        )
        .await;
        assert!(matches!(
            api.file_content("dec", 8).await,
            Err(ApiError::ResponseTooLarge)
        ));
        server.await.unwrap();
    }

    #[test]
    fn base64_decoder_is_strict() {
        assert_eq!(decode_json_base64(b"\"\"").unwrap(), b"");
        assert_eq!(decode_json_base64(b" \"QUJD\" \n").unwrap(), b"ABC");
        assert_eq!(decode_json_base64(b"\"QUI=\"").unwrap(), b"AB");
        assert_eq!(decode_json_base64(b"\"QQ==\"").unwrap(), b"A");
        // "\/" is the JSON escape of "/" ("/z8=" decodes to 0xff 0x3f).
        assert_eq!(decode_json_base64(b"\"\\/z8=\"").unwrap(), vec![0xff, 0x3f]);
        for bad in [
            &b"QUJD"[..],    // not a JSON string
            b"\"QUJ\"",      // length not a multiple of 4
            b"\"QU=D\"",     // padding inside a group
            b"\"QQ==QUJD\"", // padding before the last group
            b"\"Q===\"",     // too much padding
            b"\"QU\\nJD\"",  // other escapes refused
            b"\"QU JD\"",    // whitespace inside
            b"{\"a\":1}",    // an object, not a string
        ] {
            assert!(
                matches!(decode_json_base64(bad), Err(ApiError::InvalidFileEncoding)),
                "{}",
                String::from_utf8_lossy(bad)
            );
        }
    }
}
