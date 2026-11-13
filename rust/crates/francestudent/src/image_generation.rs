use std::{collections::BTreeMap, sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use reqwest::{Method, Url};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{API, Error, FranceStudent, StreamProgress, list};

const MAX_IMAGE_BYTES: usize = 6 * 1024 * 1024;
const MAX_IMAGES: usize = 4;
const IMAGE_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ImageModel {
    #[default]
    Flare,
    Sunburst,
    Image2,
}

impl ImageModel {
    pub const ALL: [Self; 3] = [Self::Flare, Self::Sunburst, Self::Image2];

    pub fn id(self) -> &'static str {
        match self {
            Self::Flare => "gpt-image-2.5-flare",
            Self::Sunburst => "gpt-image-2.5-sunburst",
            Self::Image2 => "gpt-image-2",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Flare => "GPT Image 2.5 Flare",
            Self::Sunburst => "GPT Image 2.5 Sunburst",
            Self::Image2 => "GPT Image 2",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct GeneratedImage(Arc<str>);

impl GeneratedImage {
    pub fn src(&self) -> &str {
        &self.0
    }

    fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let mime = image_mime(bytes)?;
        Some(Self(
            format!("data:{mime};base64,{}", STANDARD.encode(bytes)).into(),
        ))
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ImageProgress {
    announced: bool,
    message_id: Option<Uuid>,
    references: BTreeMap<Uuid, Option<Uuid>>,
}

impl ImageProgress {
    pub fn announced(&self) -> bool {
        self.announced
    }
}

impl FranceStudent {
    /// Configure l’outil du compte seulement pour une demande Image explicite.
    pub async fn prepare_image_request(
        &self,
        prompt: String,
        model: Option<ImageModel>,
    ) -> Result<String, Error> {
        let Some(model) = model else {
            return Ok(prompt);
        };
        let route = &["user", "instructions"];
        let current = self.get_json(route, &[]).await?;
        if current["imageGenerationToolEnabled"] != true
            || current["imageGenerationModel"].as_str() != Some(model.id())
        {
            let body = json!({
                "imageGenerationToolEnabled": true,
                "imageGenerationModel": model.id(),
            });
            self.request(Method::PATCH, route, &[], Some(&body), "application/json")
                .await?;
        }
        Ok(format!(
            "[Génération d'image] Utilise l’outil de génération d’image ({}) pour créer l’image décrite ci-dessous.\n\n{prompt}",
            model.id()
        ))
    }

    pub async fn complete_generated_images(&self, progress: &mut StreamProgress, requested: bool) {
        if !requested && !progress.image_progress.announced() {
            return;
        }
        let Some(chat_id) = progress.chat_id.clone() else {
            return;
        };
        if Uuid::parse_str(&chat_id).is_err() {
            return;
        }
        let _ = tokio::time::timeout(IMAGE_FETCH_TIMEOUT, async {
            self.resolve_images(&chat_id, &progress.image_progress, &mut progress.images)
                .await;
            if !progress.images.is_empty() {
                return;
            }
            // Le flux peut annoncer une image avant que le service ne communique son message.
            let Ok(detail) = self.get_json(&["chats", &chat_id], &[]).await else {
                return;
            };
            let messages = list(&detail, "chatMessages");
            let latest = response_message(messages, progress.image_progress.message_id);
            if let Some(latest) = latest {
                let (mut images, mut references) = images_for_message(latest);
                // Un identifiant obtenu en flux peut manquer dans le détail final.
                for id in progress.image_progress.references.keys() {
                    references.add_reference(*id, references.message_id);
                }
                self.resolve_images(&chat_id, &references, &mut images)
                    .await;
                progress.images = images;
            }
        })
        .await;
    }

    pub(super) async fn resolve_images(
        &self,
        chat_id: &str,
        progress: &ImageProgress,
        images: &mut Vec<GeneratedImage>,
    ) {
        for (id, message) in &progress.references {
            if images.len() == MAX_IMAGES {
                break;
            }
            let Some(message) = message.or(progress.message_id) else {
                continue;
            };
            let message = message.to_string();
            let image = id.to_string();
            if let Ok(Ok(image)) = tokio::time::timeout(
                IMAGE_FETCH_TIMEOUT,
                self.download_image(&["chats", chat_id, "messages", &message, "images", &image]),
            )
            .await
            {
                push_image(images, image);
            }
        }
    }

    async fn download_image(&self, path: &[&str]) -> Result<GeneratedImage, Error> {
        let response = self
            .request(Method::GET, path, &[], None, "image/*")
            .await?;
        if response
            .content_length()
            .is_some_and(|n| n > MAX_IMAGE_BYTES as u64)
        {
            return Err(Error::InvalidResponse);
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| Error::Network)?;
            if chunk.len() > MAX_IMAGE_BYTES - bytes.len() {
                return Err(Error::InvalidResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        GeneratedImage::from_bytes(&bytes).ok_or(Error::InvalidResponse)
    }
}

fn response_message(messages: &[Value], expected: Option<Uuid>) -> Option<&Value> {
    let latest_user = messages
        .iter()
        .filter(|item| {
            item["role"]
                .as_str()
                .is_some_and(|role| role.eq_ignore_ascii_case("user"))
        })
        .filter_map(|item| item["createdAt"].as_str())
        .max();
    messages
        .iter()
        .filter(|item| is_assistant(item))
        .filter(|item| {
            if let Some(expected) = expected {
                parse_id(&item["id"]) == Some(expected)
            } else if let Some(latest_user) = latest_user {
                item["createdAt"]
                    .as_str()
                    .is_some_and(|time| time >= latest_user)
            } else {
                false
            }
        })
        .max_by_key(|item| item["createdAt"].as_str())
}

impl ImageProgress {
    fn add_reference(&mut self, id: Uuid, message: Option<Uuid>) {
        if id == message.unwrap_or_default()
            || self.references.len() >= MAX_IMAGES && !self.references.contains_key(&id)
        {
            return;
        }
        let entry = self.references.entry(id).or_default();
        if message.is_some() {
            *entry = message;
        }
    }
}

pub(super) fn images_for_message(message: &Value) -> (Vec<GeneratedImage>, ImageProgress) {
    let mut progress = ImageProgress::default();
    let mut images = Vec::new();
    if is_assistant(message) {
        progress.message_id = parse_id(&message["id"]);
        let message_id = progress.message_id;
        collect(message, false, message_id, 0, &mut images, &mut progress);
    }
    (images, progress)
}

pub(super) fn collect_stream_images(kind: &str, data: &Value, progress: &mut StreamProgress) {
    if excluded_role(data)
        || is_partial(kind)
        || matches!(
            kind,
            "response.output_text.delta" | "response.output_text.done"
        )
    {
        return;
    }
    let message = &data["message"];
    let nested_message = (is_assistant(message) || kind == "completed" && !excluded_role(message))
        .then(|| parse_id(&message["id"]))
        .flatten();
    if let Some(message_id) = nested_message
        .or_else(|| parse_id(&data["message_id"]))
        .or_else(|| parse_id(&data["messageId"]))
    {
        progress.image_progress.message_id = Some(message_id);
    }
    let typed = image_type(kind);
    progress.image_progress.announced |= typed;
    let message = progress.image_progress.message_id;
    collect(
        data,
        typed,
        message,
        0,
        &mut progress.images,
        &mut progress.image_progress,
    );
}

fn collect(
    node: &Value,
    typed: bool,
    message: Option<Uuid>,
    depth: usize,
    images: &mut Vec<GeneratedImage>,
    progress: &mut ImageProgress,
) {
    if depth > 10 || images.len() >= MAX_IMAGES {
        return;
    }
    if let Some(items) = node.as_array() {
        for item in items {
            collect(item, typed, message, depth + 1, images, progress);
        }
        return;
    }
    let Some(fields) = node.as_object() else {
        if typed && let Some(value) = node.as_str() {
            add_image_value(value, message, images, progress);
        }
        return;
    };
    let kind = node["type"].as_str().unwrap_or_default();
    if excluded_role(node) || is_partial(kind) {
        return;
    }
    let message = if is_assistant(node) {
        parse_id(&node["id"]).or(message)
    } else {
        message
    };
    let typed = typed
        || image_type(kind)
        || ["mimeType", "mime_type"].into_iter().any(|key| {
            node[key]
                .as_str()
                .is_some_and(|value| value.starts_with("image/"))
        })
        || ["toolName", "tool_name"]
            .into_iter()
            .any(|key| node[key].as_str().is_some_and(image_type));
    progress.announced |= typed;
    for key in [
        "imageId",
        "image_id",
        "generatedImageId",
        "generated_image_id",
    ] {
        if let Some(id) = parse_id(&node[key]) {
            progress.add_reference(id, message);
        }
    }
    if typed {
        if !kind.contains("image_generation_call")
            && let Some(id) = parse_id(&node["id"])
        {
            progress.add_reference(id, message);
        }
        for key in [
            "fileId",
            "file_id",
            "result",
            "b64_json",
            "image_base64",
            "base64",
            "imageData",
            "data",
            "url",
            "src",
            "imageUrl",
            "image_url",
        ] {
            if let Some(value) = node[key].as_str().or_else(|| node[key]["url"].as_str()) {
                add_image_value(value, message, images, progress);
            }
        }
    }
    for (key, item) in fields {
        if is_partial(key)
            || matches!(key.as_str(), "image_url" | "metadata")
            || (typed && matches!(key.as_str(), "b64_json" | "image_base64" | "imageData"))
        {
            continue;
        }
        if key == "images" {
            collect(item, true, message, depth + 1, images, progress);
        } else if item.is_array() || item.is_object() {
            collect(item, false, message, depth + 1, images, progress);
        } else if matches!(key.as_str(), "b64_json" | "image_base64" | "imageData")
            && let Some(value) = item.as_str()
        {
            add_image_value(value, message, images, progress);
        }
    }
}

fn add_image_value(
    value: &str,
    message: Option<Uuid>,
    images: &mut Vec<GeneratedImage>,
    progress: &mut ImageProgress,
) {
    if let Ok(id) = Uuid::parse_str(value) {
        progress.announced = true;
        progress.add_reference(id, message);
    } else if let Some(image) = inline_image(value) {
        progress.announced = true;
        push_image(images, image);
    } else if let Some((message, id)) = image_route(value) {
        progress.announced = true;
        progress.add_reference(id, Some(message));
    }
}

fn image_route(value: &str) -> Option<(Uuid, Uuid)> {
    let api = Url::parse(API).ok()?;
    let url = api.join(value).ok()?;
    if url.origin() != api.origin() || url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    let route: Vec<_> = url.path_segments()?.collect();
    let ["chats", chat, "messages", message, "images", id] = route.as_slice() else {
        return None;
    };
    Uuid::parse_str(chat).ok()?;
    Some((Uuid::parse_str(message).ok()?, Uuid::parse_str(id).ok()?))
}

fn inline_image(value: &str) -> Option<GeneratedImage> {
    let base64 = value
        .split_once(";base64,")
        .filter(|(header, _)| header.starts_with("data:image/"))
        .map_or(value, |(_, data)| data);
    if base64.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return None;
    }
    if !["iVBORw0KGgo", "/9j/", "UklGR", "R0lGOD"]
        .iter()
        .any(|prefix| base64.starts_with(prefix))
    {
        return None;
    }
    let bytes = STANDARD.decode(base64).ok()?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let mime = image_mime(&bytes)?;
    Some(GeneratedImage(
        format!("data:{mime};base64,{base64}").into(),
    ))
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    }
}

fn push_image(images: &mut Vec<GeneratedImage>, image: GeneratedImage) {
    if images.len() < MAX_IMAGES && !images.contains(&image) {
        images.push(image);
    }
}

fn image_type(kind: &str) -> bool {
    let kind = kind.to_ascii_lowercase();
    [
        "image_generation",
        "imagegeneration",
        "generated_image",
        "generated-image",
        "output_image",
    ]
    .iter()
    .any(|marker| kind.contains(marker))
        || matches!(kind.as_str(), "image" | "image_file")
}

fn is_partial(kind: &str) -> bool {
    let kind = kind.to_ascii_lowercase();
    kind.contains("partial") || kind.contains("input")
}

fn parse_id(value: &Value) -> Option<Uuid> {
    Uuid::parse_str(value.as_str()?).ok()
}

fn is_assistant(node: &Value) -> bool {
    node["role"]
        .as_str()
        .is_some_and(|role| role.eq_ignore_ascii_case("assistant"))
}

fn excluded_role(node: &Value) -> bool {
    node["role"].as_str().is_some_and(|role| {
        role.eq_ignore_ascii_case("user") || role.eq_ignore_ascii_case("system")
    })
}
