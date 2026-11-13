use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError, SyncSender},
    },
    thread,
    time::Duration,
};

use chat_ui::ChatSession;
use dioxus::prelude::*;
use futures_channel::mpsc as events;
use futures_util::StreamExt;
use serde_json::{Value, json};

use super::{WorkbenchState, versions::storage_path};
use crate::{agent, desktop_host::Result, project_fs::Project};

#[derive(Clone, Copy)]
enum Role {
    User,
    Assistant,
    Activity,
}

struct Entry {
    role: Role,
    text: String,
}

enum Event {
    Entry(Role, String),
    Prompt(Prompt, SyncSender<Value>),
    Done(std::result::Result<(), String>),
}

enum Prompt {
    Confirm(String),
    Question {
        text: String,
        options: Vec<String>,
        multiple: bool,
    },
}

#[component]
pub fn Code(workspace: PathBuf, session: Signal<Option<ChatSession>>) -> Element {
    let profile = use_context::<PathBuf>();
    let mut project = use_context::<WorkbenchState>();
    let mut draft = use_signal(String::new);
    let mut planning = use_signal(|| false);
    let mut backup = use_signal(|| true);
    let mut entries = use_signal(Vec::<Entry>::new);
    let mut prompt = use_signal(|| None::<(Prompt, SyncSender<Value>)>);
    let mut running = use_signal(|| None::<Arc<AtomicBool>>);
    let mut failure = use_signal(|| None::<String>);

    use_drop(move || cancel(running));
    use_effect(move || {
        if session.read().is_none() {
            cancel(running);
        }
    });

    rsx! {
        section { class: "workbench-code", aria_label: "Agent Code",
            div { class: "workbench-code-feed", aria_live: "polite",
                if session.read().is_none() {
                    p { class: "muted", "Connecte-toi dans l’onglet Chat pour utiliser l’agent Code." }
                }
                for entry in entries.read().iter() {
                    article { class: match entry.role { Role::User => "code-user", Role::Assistant => "code-assistant", Role::Activity => "code-activity" },
                        "{entry.text}"
                    }
                }
                if let Some(error) = failure.read().as_ref() {
                    p { role: "alert", class: "error", "{error}" }
                }
            }
            if let Some((current, _)) = prompt.read().as_ref() {
                match current {
                    Prompt::Confirm(text) => rsx! {
                        section { class: "workbench-code-prompt", aria_label: "Confirmation",
                            p { "{text}" }
                            button { r#type: "button", onclick: move |_| answer(prompt, json!("n")), "Refuser" }
                            button { r#type: "button", class: "primary", onclick: move |_| answer(prompt, json!("o")), "Autoriser" }
                        }
                    },
                    Prompt::Question { text, options, multiple } => rsx! {
                        Question { text: text.clone(), options: options.clone(), multiple: *multiple,
                            respond: move |value| answer(prompt, value) }
                    },
                }
            }
            form { class: "composer workbench-code-form",
                onsubmit: move |event| {
                    event.prevent_default();
                    if *project.busy.peek() || *project.dirty.peek() { return; }
                    let Some(session) = session.peek().clone() else { return; };
                    let task = draft.peek().trim().to_owned();
                    if task.is_empty() { return; }
                    let history: Vec<_> = entries.peek().iter().rev()
                        .filter(|entry| !matches!(entry.role, Role::Activity)).take(8)
                        .map(|entry| json!({
                            "role": if matches!(entry.role, Role::User) { "user" } else { "assistant" },
                            "text": &entry.text[..entry.text.floor_char_boundary(entry.text.len().min(4000))],
                        })).collect();
                    let history: Vec<_> = history.into_iter().rev().collect();
                    let read_only = *planning.peek();
                    let workspace = workspace.clone();
                    let profile = profile.clone();
                    let before = *backup.peek();
                    entries.write().push(Entry { role: Role::User, text: task.clone() });
                    draft.set(String::new());
                    failure.set(None);
                    project.busy.set(true);
                    let stop = Arc::new(AtomicBool::new(false));
                    running.set(Some(Arc::clone(&stop)));
                    let (send, mut receive) = events::unbounded();
                    thread::spawn(move || {
                        let result = (|| -> Result<()> {
                            let storage = storage_path(&workspace, &profile)?;
                            let request = json!({
                                "workspace": workspace, "storage": storage,
                                "instructions": instructions(&workspace, &profile)?,
                                "task": task, "history": history, "backup": before,
                                "readOnly": read_only, "toolGroups": ["files", "skills"],
                            });
                            execute(&profile, &request, &session, &stop, &send)
                        })();
                        let result = if stop.load(Ordering::Acquire) { Err("Tâche interrompue.".into()) }
                            else { result.map_err(|error| error.to_string()) };
                        let _ = send.unbounded_send(Event::Done(result));
                    });
                    spawn(async move {
                        while let Some(event) = receive.next().await {
                            match event {
                                Event::Entry(role, text) => entries.write().push(Entry {role, text}),
                                Event::Prompt(value, reply) => prompt.set(Some((value, reply))),
                                Event::Done(result) => { failure.set(result.err()); break; }
                            }
                        }
                        prompt.set(None);
                        running.set(None);
                        if !read_only {
                            project.revision += 1;
                        }
                        project.busy.set(false);
                    });
                },
                textarea { aria_label: "Demande pour l’agent Code", placeholder: "Que veux-tu faire dans ce projet ?",
                    value: "{draft}", oninput: move |event| draft.set(event.value()), disabled: (project.busy)(),
                }
                div { class: "composer-actions",
                    label { class: "checkbox",
                        input { r#type: "checkbox", checked: planning(), disabled: (project.busy)(),
                            onchange: move |event| planning.set(event.checked()) }
                        "Mode Plan"
                    }
                    label { class: "checkbox",
                        input { r#type: "checkbox", checked: backup(), disabled: (project.busy)() || planning(),
                            onchange: move |event| backup.set(event.checked()) }
                        "Sauvegarder avant"
                    }
                    if running.read().is_some() {
                        button { r#type: "button", onclick: move |_| { cancel(running); prompt.set(None); }, "Arrêter" }
                    } else {
                        button { r#type: "submit", class: "primary", disabled: (project.busy)() || (project.dirty)() ||
                            session.read().is_none() || draft.read().trim().is_empty(), "Envoyer" }
                    }
                }
                if (project.dirty)() {
                    span { class: "muted", "Enregistre le fichier ouvert avant de lancer l’agent." }
                }
            }
        }
    }
}

#[component]
fn Question(
    text: String,
    options: Vec<String>,
    multiple: bool,
    respond: EventHandler<Value>,
) -> Element {
    let mut selected = use_signal(Vec::<usize>::new);
    let mut note = use_signal(String::new);
    rsx! {
        form { class: "workbench-code-prompt",
            onsubmit: {
                let options = options.clone();
                move |event| {
                    event.prevent_default();
                    let chosen: Vec<_> = selected.peek().iter().filter_map(|index| options.get(*index)).cloned().collect();
                    let text = note.peek().trim().to_owned();
                    let response = chosen.iter().map(String::as_str).chain((!text.is_empty()).then_some(text.as_str())).collect::<Vec<_>>().join("\n");
                    if !response.is_empty() {
                        respond.call(json!({"answer": response, "selected":chosen, "text":text, "skipped":false}));
                    }
                }
            },
            fieldset {
                legend { "{text}" }
                for (index, option) in options.iter().enumerate() {
                    label { class: "checkbox",
                        input { r#type: if multiple { "checkbox" } else { "radio" }, name: "agent-question",
                            checked: selected.read().contains(&index),
                            onchange: move |event| {
                                let mut values = selected.write();
                                if !multiple { values.clear(); }
                                if event.checked() { values.push(index); }
                                else { values.retain(|value| *value != index); }
                            }
                        }
                        "{option}"
                    }
                }
                textarea { aria_label: "Réponse libre", maxlength: "4000", value: "{note}",
                    oninput: move |event| note.set(event.value()) }
            }
            button { r#type: "button", onclick: move |_| respond.call(json!({"answer":null,"skipped":true})), "Passer" }
            button { r#type: "submit", class: "primary", disabled: selected.read().is_empty() && note.read().trim().is_empty(), "Répondre" }
        }
    }
}

fn cancel(running: Signal<Option<Arc<AtomicBool>>>) {
    if let Some(stop) = running.peek().as_ref() {
        stop.store(true, Ordering::Release);
    }
}

fn answer(mut current: Signal<Option<(Prompt, SyncSender<Value>)>>, value: Value) {
    if let Some((_, reply)) = current.write().take() {
        let _ = reply.try_send(value);
    }
}

fn instructions(workspace: &Path, profile: &Path) -> Result<String> {
    let project = Project::open(workspace, profile)?;
    let mut text = String::new();
    for file in ["AGENTS.md", "FRSTCLI.md"] {
        if let Ok((data, _)) = project.read(file, 1024 * 1024) {
            if let Ok(source) = String::from_utf8(data) {
                text.push_str(&format!(
                    "\n## {file}\n{}",
                    source.trim_start_matches('\u{feff}').trim()
                ));
            }
        }
    }
    if text.len() > 8_000 {
        text.truncate(text.floor_char_boundary(8_000));
        text.push_str("\n[Instructions tronquées.]");
    }
    Ok(text)
}

fn execute(
    profile: &Path,
    request: &Value,
    session: &ChatSession,
    stop: &AtomicBool,
    send: &events::UnboundedSender<Event>,
) -> Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let emit = |role, text: String| -> Result<Value> {
        send.unbounded_send(Event::Entry(role, text))
            .map_err(|_| "Interface fermée.")?;
        Ok(Value::Null)
    };
    let prompt = |prompt| -> Result<Value> {
        let (reply, answer) = mpsc::sync_channel(1);
        send.unbounded_send(Event::Prompt(prompt, reply))
            .map_err(|_| "Interface fermée.")?;
        while !stop.load(Ordering::Acquire) {
            match answer.recv_timeout(Duration::from_millis(80)) {
                Ok(value) => return Ok(value),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        Err("Tâche interrompue.".into())
    };
    agent::run(profile, request, stop, |method, data| {
        match method {
        "model" => runtime.block_on(async {
            let mut text = String::new();
            let mut id = None;
            let query = data["prompt"].as_str().ok_or("Demande modèle absente.")?;
            let generation = session.client.agent_prompt(session.model, query, |progress| {
                text.clone_from(&progress.text);
                id.clone_from(&progress.chat_id);
            });
            let result = tokio::select! {
                result = generation => Some(result),
                _ = async {
                    while !stop.load(Ordering::Acquire) { tokio::time::sleep(Duration::from_millis(80)).await; }
                } => None,
            };
            match result {
                Some(result) => { result?; Ok(json!(text)) }
                None => {
                    if let Some(id) = id {
                        let _ = tokio::time::timeout(Duration::from_secs(2), session.client.cancel(&id)).await;
                    }
                    Err("Tâche interrompue.".into())
                }
            }
        }),
        "policy" => Ok(json!({"fullAccess": false, "autoApprove": false})),
        "confirm" => prompt(Prompt::Confirm(data["question"].as_str().unwrap_or_default().to_owned())),
        "question" => {
            let text = data["question"].as_str().map(str::trim)
                .filter(|text| !text.is_empty() && text.chars().count() <= 2_000).ok_or("Question invalide.")?;
            let mut options = Vec::new();
            if let Some(raw) = data.get("options") {
                let raw = raw.as_array().filter(|items| (2..=8).contains(&items.len())).ok_or("Choix invalides.")?;
                for option in raw {
                    let label = option.as_str().or_else(|| option["label"].as_str()).map(str::trim)
                        .filter(|label| !label.is_empty() && label.chars().count() <= 200).ok_or("Choix invalide.")?;
                    if options.iter().any(|existing: &String| existing.eq_ignore_ascii_case(label)) {
                        return Err("Choix en double.".into());
                    }
                    options.push(label.to_owned());
                }
            }
            let result = prompt(Prompt::Question { text: text.to_owned(), options, multiple: data["multiple"] == true })?;
            emit(Role::User, result["answer"].as_str().unwrap_or("Question passée.").to_owned())?;
            Ok(result)
        }
        "info" => emit(Role::Activity, data.as_str().unwrap_or_default().to_owned()),
        "assistant" => emit(Role::Assistant, data.as_str().unwrap_or_default().to_owned()),
        "tool" => emit(Role::Activity, format!("{} · {}", data["name"].as_str().unwrap_or_default(), data["label"].as_str().unwrap_or_default())),
        "result" if data["failed"] == true => emit(Role::Activity, data["text"].as_str().unwrap_or_default().to_owned()),
        "result" => Ok(Value::Null),
        "plan" => {
            let steps = data["steps"].as_array().filter(|steps| steps.len() <= 20).ok_or("Plan invalide.")?;
            let mut plan = Vec::new();
            for item in steps {
                let step = item["step"].as_str().filter(|step| !step.trim().is_empty() && step.chars().count() <= 300).ok_or("Étape invalide.")?;
                let status = match item["status"].as_str() {
                    Some("completed") => "Terminé",
                    Some("in_progress") => "En cours",
                    None | Some("pending") => "À faire",
                    _ => return Err("État d’étape invalide.".into()),
                };
                plan.push(format!("{status} · {step}"));
            }
            emit(Role::Activity, plan.join("\n"))
        }
        _ => Err("Cet outil n’est pas disponible dans l’atelier Rust.".into()),
    }
    })?;
    Ok(())
}
