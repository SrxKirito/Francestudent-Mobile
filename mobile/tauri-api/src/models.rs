//! Contrats du sous-ensemble utilisé, issus de docs/api-audit/openapi.json.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCreate {
    pub agent_id: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub images: Vec<Uuid>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub files: Vec<String>,
    pub enable_web_search: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRequest {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<i32>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub images: Vec<Uuid>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub files: Vec<String>,
    pub enable_web_search: bool,
}

// OpenAPI does not mark these response properties required; preserve unknown
// fields and allow missing/null properties rather than inventing guarantees.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistory {
    pub chats: Option<Vec<ChatSummary>>,
    pub has_more: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub title: Option<String>,
    pub last_message_at: Option<String>,
    pub is_pinned: Option<bool>,
    pub agent: Option<Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDetail {
    pub id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub title: Option<String>,
    pub agent: Option<Value>,
    pub chat_messages: Option<Vec<ChatMessage>>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: Option<Uuid>,
    pub role: Option<String>,
    pub content: Option<String>,
    pub used_file_ids: Option<Vec<Uuid>>,
    pub used_files_v2_ids: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Option<Uuid>,
    pub name: Option<String>,
    pub owner_id: Option<i32>,
    pub custom_instructions: Option<String>,
    pub flags: Option<i32>,
    pub created_at: Option<String>,
}
