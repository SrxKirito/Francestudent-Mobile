use dioxus::prelude::*;
use francestudent::{FranceStudent, Project};

use crate::{ChatState, MobilePage};

#[derive(Default)]
struct ProjectPage {
    entries: Vec<Project>,
    filter: String,
    draft: Option<ProjectDraft>,
    loading: bool,
    loaded: bool,
    confirm_delete: bool,
    error: Option<String>,
}

#[derive(Clone, Default)]
struct ProjectDraft {
    id: Option<String>,
    saved_name: String,
    name: String,
    instructions: String,
}

#[component]
pub(crate) fn Projects(mut state: Signal<ChatState>) -> Element {
    let mut panel = use_signal(ProjectPage::default);
    use_future(move || async move {
        let client = state.peek().client.clone();
        if let Some(client) = client {
            refresh(panel, client).await;
        }
    });

    let view = panel.read();
    let chat = state.read();
    let disabled = chat.busy || view.loading;
    let query = view.filter.trim().to_lowercase();

    rsx! {
        section { class: "mobile-page", aria_label: "Projets FranceStudent",
            div { class: "mobile-page-header",
                h2 { "Projets" }
                button { r#type: "button", disabled: chat.busy,
                    onclick: move |_| state.write().mobile_page = MobilePage::Chat,
                    "Retour au chat"
                }
            }
            if let Some(error) = &view.error {
                p { class: "error", role: "alert", "{error}" }
            }
            if let Some(draft) = &view.draft {
                if view.confirm_delete {
                    div { class: "mobile-form", role: "group", aria_label: "Confirmer la suppression",
                        p { "Supprimer définitivement « {draft.saved_name} » du compte FranceStudent ?" }
                        div { class: "mobile-page-actions",
                            button { r#type: "button", disabled,
                                onclick: move |_| panel.write().confirm_delete = false,
                                "Annuler"
                            }
                            button { class: "danger", r#type: "button", disabled,
                                onclick: move |_| delete(state, panel), "Supprimer définitivement"
                            }
                        }
                    }
                } else {
                    form { class: "mobile-form", onsubmit: move |event| {
                        event.prevent_default();
                        save(state, panel);
                    },
                        h3 {
                            if draft.id.is_some() { "Modifier le projet" } else { "Créer un projet" }
                        }
                        label { r#for: "project-name", "Nom du projet" }
                        input { id: "project-name", r#type: "text", required: true, maxlength: "50",
                            disabled, value: "{draft.name}",
                            oninput: move |event| {
                                if let Some(draft) = panel.write().draft.as_mut() {
                                    draft.name = event.value();
                                }
                            }
                        }
                        label { r#for: "project-instructions", "Instructions personnalisées" }
                        textarea { id: "project-instructions", rows: "6", maxlength: "10000",
                            disabled, value: "{draft.instructions}",
                            oninput: move |event| {
                                if let Some(draft) = panel.write().draft.as_mut() {
                                    draft.instructions = event.value();
                                }
                            }
                        }
                        div { class: "mobile-page-actions",
                            button { r#type: "button", disabled, onclick: move |_| {
                                let mut panel = panel.write();
                                panel.draft = None;
                                panel.error = None;
                            }, "Annuler" }
                            if draft.id.is_some() {
                                button { class: "danger", r#type: "button", disabled,
                                    onclick: move |_| {
                                        let mut panel = panel.write();
                                        panel.confirm_delete = true;
                                        panel.error = None;
                                    },
                                    "Supprimer"
                                }
                            }
                            button { class: "primary", r#type: "submit", disabled: disabled || draft.name.trim().is_empty(),
                                if draft.id.is_some() { "Enregistrer" } else { "Créer le projet" }
                            }
                        }
                    }
                }
            } else {
                div { class: "mobile-page-actions",
                    button { class: "primary", r#type: "button", disabled, onclick: move |_| {
                        let mut panel = panel.write();
                        panel.draft = Some(ProjectDraft::default());
                        panel.error = None;
                    }, "Nouveau projet" }
                    button { r#type: "button", disabled, onclick: move |_| {
                        let client = state.peek().client.clone();
                        if let Some(client) = client {
                            spawn(refresh(panel, client));
                        }
                    }, "Actualiser" }
                }
                if view.loaded {
                    input { r#type: "search", aria_label: "Rechercher un projet", placeholder: "Rechercher un projet",
                        value: "{view.filter}", oninput: move |event| panel.write().filter = event.value()
                    }
                    ul { class: "mobile-project-list",
                        for project in view.entries.iter().filter(|project| project.name.to_lowercase().contains(&query)) {
                            li { key: "{project.id}",
                                button { r#type: "button", class: "project-open", disabled,
                                    onclick: {
                                        let id = project.id.clone();
                                        move |_| load_project(state, panel, id.clone(), false)
                                    },
                                    "{project.name}"
                                }
                                button { r#type: "button", disabled, aria_label: "Modifier {project.name}",
                                    onclick: {
                                        let id = project.id.clone();
                                        move |_| load_project(state, panel, id.clone(), true)
                                    },
                                    "Modifier"
                                }
                            }
                        }
                    }
                    if view.entries.iter().all(|project| !project.name.to_lowercase().contains(&query)) {
                        p { class: "muted", "Aucun projet trouvé." }
                    }
                }
            }
            if disabled {
                p { class: "muted", role: "status", "Opération en cours…" }
            }
        }
    }
}

async fn refresh(mut panel: Signal<ProjectPage>, client: FranceStudent) {
    if panel.peek().loading {
        return;
    }
    {
        let mut view = panel.write();
        view.loading = true;
        view.error = None;
    }
    let result = client.projects().await;
    let mut view = panel.write();
    view.loading = false;
    match result {
        Ok(entries) => {
            view.loaded = true;
            view.entries = entries;
        }
        Err(error) => view.error = Some(error.to_string()),
    }
}

fn load_project(
    mut state: Signal<ChatState>,
    mut panel: Signal<ProjectPage>,
    id: String,
    edit: bool,
) {
    let Some(client) = begin(&mut state, &mut panel) else {
        return;
    };
    spawn(async move {
        let result = async {
            let project = client.project(&id).await?;
            let conversations = if edit {
                Vec::new()
            } else {
                client.project_conversations(&id).await?
            };
            Ok::<_, francestudent::Error>((project, conversations))
        }
        .await;
        let mut chat = state.write();
        chat.busy = false;
        match result {
            Ok((project, _)) if edit => {
                panel.write().draft = Some(ProjectDraft {
                    id: Some(project.id),
                    saved_name: project.name.clone(),
                    name: project.name,
                    instructions: project.custom_instructions,
                });
            }
            Ok((project, conversations)) => {
                chat.replace_conversations(Some(&project.id), conversations);
                chat.project = Some(project);
                chat.clear_chat();
                chat.mobile_page = MobilePage::Chat;
            }
            Err(error) => panel.write().error = Some(error.to_string()),
        }
    });
}

fn save(mut state: Signal<ChatState>, mut panel: Signal<ProjectPage>) {
    let Some(draft) = panel.peek().draft.clone() else {
        return;
    };
    let name = draft.name.trim().to_owned();
    if name.is_empty() || name.encode_utf16().count() > 50 {
        panel.write().error = Some("Indique un nom de 1 à 50 caractères.".into());
        return;
    }
    if draft.instructions.encode_utf16().count() > 10_000 {
        panel.write().error = Some("Les instructions sont limitées à 10 000 caractères.".into());
        return;
    }
    let Some(client) = begin(&mut state, &mut panel) else {
        return;
    };
    spawn(async move {
        let result = client
            .save_project(draft.id.as_deref(), &name, &draft.instructions)
            .await;
        let mut chat = state.write();
        let mut view = panel.write();
        chat.busy = false;
        match result {
            Ok(project) => {
                view.entries.retain(|entry| entry.id != project.id);
                view.entries.insert(0, project.clone());
                view.draft = None;
                if draft.id.is_none() {
                    chat.project = Some(project);
                    chat.clear_chat();
                    chat.mobile_page = MobilePage::Chat;
                } else if chat
                    .project
                    .as_ref()
                    .is_some_and(|entry| entry.id == project.id)
                {
                    chat.project = Some(project);
                }
            }
            Err(error) => view.error = Some(error.to_string()),
        }
    });
}

fn delete(mut state: Signal<ChatState>, mut panel: Signal<ProjectPage>) {
    let id = {
        let view = panel.peek();
        if !view.confirm_delete {
            return;
        }
        view.draft.as_ref().and_then(|draft| draft.id.clone())
    };
    let Some(id) = id else {
        return;
    };
    let Some(client) = begin(&mut state, &mut panel) else {
        return;
    };
    spawn(async move {
        let result = client.delete_project(&id).await;
        let mut chat = state.write();
        let mut view = panel.write();
        chat.busy = false;
        match result {
            Ok(()) => {
                view.entries.retain(|project| project.id != id);
                view.confirm_delete = false;
                view.draft = None;
                chat.replace_conversations(Some(&id), Vec::new());
                if chat
                    .project
                    .as_ref()
                    .is_some_and(|project| project.id == id)
                {
                    chat.project = None;
                    chat.clear_chat();
                }
            }
            Err(error) => view.error = Some(error.to_string()),
        }
    });
}

fn begin(state: &mut Signal<ChatState>, panel: &mut Signal<ProjectPage>) -> Option<FranceStudent> {
    let mut chat = state.write();
    if chat.busy || panel.peek().loading {
        return None;
    }
    let client = chat.client.clone()?;
    chat.busy = true;
    panel.write().error = None;
    Some(client)
}
