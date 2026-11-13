use std::{
    path::{Path, PathBuf},
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
};

use dioxus::prelude::*;
use futures_channel::mpsc;
use futures_util::StreamExt;
use serde_json::{Value, json};

use crate::{desktop_host::Result, terminal};

const OUTPUT_BYTES: usize = 128 * 1024;

enum TerminalEvent {
    Output(String),
    Exit(std::result::Result<Value, String>),
}

#[component]
pub fn Terminal(workspace: PathBuf, busy: Signal<bool>) -> Element {
    let mut draft = use_signal(String::new);
    let mut output = use_signal(String::new);
    let mut status = use_signal(String::new);
    let mut running = use_signal(|| None::<Arc<AtomicBool>>);
    let mut tail = use_signal(|| None::<Rc<MountedData>>);
    use_drop(move || {
        if let Some(stop) = running.peek().as_ref() {
            stop.store(true, Ordering::Release);
        }
    });
    use_effect(move || {
        if !output.read().is_empty() {
            if let Some(node) = tail.read().clone() {
                spawn(async move {
                    let _ = node.scroll_to(ScrollBehavior::Instant).await;
                });
            }
        }
    });

    rsx! {
        section { class: "workbench-tool workbench-terminal", aria_label: "Terminal simple",
            div { class: "terminal-output",
                pre { tabindex: "0", "{output}" }
                span { onmounted: move |event| tail.set(Some(event.data())) }
            }
            form {
                onsubmit: move |event| {
                    event.prevent_default();
                    let line = draft.peek().trim().to_owned();
                    if line.is_empty() || *busy.peek() {
                        return;
                    }
                    let shell = match shell(&workspace, &line) {
                        Ok(shell) => shell,
                        Err(error) => { status.set(error.to_string()); return; }
                    };
                    busy.set(true);
                    output.set(format!("$ {line}\n"));
                    status.set("Commande en cours…".into());
                    let stop = Arc::new(AtomicBool::new(false));
                    running.set(Some(Arc::clone(&stop)));
                    let (sender, mut receiver) = mpsc::unbounded();
                    thread::spawn(move || {
                        let stream = sender.clone();
                        let bytes = Arc::new(AtomicUsize::new(0));
                        let written = Arc::clone(&bytes);
                        let result = terminal::run(&shell, &stop, None, move |text| {
                            let offset = written.fetch_add(text.len(), Ordering::Relaxed);
                            if offset < OUTPUT_BYTES {
                                let end = text.floor_char_boundary(text.len().min(OUTPUT_BYTES - offset));
                                let _ = stream.unbounded_send(TerminalEvent::Output(text[..end].to_owned()));
                            }
                        });
                        if bytes.load(Ordering::Relaxed) > OUTPUT_BYTES {
                            let _ = sender.unbounded_send(TerminalEvent::Output(
                                "\n[Sortie limitée à 128 Kio.]\n".into()
                            ));
                        }
                        let _ = sender.unbounded_send(TerminalEvent::Exit(result.map_err(|error| error.to_string())));
                    });
                    spawn(async move {
                        while let Some(event) = receiver.next().await {
                            match event {
                                TerminalEvent::Output(chunk) => output.write().push_str(&chunk),
                                TerminalEvent::Exit(result) => {
                                    status.set(match result {
                                        Ok(value) if value["interrupted"] == true => "Commande interrompue.".into(),
                                        Ok(value) => format!("Code de sortie {}", value["exit_code"]),
                                        Err(error) => error,
                                    });
                                    break;
                                }
                            }
                        }
                        running.set(None);
                        busy.set(false);
                    });
                },
                input { r#type: "text", aria_label: "Commande", placeholder: "Saisis une commande",
                    value: "{draft}", disabled: busy(), oninput: move |event| draft.set(event.value())
                }
                button { r#type: "submit", disabled: busy() || draft.read().trim().is_empty(), "Exécuter" }
                if let Some(stop) = running.read().as_ref() {
                    button { r#type: "button", onclick: {
                        let stop = Arc::clone(stop);
                        move |_| stop.store(true, Ordering::Release)
                    }, "Arrêter" }
                }
            }
            p { class: "muted", role: "status", "{status}" }
        }
    }
}

fn shell(workspace: &Path, command: &str) -> Result<terminal::Shell> {
    #[cfg(windows)]
    let (file, name, args) = {
        use base64::{Engine, engine::general_purpose::STANDARD};
        let system_root = std::env::var_os("SystemRoot").ok_or("Dossier Windows introuvable.")?;
        let file =
            PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = format!("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {command}");
        let bytes: Vec<_> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        (
            file,
            "PowerShell",
            vec![
                "-NoLogo".to_owned(),
                "-NoProfile".to_owned(),
                "-NonInteractive".to_owned(),
                "-EncodedCommand".to_owned(),
                STANDARD.encode(bytes),
            ],
        )
    };
    #[cfg(not(windows))]
    let (file, name, args) = (
        std::env::var_os("SHELL").map_or_else(|| PathBuf::from("/bin/sh"), PathBuf::from),
        "Shell",
        vec!["-c".to_owned(), command.to_owned()],
    );
    Ok(serde_json::from_value(
        json!({"file":file,"name":name,"args":args,"cwd":workspace}),
    )?)
}
