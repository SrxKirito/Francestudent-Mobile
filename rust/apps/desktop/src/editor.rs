use std::path::{Path, PathBuf};

use dioxus::prelude::*;

use crate::{
    workbench::{Dock, WorkbenchState, is_flag},
    workspace::{Document, Entry, Workspace},
};

#[derive(Default)]
struct EditorState {
    workspace: Option<Workspace>,
    directory: PathBuf,
    entries: Vec<Entry>,
    document: Option<Document>,
    text: String,
    saved_text: String,
    status: Option<String>,
    error: Option<String>,
    choosing: bool,
}

impl EditorState {
    fn open_workspace(&mut self, path: &Path) {
        match Workspace::open(path).and_then(|workspace| {
            workspace
                .entries(Path::new(""))
                .map(|entries| (workspace, entries))
        }) {
            Ok((workspace, entries)) => {
                *self = Self {
                    workspace: Some(workspace),
                    entries,
                    ..Self::default()
                };
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }

    fn dirty(&self) -> bool {
        self.text != self.saved_text
    }

    fn navigate(&mut self, directory: PathBuf) {
        let Some(workspace) = &self.workspace else {
            return;
        };
        match workspace.entries(&directory) {
            Ok(entries) => {
                self.directory = directory;
                self.entries = entries;
                self.error = None;
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }

    fn open_file(&mut self, relative: &Path) {
        let Some(workspace) = &self.workspace else {
            return;
        };
        match workspace.read(relative) {
            Ok(document) => {
                self.text = document.display_text();
                self.saved_text = self.text.clone();
                self.document = Some(document);
                self.error = None;
                self.status = None;
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }

    fn save(&mut self) {
        if !self.dirty() {
            return;
        }
        let (Some(workspace), Some(document)) = (&self.workspace, &mut self.document) else {
            return;
        };
        self.error = None;
        self.status = None;
        match workspace.save(document, &self.text) {
            Ok(()) => {
                self.saved_text = self.text.clone();
                self.status = Some("Fichier enregistré.".into());
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }
}

#[component]
pub fn Editor() -> Element {
    let window = dioxus::desktop::use_window();
    let mut workbench = use_context::<WorkbenchState>();
    let busy = workbench.busy;
    let mut state = use_signal(|| {
        let mut initial = EditorState::default();
        if let Some(folder) = std::env::args_os().skip(1).find(|arg| !is_flag(arg)) {
            initial.open_workspace(Path::new(&folder));
        }
        initial
    });
    let status = use_memo(move || {
        let view = state.read();
        (
            view.workspace
                .as_ref()
                .map(|project| project.display_path.clone()),
            view.dirty(),
        )
    });
    use_effect(move || {
        let (workspace, dirty) = status();
        if *workbench.workspace.peek() != workspace {
            workbench.workspace.set(workspace);
        }
        if *workbench.dirty.peek() != dirty {
            workbench.dirty.set(dirty);
        }
    });
    use_effect(move || {
        if (workbench.revision)() != 0 && !state.peek().dirty() {
            let mut view = state.write();
            let directory = view.directory.clone();
            view.navigate(directory);
            if let Some(file) = view.document.take() {
                view.text.clear();
                view.saved_text.clear();
                view.open_file(&file.relative);
            }
        }
    });
    let view = state.read();
    let dirty = view.dirty();
    let choosing = view.choosing;
    let root = view
        .workspace
        .as_ref()
        .map(|workspace| workspace.display_path.display().to_string());
    let folder = view.directory.display().to_string();
    rsx! {
        section { class: "editor-shell", aria_label: "Éditeur",
            header { class: "editor-header",
                h1 { "FranceStudent IDE" }
                button {
                    r#type: "button", disabled: choosing || dirty || busy(),
                    onclick: move |_| {
                        if state.peek().choosing || state.peek().dirty() || *busy.peek() { return; }
                        state.write().choosing = true;
                        let dialog = rfd::AsyncFileDialog::new()
                            .set_parent(window.window.as_ref())
                            .set_title("Ouvrir un dossier de projet");
                        spawn(async move {
                            let selected = dialog.pick_folder().await;
                            let mut view = state.write();
                            view.choosing = false;
                            if let Some(selected) = selected {
                                view.open_workspace(selected.path());
                            }
                        });
                    },
                    "Ouvrir un dossier"
                }
            }
            if let Some(root) = root {
                div { class: "editor-body",
                    nav { class: "files", aria_label: "Fichiers du projet",
                        div { class: "files-header",
                            span { class: "project-path", title: "{root}", "{root}" }
                            if !folder.is_empty() {
                                button {
                                r#type: "button", disabled: choosing || busy(), aria_label: "Dossier parent",
                                    onclick: move |_| {
                                        let mut view = state.write();
                                        if let Some(parent) = view.directory.parent().map(Path::to_path_buf) { view.navigate(parent); }
                                    },
                                    "↑"
                                }
                            }
                            button {
                                r#type: "button", disabled: choosing || busy(), aria_label: "Actualiser les fichiers",
                                onclick: move |_| {
                                    let mut view = state.write();
                                    let directory = view.directory.clone();
                                    view.navigate(directory);
                                },
                                "↻"
                            }
                        }
                        if !folder.is_empty() {
                            p { class: "current-folder muted", "{folder}" }
                        }
                        ul {
                            for entry in &view.entries {
                                li {
                                    button {
                                        r#type: "button", disabled: choosing || busy() || (!entry.directory && dirty),
                                        class: if view.document.as_ref().is_some_and(|document| document.relative == entry.relative) { "active" } else { "" },
                                        onclick: {
                                            let relative = entry.relative.clone();
                                            let directory = entry.directory;
                                            move |_| {
                                                let mut view = state.write();
                                                if view.choosing || *busy.peek() { return; }
                                                if directory { view.navigate(relative.clone()); }
                                                else if !view.dirty() { view.open_file(&relative); }
                                            }
                                        },
                                        if entry.directory { "▸ " }
                                        "{entry.name}"
                                    }
                                }
                            }
                        }
                    }
                    div { class: "editor-pane",
                        if let Some(document) = &view.document {
                            div { class: "editor-toolbar",
                                span { class: "document-name", "{document.relative.display()}" }
                                if dirty {
                                    span { class: "muted", "Modifié" }
                                    button {
                                        r#type: "button", disabled: busy(), onclick: move |_| {
                                            let mut view = state.write();
                                            view.text = view.saved_text.clone();
                                            view.error = None;
                                            view.status = None;
                                        },
                                        "Annuler les modifications"
                                    }
                                }
                                button { class: "primary", r#type: "button", disabled: !dirty || busy(),
                                    onclick: move |_| state.write().save(), "Enregistrer"
                                }
                            }
                            textarea {
                                class: "code-input", aria_label: "Contenu du fichier", spellcheck: "false",
                                readonly: busy(),
                                value: "{view.text}",
                                oninput: move |event| {
                                    let mut view = state.write();
                                    view.text = event.value();
                                    view.status = None;
                                },
                                onkeydown: move |event| {
                                    if event.key().to_string().eq_ignore_ascii_case("s")
                                        && event.modifiers().intersects(Modifiers::CONTROL | Modifiers::META) {
                                        event.prevent_default();
                                        if !*busy.peek() { state.write().save(); }
                                    }
                                }
                            }
                        } else {
                            p { class: "editor-empty muted", "Sélectionne un fichier texte dans l’explorateur." }
                        }
                    }
                }
                for workspace in std::iter::once(&root) {
                    Dock {
                        key: "{workspace}", workspace: PathBuf::from(workspace), dirty, busy,
                        restored: move |_| workbench.revision += 1,
                    }
                }
            } else {
                p { class: "editor-empty muted", "Ouvre un dossier pour parcourir et modifier ses fichiers." }
            }
            if let Some(error) = &view.error {
                p { class: "editor-notice error", role: "alert", "{error}" }
            } else if let Some(status) = &view.status {
                p { class: "editor-notice muted", role: "status", "{status}" }
            }
        }
    }
}
