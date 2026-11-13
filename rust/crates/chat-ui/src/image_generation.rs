use dioxus::prelude::*;
use francestudent::{GeneratedImage, ImageModel};

use crate::{ExportedFile, FileExporter};

#[derive(Clone, Default, PartialEq)]
pub(super) struct ImageMode {
    enabled: bool,
    model: ImageModel,
    account_model: Option<ImageModel>,
}

impl ImageMode {
    pub fn model(&self) -> Option<ImageModel> {
        self.enabled.then(|| self.model.clone())
    }

    pub fn set_account_model(&mut self, model: ImageModel) {
        self.account_model = Some(model.clone());
        self.model = model;
    }
}

#[component]
pub(super) fn ImageControls(
    mode: ImageMode,
    disabled: bool,
    on_change: EventHandler<ImageMode>,
) -> Element {
    let initial = mode.clone();
    let enabled = mode.enabled;
    let account_model = mode.account_model.clone();
    let select_value = mode.model.clone();
    rsx! {
        label { class: "checkbox",
            input {
                r#type: "checkbox", checked: enabled, disabled,
                onchange: move |event| on_change.call(ImageMode { enabled: event.checked(), ..initial.clone() })
            }
            "Image"
        }
        ImageModelSelect {
            model: select_value, account_model, disabled,
            on_change: move |model| on_change.call(ImageMode { model, ..mode.clone() })
        }
    }
}

#[component]
pub(super) fn ImageModelSelect(
    model: ImageModel,
    account_model: Option<ImageModel>,
    disabled: bool,
    on_change: EventHandler<ImageModel>,
) -> Element {
    let mut models = ImageModel::ALL.to_vec();
    if let Some(account) = account_model.filter(|account| !models.contains(account)) {
        models.push(account);
    }
    if !models.contains(&model) {
        models.push(model.clone());
    }
    let candidates = models.clone();
    let current_id = model.id().to_owned();
    rsx! {
        select {
            aria_label: "Modèle de génération d’images",
            value: current_id, disabled,
            onchange: move |event| {
                let id = event.value();
                if let Some(model) = candidates.iter().find(|model| model.id() == id) {
                    on_change.call(model.clone());
                }
            },
            for model in &models {
                option { key: "{model.id()}", value: model.id(), "{model.label()}" }
            }
        }
    }
}

#[component]
pub(super) fn GeneratedImages(images: Vec<GeneratedImage>) -> Element {
    rsx! {
        if !images.is_empty() {
            div { class: "chat-generated-images",
                for (index, image) in images.iter().enumerate() {
                    ImagePreview { key: "{index}", image: image.clone(), number: index + 1 }
                }
            }
        }
    }
}

#[component]
fn ImagePreview(image: GeneratedImage, number: usize) -> Element {
    let exporter = try_use_context::<FileExporter>();
    let mut busy = use_signal(|| false);
    let mut feedback = use_signal(|| None::<Result<&'static str, &'static str>>);
    let source = image.src().to_owned();
    rsx! {
        div {
            img { src: source, alt: "Image générée par FranceStudent", loading: "lazy" }
            if let Some(FileExporter(save)) = exporter {
                button {
                    class: "generated-image-export",
                    r#type: "button",
                    disabled: busy(),
                    onclick: move |_| {
                        if busy() { return; }
                        busy.set(true);
                        feedback.set(None);
                        let image = image.clone();
                        spawn(async move {
                            let result = tokio::task::spawn_blocking(move || {
                                let (mime, bytes) = image.export_data().ok_or("Image invalide.")?;
                                let extension = match mime {
                                    "image/png" => "png",
                                    "image/jpeg" => "jpg",
                                    "image/webp" => "webp",
                                    "image/gif" => "gif",
                                    _ => return Err("Format d’image inconnu."),
                                };
                                save(ExportedFile {
                                    name: format!("francestudent-image-{number}.{extension}"),
                                    mime,
                                    bytes,
                                })
                            })
                            .await
                            .unwrap_or(Err("L’enregistrement de l’image a échoué."));
                            feedback.set(Some(result));
                            busy.set(false);
                        });
                    },
                    if busy() { "Enregistrement…" } else { "Enregistrer l’image" }
                }
                if let Some(result) = feedback() {
                    match result {
                        Ok(message) => rsx! { p { class: "muted", role: "status", "{message}" } },
                        Err(message) => rsx! { p { class: "error", role: "alert", "{message}" } },
                    }
                }
            }
        }
    }
}
