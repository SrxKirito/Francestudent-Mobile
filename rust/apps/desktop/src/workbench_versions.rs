use std::{
    path::{Path, PathBuf},
    thread,
};

use dioxus::prelude::*;
use futures_channel::oneshot;
use serde::Deserialize;
use serde_json::json;
use sha1::{Digest, Sha1};

use crate::{desktop_host::Result, versions};

#[derive(Deserialize)]
struct Version {
    id: String,
    at: String,
    task: String,
    kind: String,
}

#[derive(Deserialize)]
struct Change {
    path: String,
    action: String,
}

#[derive(Deserialize)]
struct Preview {
    id: String,
    expected: String,
    changes: Vec<Change>,
    excluded: usize,
}

#[derive(Default)]
struct State {
    list: Vec<Version>,
    preview: Option<Preview>,
    message: Option<String>,
    error: Option<String>,
}

enum Action {
    List,
    Save,
    Preview(String),
    Restore { id: String, expected: String },
}

enum Outcome {
    List(Vec<Version>, Option<String>),
    Preview(Preview),
    Restored(Vec<Version>, u64),
}

#[derive(Clone, PartialEq)]
struct ProjectVersions {
    workspace: PathBuf,
    profile: PathBuf,
}

impl ProjectVersions {
    fn action(&self, action: Action) -> Result<Outcome> {
        let storage = storage_path(&self.workspace, &self.profile)?;
        let run = |name: &str, id: &str, expected: &str| {
            versions::action(
                &self.profile,
                &json!({
                    "action": name, "id": id, "expected": expected,
                    "workspace": self.workspace, "storage": storage, "task": "Sauvegarde manuelle"
                }),
            )
        };
        let list = || -> Result<Vec<Version>> { Ok(serde_json::from_value(run("list", "", "")?)?) };
        match action {
            Action::List => Ok(Outcome::List(list()?, None)),
            Action::Save => {
                run("save", "", "")?;
                Ok(Outcome::List(list()?, Some("Sauvegarde créée.".into())))
            }
            Action::Preview(id) => Ok(Outcome::Preview(serde_json::from_value(run(
                "preview", &id, "",
            )?)?)),
            Action::Restore { id, expected } => {
                let result = run("restore", &id, &expected)?;
                Ok(Outcome::Restored(
                    list()?,
                    result["restored"].as_u64().unwrap_or_default(),
                ))
            }
        }
    }
}

pub(super) fn storage_path(workspace: &Path, profile: &Path) -> Result<PathBuf> {
    let key = workspace.to_str().ok_or("Chemin du projet non UTF-8.")?;
    let key = if cfg!(windows) {
        key.to_lowercase()
    } else {
        key.into()
    };
    let name = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let mut slug = String::new();
    let mut gap = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            slug.push(c);
            gap = false;
        } else if !gap {
            slug.push('_');
            gap = true;
        }
        if slug.len() == 40 {
            break;
        }
    }
    if slug.is_empty() {
        slug.push_str("projet");
    }
    // Même répertoire et format que src/project/memory.js et src/project/file-versions.js.
    let hash = format!("{:x}", Sha1::digest(key.as_bytes()));
    Ok(profile
        .join("core")
        .join("projects")
        .join(format!("{slug}-{}", &hash[..12]))
        .join("file-versions"))
}

#[component]
pub fn Versions(
    workspace: PathBuf,
    profile: PathBuf,
    visible: bool,
    dirty: bool,
    busy: Signal<bool>,
    restored: EventHandler<()>,
) -> Element {
    let state = use_signal(State::default);
    let mut loaded = use_signal(|| false);
    let project = ProjectVersions { workspace, profile };
    let initial = project.clone();
    use_effect(use_reactive((&visible,), move |(visible,)| {
        if visible && !*loaded.peek() && !*busy.peek() {
            loaded.set(true);
            start(state, busy, initial.clone(), Action::List, restored);
        }
    }));
    let view = state.read();
    rsx! {
        section { class: "workbench-tool workbench-versions", aria_label: "Sauvegardes du projet",
            div { class: "workbench-version-actions",
                button { r#type: "button", disabled: busy(),
                    onclick: {
                        let project = project.clone();
                        move |_| start(state, busy, project.clone(), Action::List, restored)
                    }, "Actualiser"
                }
                button { r#type: "button", disabled: busy() || dirty,
                    onclick: {
                        let project = project.clone();
                        move |_| start(state, busy, project.clone(), Action::Save, restored)
                    }, "Créer une sauvegarde"
                }
            }
            if let Some(error) = &view.error {
                p { class: "error", role: "alert", "{error}" }
            } else if let Some(message) = &view.message {
                p { class: "muted", role: "status", "{message}" }
            }
            if let Some(preview) = &view.preview {
                div { class: "workbench-restore",
                    if preview.changes.is_empty() {
                        p { "Cette sauvegarde correspond aux fichiers actuels." }
                    } else {
                        p { "{preview.changes.len()} fichier(s) concerné(s). Une sauvegarde de sécurité sera créée avant la restauration." }
                        if preview.excluded > 0 {
                            p { class: "muted", "{preview.excluded} chemin(s) exclu(s) de la restauration." }
                        }
                        ul {
                            for change in &preview.changes {
                                li { key: "{change.path}", "{change.action} · {change.path}" }
                            }
                        }
                        button { r#type: "button", class: "primary", disabled: busy() || dirty,
                            onclick: {
                                let project = project.clone();
                                let (id, expected) = (preview.id.clone(), preview.expected.clone());
                                move |_| start(state, busy, project.clone(), Action::Restore { id: id.clone(), expected: expected.clone() }, restored)
                            }, "Confirmer la restauration"
                        }
                    }
                    button { r#type: "button", disabled: busy(),
                        onclick: move |_| { let mut state = state; state.write().preview = None; }, "Fermer l’aperçu"
                    }
                }
            } else if view.list.is_empty() {
                p { class: "muted", "Aucune sauvegarde pour ce projet." }
            } else {
                ul { class: "workbench-version-list",
                    for version in &view.list {
                        li { key: "{version.id}",
                            div {
                                strong { "{version.task}" }
                                time { datetime: "{version.at}", "{version.at}" }
                                if version.kind == "safety" {
                                    span { class: "muted", "Sauvegarde de sécurité" }
                                }
                            }
                            button { r#type: "button", disabled: busy(),
                                onclick: {
                                    let project = project.clone();
                                    let id = version.id.clone();
                                    move |_| start(state, busy, project.clone(), Action::Preview(id.clone()), restored)
                                }, "Aperçu"
                            }
                        }
                    }
                }
            }
        }
    }
}

fn start(
    mut state: Signal<State>,
    mut busy: Signal<bool>,
    project: ProjectVersions,
    action: Action,
    restored: EventHandler<()>,
) {
    if *busy.peek() {
        return;
    }
    busy.set(true);
    state.with_mut(|view| {
        view.error = None;
        view.message = Some("Lecture des fichiers…".into());
        view.preview = None;
    });
    let (send, receive) = oneshot::channel();
    let may_change_files = matches!(action, Action::Restore { .. });
    thread::spawn(move || {
        let _ = send.send(project.action(action).map_err(|error| error.to_string()));
    });
    spawn(async move {
        let result = receive
            .await
            .unwrap_or_else(|_| Err("Opération interrompue.".into()));
        state.with_mut(|view| {
            view.message = None;
            match result {
                Ok(Outcome::List(list, message)) => {
                    view.list = list;
                    view.message = message;
                }
                Ok(Outcome::Preview(preview)) => view.preview = Some(preview),
                Ok(Outcome::Restored(list, count)) => {
                    view.list = list;
                    view.message = Some(format!("{count} fichier(s) restauré(s)."));
                }
                Err(error) => view.error = Some(error),
            }
        });
        if may_change_files {
            restored.call(());
        }
        busy.set(false);
    });
}
