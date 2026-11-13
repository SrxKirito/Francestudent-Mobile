use dioxus::prelude::*;
use francestudent::{GeneratedImage, ImageModel};

#[derive(Clone, Copy, Default, PartialEq)]
pub(super) struct ImageMode {
    enabled: bool,
    model: ImageModel,
}

impl ImageMode {
    pub fn model(self) -> Option<ImageModel> {
        self.enabled.then_some(self.model)
    }
}

#[component]
pub(super) fn ImageControls(
    mode: ImageMode,
    disabled: bool,
    on_change: EventHandler<ImageMode>,
) -> Element {
    rsx! {
        label { class: "checkbox",
            input {
                r#type: "checkbox", checked: mode.enabled, disabled,
                onchange: move |event| on_change.call(ImageMode { enabled: event.checked(), ..mode })
            }
            "Image"
        }
        if mode.enabled {
            select {
                aria_label: "Modèle de génération d’images",
                value: mode.model.id(), disabled,
                onchange: move |event| {
                    let id = event.value();
                    if let Some(model) = ImageModel::ALL.into_iter().find(|model| model.id() == id) {
                        on_change.call(ImageMode { model, ..mode });
                    }
                },
                for model in ImageModel::ALL {
                    option { key: "{model.id()}", value: model.id(), "{model.label()}" }
                }
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
                    img {
                        key: "{index}",
                        src: image.src(),
                        alt: "Image générée par FranceStudent",
                        loading: "lazy",
                    }
                }
            }
        }
    }
}
