use base64::{Engine, engine::general_purpose::STANDARD};
use dioxus::prelude::*;
use dioxus_document as document;
use francestudent::{AttachmentUpload, FranceStudent, MAX_ATTACHMENT_BYTES, UploadedAttachments};
use serde::Deserialize;

use crate::ChatState;

use super::document_text;

const CHUNK_BYTES: usize = 48 * 1024;
const API_MESSAGE_CHARACTERS: usize = 1_000_000;

pub(crate) const PICKER_BRIDGE: &str = include_str!("picker.js");

#[derive(Clone, Deserialize, PartialEq)]
pub(crate) struct Attachment {
    id: u64,
    pub name: String,
    size: usize,
    #[serde(rename = "type")]
    media_type: String,
    #[serde(default)]
    converted: bool,
    remote_id: Option<String>,
}

#[derive(Deserialize)]
struct Selection {
    files: Vec<Attachment>,
    rejected: Vec<String>,
}

#[derive(Deserialize)]
struct FileChunk {
    data: Option<String>,
}

#[derive(Deserialize)]
struct ConvertedImage {
    name: String,
    size: usize,
    #[serde(rename = "type")]
    media_type: String,
}

pub(crate) async fn prepare_attachments(
    mut state: Signal<ChatState>,
    client: &FranceStudent,
    selected: Vec<Attachment>,
    prompt: &mut String,
) -> Result<UploadedAttachments, String> {
    let mut uploaded = UploadedAttachments::default();
    for mut file in selected {
        if file.is_image() && !file.direct_image() && file.remote_id.is_none() {
            // Les valeurs interpolées sont numériques et vérifiées à la sélection.
            let script = format!(
                "return await globalThis.frstAttachmentPicker.convertImage({}, {MAX_ATTACHMENT_BYTES});",
                file.id
            );
            if let Ok(Some(converted)) = document::eval(&script)
                .join::<Option<ConvertedImage>>()
                .await
            {
                let mut view = state.write();
                if let Some(current) = view.attachments.iter_mut().find(|item| item.id == file.id) {
                    current.name = converted.name;
                    current.size = converted.size;
                    current.media_type = converted.media_type;
                    current.converted = true;
                    file = current.clone();
                }
            }
        }
        let image = file.direct_image();
        let id = match file.remote_id.clone() {
            Some(id) => id,
            None => {
                let mut bytes = read_file(&file).await?;
                let header = format!("\n\n--- Fichier joint : {} ---\n", file.name);
                let footer = "\n--- Fin du fichier joint ---";
                let budget = API_MESSAGE_CHARACTERS.saturating_sub(
                    prompt.encode_utf16().count() + header.encode_utf16().count() + footer.len(),
                );
                let inline = if let Some(text) = inline_text(&file, &bytes, budget) {
                    Some(text.to_owned())
                } else if budget > 0 && document_text::supported(&file.name, file.content_type()) {
                    let name = file.name.clone();
                    let content_type = file.content_type().to_owned();
                    let (returned, extracted) = tokio::task::spawn_blocking(move || {
                        let extracted =
                            document_text::extract(&name, &content_type, &bytes, budget);
                        (bytes, extracted)
                    })
                    .await
                    .map_err(|_| format!("Impossible de traiter « {} ».", file.name))?;
                    bytes = returned;
                    extracted
                } else {
                    None
                };
                if let Some(text) = inline {
                    prompt.push_str(&header);
                    prompt.push_str(&text);
                    prompt.push_str(footer);
                    continue;
                }
                let id = client
                    .upload_attachment(AttachmentUpload {
                        name: file.name.clone(),
                        content_type: file.content_type().to_owned(),
                        bytes,
                        image,
                    })
                    .await
                    .map_err(|error| format!("Envoi de « {} » impossible. {error}", file.name))?;
                if let Some(current) = state
                    .write()
                    .attachments
                    .iter_mut()
                    .find(|item| item.id == file.id)
                {
                    current.remote_id = Some(id.clone());
                }
                id
            }
        };
        if image {
            uploaded.images.push(id);
        } else {
            uploaded.files.push(id);
        }
    }
    Ok(uploaded)
}

fn inline_text<'a>(file: &Attachment, bytes: &'a [u8], remaining: usize) -> Option<&'a str> {
    let text = std::str::from_utf8(bytes)
        .ok()?
        .trim_start_matches('\u{feff}');
    if !file.is_image()
        && !text.contains('\0')
        && text.encode_utf16().count() <= remaining
        && (file.content_type().starts_with("text/")
            || matches!(
                file.content_type(),
                "application/json" | "application/xml" | "application/octet-stream"
            ))
    {
        Some(text)
    } else {
        None
    }
}

impl Attachment {
    fn content_type(&self) -> &str {
        if !self.media_type.is_empty()
            && self.media_type != "application/octet-stream"
            && self.media_type.contains('/')
            && self
                .media_type
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"/-+._".contains(&byte))
        {
            return &self.media_type;
        }
        let ext = self.name.rsplit('.').next().unwrap_or_default();
        match ext.to_ascii_lowercase().as_str() {
            "jpeg" | "jpg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            "heic" => "image/heic",
            "heif" => "image/heif",
            "svg" => "image/svg+xml",
            "avif" => "image/avif",
            "tiff" | "tif" => "image/tiff",
            "pdf" => "application/pdf",
            "json" => "application/json",
            "xml" => "application/xml",
            "csv" => "text/csv",
            "txt" | "md" => "text/plain",
            _ => "application/octet-stream",
        }
    }

    fn is_image(&self) -> bool {
        self.content_type().starts_with("image/")
    }

    fn direct_image(&self) -> bool {
        matches!(
            self.content_type(),
            "image/png" | "image/jpeg" | "image/jpg" | "image/webp"
        )
    }
}

async fn read_file(file: &Attachment) -> Result<Vec<u8>, String> {
    let error = || {
        format!(
            "Lecture de « {} » impossible. Sélectionne de nouveau le fichier.",
            file.name
        )
    };
    if file.size > MAX_ATTACHMENT_BYTES {
        return Err(format!("« {} » dépasse 50 Mio.", file.name));
    }
    let mut bytes = Vec::with_capacity(file.size);
    while bytes.len() < file.size {
        let end = file.size.min(bytes.len() + CHUNK_BYTES);
        // Les seules valeurs interpolées sont des entiers issus de Rust.
        let script = format!(
            "return await globalThis.frstAttachmentPicker.chunk({}, {}, {}, {});",
            file.id,
            bytes.len(),
            end,
            file.converted
        );
        let chunk: FileChunk = document::eval(&script).join().await.map_err(|_| error())?;
        let data = chunk.data.ok_or_else(&error)?;
        if data.len() > CHUNK_BYTES.div_ceil(3) * 4 {
            return Err(error());
        }
        let decoded = STANDARD.decode(data).map_err(|_| error())?;
        if decoded.len() != end - bytes.len() {
            return Err(error());
        }
        bytes.extend_from_slice(&decoded);
    }
    Ok(bytes)
}

pub(crate) fn release(files: Vec<Attachment>) {
    if !files.is_empty() {
        let ids: Vec<_> = files.iter().map(|file| file.id).collect();
        // Les seules valeurs interpolées sont les identifiants numériques.
        document::eval(&format!(
            "globalThis.frstAttachmentPicker?.release({ids:?}); return null;"
        ));
    }
}

#[component]
pub(crate) fn Attachments(mut state: Signal<ChatState>) -> Element {
    let reading = state.read().selecting_attachments;
    let disabled = state.read().busy || reading;
    let files = state.read().attachments.clone();

    rsx! {
        div { class: "composer-attachments",
            div { class: "attachment-buttons",
                for (label, accept) in [("Fichiers", ""), ("Photos", "image/*")] {
                    label { class: if disabled { "attachment-label disabled" } else { "attachment-label" },
                        "{label}"
                        input {
                            r#type: "file", aria_label: label, multiple: true,
                            accept, disabled,
                            "data-frst-attachments": "true",
                            "data-max-bytes": "{MAX_ATTACHMENT_BYTES}"
                        }
                    }
                }
                button { r#type: "button", class: "attachment-receiver", hidden: true,
                    onclick: move |_| {
                        if state.peek().busy || state.peek().selecting_attachments {
                            return;
                        }
                        state.write().selecting_attachments = true;
                        spawn(async move {
                            let result = document::eval("return globalThis.frstAttachmentPicker.take();")
                                .join::<Selection>().await;
                            let mut view = state.write();
                            view.selecting_attachments = false;
                            view.attachment_feedback = match result {
                                Ok(selection) => {
                                    view.attachments.extend(selection.files);
                                    (!selection.rejected.is_empty()).then(|| {
                                        format!("Fichiers trop volumineux (50 Mio maximum) : {}", selection.rejected.join(", "))
                                    })
                                }
                                Err(_) => Some("Impossible de récupérer la sélection.".into()),
                            };
                        });
                    },
                    "Sélection reçue"
                }
            }
            if !files.is_empty() {
                ul { class: "attachment-list", aria_label: "Pièces jointes",
                    for file in files {
                        li { key: "{file.id}",
                            span { "{file.name}" }
                            button { r#type: "button", aria_label: "Retirer {file.name}", disabled,
                                onclick: move |_| {
                                    let mut view = state.write();
                                    if let Some(index) = view.attachments.iter().position(|entry| entry.id == file.id) {
                                        release(vec![view.attachments.remove(index)]);
                                    }
                                }, "Retirer"
                            }
                        }
                    }
                }
            }
            if let Some(feedback) = &state.read().attachment_feedback {
                p { class: "error", role: "alert", "{feedback}" }
            }
        }
    }
}
