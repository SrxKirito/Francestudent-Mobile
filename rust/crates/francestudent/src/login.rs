use std::collections::BTreeMap;

use kuchikiki::traits::TendrilSink;
use reqwest::{
    Client, Method, Response, StatusCode, Url,
    header::{ACCEPT, ACCEPT_LANGUAGE, COOKIE, HeaderValue, LOCATION, ORIGIN, REFERER, SET_COOKIE},
    redirect::Policy,
};
use serde_json::Value;

use crate::{Error, SITE, session_from_headers};

const PROVIDER: &str = "https://my.francestudent.org";
const MAX_PAGE: usize = 2_000_000;
const MAX_REDIRECTS: usize = 15;
const MAX_FORMS: usize = 6;
const CHALLENGE: &str = "La page de connexion demande une vérification dans le navigateur. Utilise un cookie de session.";

pub(super) async fn login_cookie(email: &str, password: String) -> Result<String, Error> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err(Error::Login("E-mail et mot de passe requis."));
    }
    let mut login = Login::new()?;
    let site = Url::parse(SITE).map_err(|_| Error::InvalidResponse)?;
    let csrf = login
        .request(Method::GET, join(&site, "/api/auth/csrf")?, None, None)
        .await?;
    let csrf = json(csrf).await?;
    let csrf = csrf["csrfToken"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or(Error::InvalidResponse)?;
    let response = login
        .request(
            Method::POST,
            join(&site, "/api/auth/signin/whmcs")?,
            Some(&site),
            Some(&[
                ("csrfToken".to_owned(), csrf.to_owned()),
                ("callbackUrl".to_owned(), "/".to_owned()),
            ]),
        )
        .await?;
    let authorize = match location(&response)? {
        Some(url) => url,
        None => {
            let data = json(response).await?;
            join(&site, data["url"].as_str().ok_or(Error::InvalidResponse)?)?
        }
    };
    if origin(&authorize) != PROVIDER {
        return Err(Error::Login(
            "Fournisseur de connexion FranceStudent inattendu.",
        ));
    }
    let mut response = login
        .request(Method::GET, authorize, Some(&site), None)
        .await?;
    let mut password = Some(password);
    for _ in 0..MAX_FORMS {
        response = login.follow(response).await?;
        if let Some(cookie) = login.cookie.take() {
            return Ok(cookie);
        }
        let page = response.url().clone();
        if origin(&page) != PROVIDER {
            return Err(Error::Login(
                "La connexion FranceStudent est restée incomplète.",
            ));
        }
        let body = text(response).await?;
        let form = select_form(&body, &page)?;
        let mut data = form.fields;
        match form.submit {
            Submit::Login { username, secret } => {
                let password = password.take().ok_or(Error::Unauthorized)?;
                data.retain(|(name, _)| name != &username && name != &secret);
                data.push((username, email.to_owned()));
                data.push((secret, password));
            }
            Submit::Consent => {}
        }
        response = login
            .request(Method::POST, form.target, Some(&page), Some(&data))
            .await?;
    }
    Err(Error::Login(
        "La connexion FranceStudent est restée incomplète.",
    ))
}

struct Login {
    client: Client,
    jars: BTreeMap<String, BTreeMap<String, String>>,
    cookie: Option<String>,
}

impl Login {
    fn new() -> Result<Self, Error> {
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("FranceStudent-Rust/0.1")
            .build()
            .map_err(|_| Error::Network)?;
        Ok(Self {
            client,
            jars: BTreeMap::new(),
            cookie: None,
        })
    }

    async fn request(
        &mut self,
        method: Method,
        target: Url,
        previous: Option<&Url>,
        form: Option<&[(String, String)]>,
    ) -> Result<Response, Error> {
        let key = origin(&target);
        let mut request = self
            .client
            .request(method, target.clone())
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,application/json;q=0.9",
            )
            .header(ACCEPT_LANGUAGE, "fr-FR,fr;q=0.9");
        if let Some(previous) = previous {
            let referer = if origin(previous) == key {
                previous.as_str().to_owned()
            } else {
                format!("{}/", origin(previous))
            };
            request = request.header(REFERER, referer);
        }
        let jar = self.jars.entry(key.clone()).or_default();
        if !jar.is_empty() {
            let mut header = HeaderValue::from_str(
                &jar.iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            )
            .map_err(|_| Error::InvalidResponse)?;
            header.set_sensitive(true);
            request = request.header(COOKIE, header);
        }
        if let Some(form) = form {
            request = request.header(ORIGIN, key.as_str()).form(form);
            if key == SITE {
                request = request.header("X-Auth-Return-Redirect", "1");
            }
        }
        let response = request.send().await.map_err(|_| Error::Network)?;
        if response
            .headers()
            .get("cf-mitigated")
            .is_some_and(|v| v == "challenge")
        {
            return Err(Error::Login(CHALLENGE));
        }
        if key == SITE && target.path() == "/api/auth/callback/whmcs" {
            self.cookie = session_from_headers(response.headers());
        }
        for cookie in response.headers().get_all(SET_COOKIE) {
            let Ok(cookie) = cookie.to_str() else {
                continue;
            };
            let mut parts = cookie.split(';');
            let Some((name, value)) = parts.next().and_then(|part| part.split_once('=')) else {
                continue;
            };
            let name = name.trim();
            let value = value.trim();
            if value.is_empty()
                || parts.any(|attr| {
                    attr.trim().split_once('=').is_some_and(|(name, value)| {
                        name.eq_ignore_ascii_case("max-age")
                            && value.trim().parse::<i64>().is_ok_and(|n| n <= 0)
                    })
                })
            {
                jar.remove(name);
            } else if !name.is_empty() && jar.len() < 64 {
                jar.insert(name.to_owned(), value.to_owned());
            }
        }
        Ok(response)
    }

    async fn follow(&mut self, mut response: Response) -> Result<Response, Error> {
        for _ in 0..MAX_REDIRECTS {
            if self.cookie.is_some()
                || !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308)
            {
                return Ok(response);
            }
            let Some(target) = location(&response)? else {
                return Ok(response);
            };
            // Les redirections n’emportent jamais les champs du formulaire.
            response = self
                .request(Method::GET, target, Some(response.url()), None)
                .await?;
        }
        Err(Error::Login("Trop de redirections pendant la connexion."))
    }
}

struct Form {
    target: Url,
    fields: Vec<(String, String)>,
    submit: Submit,
}

enum Submit {
    Login { username: String, secret: String },
    Consent,
}

fn select_form(body: &str, page: &Url) -> Result<Form, Error> {
    let document = kuchikiki::parse_html().one(body).document_node;
    if document
        .select_first(".g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form")
        .is_ok()
    {
        return Err(Error::Login(CHALLENGE));
    }
    let mut consent = None;
    let forms = document
        .select("form")
        .map_err(|_| Error::InvalidResponse)?;
    for node in forms {
        let form = node.as_node();
        let Some(element) = form.as_element() else {
            continue;
        };
        let attributes = element.attributes.borrow();
        if !attributes
            .get("method")
            .is_some_and(|method| method.eq_ignore_ascii_case("post"))
        {
            continue;
        }
        let target = join(page, attributes.get("action").unwrap_or(""))?;
        if origin(&target) != PROVIDER {
            continue;
        }
        let mut fields = Vec::new();
        let mut candidates = Vec::new();
        let mut secret = None;
        let mut submitter = None;
        let mut accepts = None;
        for input in form
            .select("input, button")
            .map_err(|_| Error::InvalidResponse)?
        {
            let element = input.as_node().as_element().ok_or(Error::InvalidResponse)?;
            let attributes = element.attributes.borrow();
            if attributes.contains("disabled")
                || attributes.contains("formaction")
                || attributes.contains("formmethod")
            {
                continue;
            }
            let is_button = element.name.local.as_ref() == "button";
            let kind = attributes
                .get("type")
                .unwrap_or(if is_button { "submit" } else { "text" })
                .to_ascii_lowercase();
            let name = attributes.get("name").unwrap_or_default();
            let value = attributes.get("value").unwrap_or(
                if matches!(kind.as_str(), "checkbox" | "radio") {
                    "on"
                } else {
                    ""
                },
            );
            let pair = (name.to_owned(), value.to_owned());
            match kind.as_str() {
                "submit" => {
                    if !name.is_empty() && submitter.is_none() {
                        submitter = Some(pair.clone());
                    }
                    let label = format!("{name} {value} {}", input.as_node().text_contents())
                        .to_lowercase();
                    if [
                        "autoris", "authoriz", "authoris", "approve", "allow", "accepter", "accept",
                    ]
                    .iter()
                    .any(|word| label.contains(word))
                        && !["deny", "refus", "cancel", "annuler"]
                            .iter()
                            .any(|word| label.contains(word))
                    {
                        accepts = Some(pair);
                    }
                }
                "password" if !name.is_empty() => {
                    secret = Some(name.to_owned());
                }
                "text" | "email" | "tel" | "" if !name.is_empty() && !is_button => {
                    let identity = format!("{name} {}", attributes.get("id").unwrap_or_default())
                        .to_lowercase();
                    let preferred = kind == "email"
                        || ["user", "mail", "login", "ident"]
                            .iter()
                            .any(|key| identity.contains(key));
                    candidates.push((preferred, name.to_owned()));
                    fields.push(pair);
                }
                "hidden" if !name.is_empty() => fields.push(pair),
                "checkbox" | "radio" if !name.is_empty() && attributes.contains("checked") => {
                    fields.push(pair)
                }
                _ => {}
            }
        }
        if let Some(secret) = secret {
            if let Some((_, username)) = candidates
                .iter()
                .find(|(preferred, _)| *preferred)
                .or_else(|| candidates.first())
            {
                if username == &secret {
                    return Err(Error::InvalidResponse);
                }
                fields.extend(submitter);
                return Ok(Form {
                    target,
                    fields,
                    submit: Submit::Login {
                        username: username.clone(),
                        secret,
                    },
                });
            }
        } else if let Some(accept) = accepts.filter(|_| candidates.is_empty()) {
            if !accept.0.is_empty() {
                fields.push(accept);
            }
            consent.get_or_insert(Form {
                target,
                fields,
                submit: Submit::Consent,
            });
        }
    }
    consent.ok_or(Error::Login(CHALLENGE))
}

fn location(response: &Response) -> Result<Option<Url>, Error> {
    response
        .headers()
        .get(LOCATION)
        .map(|value| {
            join(
                response.url(),
                value.to_str().map_err(|_| Error::InvalidResponse)?,
            )
        })
        .transpose()
}

fn join(base: &Url, value: &str) -> Result<Url, Error> {
    let url = base.join(value).map_err(|_| Error::InvalidResponse)?;
    let allowed = [SITE, PROVIDER].contains(&origin(&url).as_str());
    if !allowed || !url.username().is_empty() || url.password().is_some() {
        return Err(Error::Login(
            "Adresse de connexion FranceStudent inattendue.",
        ));
    }
    Ok(url)
}

fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

async fn json(response: Response) -> Result<Value, Error> {
    serde_json::from_str(&text(response).await?).map_err(|_| Error::InvalidResponse)
}

async fn text(mut response: Response) -> Result<String, Error> {
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(Error::Unauthorized);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Network)? {
        if body.len() + chunk.len() > MAX_PAGE {
            return Err(Error::InvalidResponse);
        }
        body.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&body).into_owned();
    if status.is_client_error() || status.is_server_error() {
        let lower = body.to_ascii_lowercase();
        if lower.contains("cf-chl")
            || lower.contains("just a moment")
            || lower.contains("attention required")
        {
            return Err(Error::Login(CHALLENGE));
        }
        return Err(Error::Http(status));
    }
    Ok(body)
}
