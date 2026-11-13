use dioxus::prelude::*;
use francestudent::{FranceStudent, GeneralSettings};

use crate::{ChatState, MobilePage};

use super::web::WebSettings;

const REASONING_LEVELS: [(&str, &str); 6] = [
    ("none", "Aucun"),
    ("minimal", "Minimal"),
    ("low", "Faible"),
    ("medium", "Moyen"),
    ("high", "Élevé"),
    ("xhigh", "Très élevé"),
];

#[derive(Default)]
struct SettingsPage {
    draft: Option<GeneralSettings>,
    saved_reasoning: String,
    loading: bool,
    feedback: Option<(String, bool)>,
}

#[component]
pub(crate) fn Settings(mut state: Signal<ChatState>) -> Element {
    let mut panel = use_signal(SettingsPage::default);
    use_future(move || async move {
        if let Some(client) = { state.peek().client.clone() } {
            load(state, panel, client).await;
        }
    });

    let view = panel.read();
    let chat = state.read();
    let disabled = chat.busy || view.loading;

    rsx! {
        section { class: "mobile-page", aria_label: "Réglages FranceStudent",
            div { class: "mobile-page-header",
                h2 { "Réglages" }
                button { r#type: "button", disabled: chat.busy,
                    onclick: move |_| state.write().mobile_page = MobilePage::Chat,
                    "Retour au chat"
                }
            }
            if let Some((message, error)) = &view.feedback {
                p { class: if *error { "error" } else { "muted" },
                    role: if *error { "alert" } else { "status" },
                    "{message}"
                }
            }
            if let Some(draft) = &view.draft {
                form { class: "mobile-form", onsubmit: move |event| {
                    event.prevent_default();
                    save(state, panel);
                },
                    label { r#for: "gpt-reasoning", "Réflexion GPT" }
                    select {
                        id: "gpt-reasoning", value: "{draft.gpt_reasoning}", disabled,
                        onchange: move |event| {
                            let value = event.value();
                            if REASONING_LEVELS.iter().any(|(id, _)| *id == value) {
                                if let Some(draft) = panel.write().draft.as_mut() {
                                    draft.gpt_reasoning = value;
                                }
                            }
                        },
                        if !REASONING_LEVELS.iter().any(|(id, _)| *id == draft.gpt_reasoning) {
                            option { value: "{draft.gpt_reasoning}", "Réglage du compte" }
                        }
                        for (value, label) in REASONING_LEVELS {
                            option { value, "{label}" }
                        }
                    }
                    label { r#for: "custom-instructions", "Instructions personnalisées" }
                    textarea {
                        id: "custom-instructions", rows: "7", maxlength: "2000000",
                        value: "{draft.custom_instructions}", disabled,
                        oninput: move |event| {
                            if let Some(draft) = panel.write().draft.as_mut() {
                                draft.custom_instructions = event.value();
                            }
                        }
                    }
                    div { class: "mobile-page-actions",
                        button { class: "primary", r#type: "submit", disabled,
                            if chat.busy { "Enregistrement…" } else { "Enregistrer sur le compte" }
                        }
                    }
                }
                WebSettings { state, initial_mode: draft.web_search_mode.clone() }
            } else if view.loading {
                p { class: "muted", role: "status", "Chargement des réglages…" }
            } else {
                button { r#type: "button", onclick: move |_| {
                    if let Some(client) = { state.peek().client.clone() } {
                        spawn(load(state, panel, client));
                    }
                }, "Réessayer" }
            }
        }
    }
}

async fn load(
    mut state: Signal<ChatState>,
    mut panel: Signal<SettingsPage>,
    client: FranceStudent,
) {
    if panel.peek().loading {
        return;
    }
    {
        let mut view = panel.write();
        view.loading = true;
        view.feedback = None;
    }
    let result = client.general_settings().await;
    let mut view = panel.write();
    view.loading = false;
    match result {
        Ok(settings) => {
            state.write().set_web_search_mode(&settings.web_search_mode);
            view.saved_reasoning = settings.gpt_reasoning.clone();
            view.draft = Some(settings);
        }
        Err(error) => view.feedback = Some((error.to_string(), true)),
    }
}

fn save(mut state: Signal<ChatState>, mut panel: Signal<SettingsPage>) {
    let (draft, changed_reasoning) = {
        let view = panel.peek();
        let Some(draft) = view.draft.clone() else {
            return;
        };
        let changed = draft.gpt_reasoning != view.saved_reasoning;
        (draft, changed)
    };
    if draft.custom_instructions.encode_utf16().count() > 2_000_000 {
        panel.write().feedback = Some(("Les instructions sont trop longues.".into(), true));
        return;
    }
    let client = {
        let mut chat = state.write();
        if chat.busy {
            return;
        }
        let Some(client) = chat.client.clone() else {
            return;
        };
        chat.busy = true;
        client
    };
    panel.write().feedback = None;
    spawn(async move {
        let result = client
            .save_general_settings(&draft, changed_reasoning)
            .await;
        state.write().busy = false;
        let mut view = panel.write();
        view.feedback = Some(match result {
            Ok(()) => {
                view.saved_reasoning = draft.gpt_reasoning;
                ("Préférences enregistrées.".into(), false)
            }
            Err(error) => (error.to_string(), true),
        });
    });
}
