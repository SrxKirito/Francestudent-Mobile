use std::collections::HashSet;

use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Conversation, Error, FranceStudent, integer, string};

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "nullable_default")]
    pub custom_instructions: String,
}

#[derive(Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    #[serde(default, deserialize_with = "nullable_default")]
    pub custom_instructions: String,
    #[serde(default, deserialize_with = "nullable_default")]
    pub gpt_reasoning: String,
    #[serde(default, deserialize_with = "nullable_default")]
    pub web_search_mode: String,
    #[serde(skip)]
    pub image_settings: Option<super::ImageSettings>,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum WebSearchMode {
    #[default]
    Open,
    Filtered,
    Disabled,
}

impl WebSearchMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "filtered" => Some(Self::Filtered),
            "disabled" => Some(Self::Disabled),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Filtered => "filtered",
            Self::Disabled => "disabled",
        }
    }
}

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WebFilterType {
    #[default]
    Allowlist,
    Blocklist,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WebDomainSettings {
    #[serde(deserialize_with = "nullable_default")]
    pub filter_type: WebFilterType,
    #[serde(deserialize_with = "nullable_default")]
    pub allowed_domains: Vec<String>,
    #[serde(deserialize_with = "nullable_default")]
    pub blocked_domains: Vec<String>,
}

impl WebDomainSettings {
    pub fn from_input(
        filter_type: WebFilterType,
        allowed: &str,
        blocked: &str,
    ) -> Result<Self, &'static str> {
        let allowed_domains = parse_domains(allowed)?;
        let blocked_domains = parse_domains(blocked)?;
        if filter_type == WebFilterType::Allowlist && allowed_domains.is_empty() {
            return Err("Ajoute au moins un site autorisé.");
        }
        Ok(Self {
            filter_type,
            allowed_domains,
            blocked_domains,
        })
    }
}

fn parse_domains(input: &str) -> Result<Vec<String>, &'static str> {
    const INVALID_DOMAIN: &str = "Indique uniquement des domaines, par exemple wikipedia.org.";
    let mut domains = Vec::new();
    let mut seen = HashSet::new();
    for item in input
        .split(|character: char| character.is_whitespace() || matches!(character, ';' | ','))
        .filter(|value| !value.is_empty())
    {
        let url = if item.contains("://") {
            Url::parse(item)
        } else {
            Url::parse(&format!("https://{item}"))
        }
        .map_err(|_| INVALID_DOMAIN)?;
        let host = url.domain().ok_or(INVALID_DOMAIN)?.trim_end_matches('.');
        let valid_label = |part: &str| {
            (1..=63).contains(&part.len())
                && !part.starts_with('-')
                && !part.ends_with('-')
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        };
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !host.contains('.')
            || !host.split('.').all(valid_label)
            || !host.rsplit('.').next().is_some_and(|tld| {
                tld.len() >= 2 && tld.bytes().all(|byte| byte.is_ascii_alphabetic())
            })
        {
            return Err(INVALID_DOMAIN);
        }
        if seen.insert(host.to_owned()) {
            domains.push(host.to_owned());
        }
    }
    Ok(domains)
}

fn nullable_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn items<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], Error> {
    value
        .as_array()
        .or_else(|| value[key].as_array())
        .or_else(|| value["data"].as_array())
        .map(Vec::as_slice)
        .ok_or(Error::InvalidResponse)
}

impl FranceStudent {
    pub async fn projects(&self) -> Result<Vec<Project>, Error> {
        let data = self.get_json(&["projects"], &[]).await?;
        items(&data, "projects")?
            .iter()
            .filter(|entry| string(&entry["id"]).is_some())
            .cloned()
            .map(|project| serde_json::from_value(project).map_err(|_| Error::InvalidResponse))
            .collect()
    }

    pub async fn project(&self, id: &str) -> Result<Project, Error> {
        let data = self.get_json(&["projects", id], &[]).await?;
        let project: Project = serde_json::from_value(data).map_err(|_| Error::InvalidResponse)?;
        if project.id != id {
            return Err(Error::InvalidResponse);
        }
        Ok(project)
    }

    pub async fn save_project(
        &self,
        id: Option<&str>,
        name: &str,
        instructions: &str,
    ) -> Result<Project, Error> {
        let body = json!({"name": name, "customInstructions": instructions});
        let response = match id {
            Some(id) => {
                self.request(
                    Method::PATCH,
                    &["projects", id],
                    &[],
                    Some(&body),
                    "application/json",
                )
                .await?
            }
            None => {
                self.request(
                    Method::POST,
                    &["projects"],
                    &[],
                    Some(&body),
                    "application/json",
                )
                .await?
            }
        };
        let raw = response.bytes().await.map_err(|_| Error::Network)?;
        let data: Value = if raw.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&raw).map_err(|_| Error::InvalidResponse)?
        };
        let id = match (id, string(&data["id"])) {
            (Some(id), None) => id.to_owned(),
            (Some(id), Some(returned)) if returned == id => returned,
            (None, Some(created)) => created,
            _ => return Err(Error::InvalidResponse),
        };
        Ok(Project {
            id,
            name: string(&data["name"]).unwrap_or_else(|| name.to_owned()),
            custom_instructions: data["customInstructions"]
                .as_str()
                .unwrap_or(instructions)
                .to_owned(),
        })
    }

    pub async fn delete_project(&self, id: &str) -> Result<(), Error> {
        self.request(
            Method::DELETE,
            &["projects", id],
            &[],
            None,
            "application/json",
        )
        .await?;
        Ok(())
    }

    pub async fn project_conversations(&self, id: &str) -> Result<Vec<Conversation>, Error> {
        let mut chats = Vec::new();
        let mut seen = HashSet::new();
        let mut cursors = HashSet::new();
        let mut cursor = String::new();
        loop {
            let mut query = vec![("limit", "100")];
            if !cursor.is_empty() {
                query.push(("cursor_chat_id", &cursor));
            }
            let page = self.get_json(&["projects", id, "chats"], &query).await?;
            let rows = items(&page, "chats")?;
            for item in rows {
                let Some(chat_id) = string(&item["id"]) else {
                    continue;
                };
                if seen.insert(chat_id.clone()) {
                    chats.push(Conversation {
                        id: chat_id,
                        title: string(&item["title"]).unwrap_or_else(|| "Sans titre".into()),
                        model: integer(&item["agent"]["id"]),
                        project: Some(id.to_owned()),
                        pinned: item["isPinned"].as_bool().unwrap_or(false),
                    });
                }
            }
            if page["hasMore"].as_bool() != Some(true) {
                break;
            }
            cursor = rows
                .last()
                .and_then(|row| string(&row["id"]))
                .ok_or(Error::InvalidResponse)?;
            if !cursors.insert(cursor.clone()) {
                return Err(Error::InvalidResponse);
            }
        }
        chats.sort_by_key(|chat| !chat.pinned);
        Ok(chats)
    }

    pub async fn general_settings(&self) -> Result<GeneralSettings, Error> {
        let data = self.get_json(&["user", "instructions"], &[]).await?;
        let image_settings = super::ImageSettings::from_response(&data).ok();
        let mut settings: GeneralSettings =
            serde_json::from_value(data).map_err(|_| Error::InvalidResponse)?;
        settings.image_settings = image_settings;
        Ok(settings)
    }

    pub async fn save_general_settings(
        &self,
        settings: &GeneralSettings,
        changed_reasoning: bool,
    ) -> Result<(), Error> {
        let mut body = json!({ "customInstructions": settings.custom_instructions });
        if changed_reasoning {
            body["gptReasoning"] = json!(settings.gpt_reasoning);
        }
        self.request(
            Method::PATCH,
            &["user", "instructions"],
            &[],
            Some(&body),
            "application/json",
        )
        .await?;
        Ok(())
    }

    pub async fn web_domain_settings(&self) -> Result<WebDomainSettings, Error> {
        let response = self
            .request(
                Method::GET,
                &["user", "web-search-domains"],
                &[],
                None,
                "application/json",
            )
            .await?;
        let raw = response.bytes().await.map_err(|_| Error::Network)?;
        if raw.is_empty() {
            return Ok(WebDomainSettings::default());
        }
        serde_json::from_slice::<Option<WebDomainSettings>>(&raw)
            .map(Option::unwrap_or_default)
            .map_err(|_| Error::InvalidResponse)
    }

    pub async fn save_web_domain_settings(
        &self,
        settings: &WebDomainSettings,
    ) -> Result<(), Error> {
        let body = serde_json::to_value(settings).map_err(|_| Error::InvalidResponse)?;
        self.request(
            Method::PUT,
            &["user", "web-search-domains"],
            &[],
            Some(&body),
            "application/json",
        )
        .await?;
        Ok(())
    }

    pub async fn save_web_search_mode(&self, mode: WebSearchMode) -> Result<(), Error> {
        let body = json!({"webSearchMode": mode.as_str()});
        self.request(
            Method::PATCH,
            &["user", "instructions"],
            &[],
            Some(&body),
            "application/json",
        )
        .await?;
        Ok(())
    }
}
