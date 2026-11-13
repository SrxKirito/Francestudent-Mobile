use std::{ffi::OsStr, fs, path::PathBuf};

use chat_ui::{Chat, ChatSession, Styles};
use dioxus::{
    desktop::{
        Config, LogicalSize, WindowBuilder, WindowCloseBehaviour, use_window, use_wry_event_handler,
    },
    prelude::*,
};

use crate::{desktop_host::Result, editor::Editor};

#[path = "workbench_code.rs"]
mod code;
#[path = "workbench_terminal.rs"]
mod terminal;
#[path = "workbench_versions.rs"]
mod versions;

pub fn is_flag(arg: &OsStr) -> bool {
    arg == "--workbench-rust" || arg == "--simple"
}

pub fn lock_profile() -> Result<(PathBuf, fs::File)> {
    let profile = dirs::data_local_dir()
        .ok_or("Dossier de données introuvable.")?
        .join("FranceStudentIDE-Rust");
    fs::create_dir_all(&profile)?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(profile.join("instance.lock"))?;
    lock.try_lock()
        .map_err(|_| "Une fenêtre de l’IDE Rust est déjà ouverte.")?;
    Ok((profile, lock))
}

pub fn launch() -> Result<()> {
    let (profile, _lock) = lock_profile()?;
    let window = WindowBuilder::new()
        .with_title("FranceStudent IDE · Atelier Rust")
        .with_inner_size(LogicalSize::new(1280., 820.))
        .with_min_inner_size(LogicalSize::new(760., 540.));
    dioxus::LaunchBuilder::desktop()
        .with_cfg(
            Config::new()
                .with_window(window)
                .with_data_directory(profile.join("workbench-webview")),
        )
        .with_context(profile)
        .launch(app);
    Ok(())
}

fn app() -> Element {
    let state = use_context_provider(|| WorkbenchState {
        workspace: Signal::new(None),
        dirty: Signal::new(false),
        busy: Signal::new(false),
        revision: Signal::new(0),
    });
    let window = use_window();
    use_wry_event_handler(move |event, _| {
        use tao::event::{Event, WindowEvent};
        if let Event::WindowEvent {
            window_id,
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            if *window_id != window.id() {
                return;
            }
            let busy = *state.busy.peek();
            let dirty = *state.dirty.peek();
            if !busy
                && (!dirty
                    || rfd::MessageDialog::new()
                        .set_parent(window.window.as_ref())
                        .set_title("Fermer l’atelier")
                        .set_description(
                            "Fermer la fenêtre et abandonner les modifications non enregistrées ?",
                        )
                        .set_buttons(rfd::MessageButtons::YesNo)
                        .show()
                        == rfd::MessageDialogResult::Yes)
            {
                window.set_close_behavior(WindowCloseBehaviour::WindowCloses);
                return;
            }
            window.set_close_behavior(WindowCloseBehaviour::WindowHides);
            let window = window.clone();
            spawn(async move {
                window.set_visible(true);
                if busy {
                    rfd::AsyncMessageDialog::new()
                        .set_parent(window.window.as_ref())
                        .set_title("Opération en cours")
                        .set_description(
                            "Termine ou arrête l’opération en cours avant de fermer l’atelier.",
                        )
                        .show()
                        .await;
                }
            });
        }
    });
    rsx! {
        Styles {}
        style { {include_str!("editor.css")} }
        main { class: "desktop-shell",
            Editor {}
            Assistant {}
        }
    }
}

#[derive(Clone, Copy)]
pub struct WorkbenchState {
    pub workspace: Signal<Option<PathBuf>>,
    pub dirty: Signal<bool>,
    pub busy: Signal<bool>,
    pub revision: Signal<u64>,
}

#[component]
fn Assistant() -> Element {
    let state = use_context::<WorkbenchState>();
    let mut session = use_signal(|| None::<ChatSession>);
    let mut code_tab = use_signal(|| false);
    let active = state.workspace.read();
    rsx! {
        aside { class: "workbench-assistant", aria_label: "Assistant",
            div { class: "workbench-dock-toolbar",
                button { r#type: "button", aria_pressed: !code_tab(), onclick: move |_| code_tab.set(false), "Chat" }
                button { r#type: "button", aria_pressed: code_tab(), onclick: move |_| code_tab.set(true), "Agent Code" }
            }
            div { class: "workbench-assistant-body", hidden: code_tab(),
                Chat { title: "Chat", standalone: false, on_session: move |current| session.set(current) }
            }
            div { class: "workbench-assistant-body", hidden: !code_tab(),
                if active.is_none() {
                    p { class: "workbench-code-notice muted", "Ouvre un dossier pour utiliser l’agent Code." }
                }
                for workspace in active.iter() {
                    code::Code { key: "{workspace.display()}", workspace: workspace.clone(), session }
                }
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Panel {
    Terminal,
    Versions,
}

#[component]
pub fn Dock(
    workspace: PathBuf,
    dirty: bool,
    busy: Signal<bool>,
    restored: EventHandler<()>,
) -> Element {
    let mut panel = use_signal(|| None::<Panel>);
    let selected = panel();
    let profile = use_context::<PathBuf>();
    rsx! {
        section { class: "workbench-dock", aria_label: "Outils du projet",
            div { class: "workbench-dock-toolbar",
                for (kind, label) in [(Panel::Terminal, "Terminal"), (Panel::Versions, "Sauvegardes")] {
                    button {
                        r#type: "button", aria_expanded: selected == Some(kind),
                        disabled: busy() && selected != Some(kind),
                        onclick: move |_| panel.set(if panel() == Some(kind) { None } else { Some(kind) }),
                        "{label}"
                    }
                }
            }
            div { hidden: selected != Some(Panel::Terminal),
                terminal::Terminal { workspace: workspace.clone(), busy }
            }
            div { hidden: selected != Some(Panel::Versions),
                versions::Versions { workspace, profile, visible: selected == Some(Panel::Versions), dirty, busy, restored }
            }
        }
    }
}
