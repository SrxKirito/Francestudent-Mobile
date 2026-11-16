//! Compatibility transport for the existing site login. The site endpoints are
//! outside the OpenAPI snapshot, so this is kept separate from the API client.
use crate::ApiError;
use futures_util::StreamExt;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub url: String,
    pub method: String,
    pub data: Option<String>,
    pub headers: BTreeMap<String, String>,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub status: u16,
    pub headers: BTreeMap<String, Value>,
    pub data: String,
}

fn valid_url(url: &Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("ia.francestudent.org" | "my.francestudent.org")
        )
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

fn allowed_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "user-agent"
            | "accept"
            | "accept-language"
            | "referer"
            | "cookie"
            | "content-type"
            | "origin"
            | "x-auth-return-redirect"
    )
}

pub async fn request(input: LoginRequest) -> Result<LoginResponse, ApiError> {
    let url = Url::parse(&input.url).map_err(|_| ApiError::UnsupportedRoute)?;
    if !valid_url(&url) {
        return Err(ApiError::UnsupportedRoute);
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()?;
    perform(&client, url, input).await
}

async fn perform(
    client: &Client,
    url: Url,
    input: LoginRequest,
) -> Result<LoginResponse, ApiError> {
    let method = match input.method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err(ApiError::UnsupportedRoute),
    };
    let mut request = client.request(method, url);
    for (name, value) in input.headers {
        if !allowed_header(&name) {
            return Err(ApiError::UnsupportedRoute);
        }
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| ApiError::InvalidCredential)?;
        let mut value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| ApiError::InvalidCredential)?;
        if name == reqwest::header::COOKIE {
            value.set_sensitive(true);
        }
        request = request.header(name, value);
    }
    if let Some(data) = input.data {
        request = request.body(data);
    }
    let response = request.send().await?;
    let status = response.status().as_u16();
    let mut headers = BTreeMap::new();
    for name in ["location", "content-type", "cf-mitigated"] {
        if let Some(value) = response.headers().get(name).and_then(|v| v.to_str().ok()) {
            headers.insert(name.to_owned(), Value::String(value.to_owned()));
        }
    }
    let cookies: Vec<_> = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| Value::String(v.to_owned()))
        .collect();
    if !cookies.is_empty() {
        headers.insert("set-cookie".into(), Value::Array(cookies));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if body.len().saturating_add(chunk.len()) > 4 * 1024 * 1024 {
            return Err(ApiError::ResponseTooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(LoginResponse {
        status,
        headers,
        data: String::from_utf8_lossy(&body).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn only_the_expected_https_hosts_are_allowed() {
        for value in [
            "https://ia.francestudent.org/api/auth/csrf",
            "https://my.francestudent.org/login",
        ] {
            assert!(valid_url(&Url::parse(value).unwrap()));
        }
        for value in [
            "http://my.francestudent.org/",
            "https://my.francestudent.org.evil.test/",
            "https://user@my.francestudent.org/",
            "https://my.francestudent.org:444/",
            "https://my.francestudent.org/#fragment",
        ] {
            assert!(!valid_url(&Url::parse(value).unwrap()));
        }
    }

    #[tokio::test]
    async fn preserves_multiple_cookies_without_following_redirects() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            socket.read(&mut bytes).await.unwrap();
            socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://example.test/\r\nSet-Cookie: a=1; Path=/\r\nSet-Cookie: b=2; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let url = Url::parse(&format!("http://{address}/")).unwrap();
        let input = LoginRequest {
            url: url.to_string(),
            method: "GET".into(),
            data: None,
            headers: BTreeMap::new(),
        };
        let response = perform(&client, url, input).await.unwrap();
        assert_eq!(response.status, 302);
        assert_eq!(response.headers["set-cookie"].as_array().unwrap().len(), 2);
        assert_eq!(response.headers["location"], "https://example.test/");
        server.await.unwrap();
    }
}
