use dioxus::{core::Task, prelude::*};
use dioxus_document as document;
use francestudent::{
    Conversation, FranceStudent, GeneratedImage, ImageModel, Message, Model, Project, Role,
    StreamProgress,
};

mod export;
mod image_generation;
mod mobile;
mod session;
pub use export::{ExportedFile, FileExporter};
use image_generation::{GeneratedImages, ImageControls, ImageMode};
use mobile::attachments::{Attachment, Attachments, PICKER_BRIDGE, prepare_attachments, release};
use mobile::{Activity, MobilePage, Projects, Settings};
use session::{Credentials, connect};
pub use session::{SecureSession, SecureSessionStore};

#[component]
pub fn Styles() -> Element {
    rsx! { style { {include_str!("chat.css")} } }
}

#[derive(Default)]
struct ChatState {
    client: Option<FranceStudent>,
    models: Vec<Model>,
    selected: Option<i64>,
    conversations: Vec<Conversation>,
    current: Option<Conversation>,
    project: Option<Project>,
    mobile_page: MobilePage,
    messages: Vec<Message>,
    progress: StreamProgress,
    pending_title: String,
    draft: String,
    attachments: Vec<Attachment>,
    attachment_feedback: Option<String>,
    selecting_attachments: bool,
    preparing: bool,
    search: bool,
    image_mode: ImageMode,
    web_search_disabled: bool,
    history_open: bool,
    busy: bool,
    interrupted: bool,
    error: Option<String>,
}

impl ChatState {
    fn clear_chat(&mut self) {
        self.current = None;
        if !self
            .models
            .iter()
            .any(|model| Some(model.id) == self.selected)
        {
            self.selected = self
                .models
                .iter()
                .find(|model| model.preferred)
                .or_else(|| self.models.first())
                .map(|model| model.id);
        }
        self.messages.clear();
        self.draft.clear();
        release(std::mem::take(&mut self.attachments));
        self.attachment_feedback = None;
        self.progress = StreamProgress::default();
        self.pending_title.clear();
        self.interrupted = false;
        self.history_open = false;
        self.error = None;
    }

    fn accept_progress(&mut self) {
        if let Some(id) = self.progress.chat_id.clone() {
            if self.current.as_ref().is_none_or(|chat| chat.id != id) {
                let chat = Conversation {
                    id,
                    title: self.pending_title.clone(),
                    model: self.selected,
                    project: self.current.as_ref().map_or_else(
                        || self.project.as_ref().map(|project| project.id.clone()),
                        |chat| chat.project.clone(),
                    ),
                    pinned: false,
                };
                self.conversations.retain(|entry| entry.id != chat.id);
                let after_pins = self
                    .conversations
                    .iter()
                    .take_while(|entry| entry.pinned)
                    .count();
                self.conversations.insert(after_pins, chat.clone());
                self.current = Some(chat);
            }
        }
    }

    fn finish_message(&mut self) {
        let text = std::mem::take(&mut self.progress.text);
        let images = std::mem::take(&mut self.progress.images);
        if !text.is_empty() || !images.is_empty() {
            self.messages.push(Message {
                role: Role::Assistant,
                text,
                images,
            });
        }
        self.progress = StreamProgress::default();
    }

    fn replace_conversations(&mut self, project_id: Option<&str>, chats: Vec<Conversation>) {
        let updated_ids: std::collections::HashSet<_> =
            chats.iter().map(|chat| chat.id.as_str()).collect();
        self.conversations.retain(|entry| {
            entry.project.as_deref() != project_id && !updated_ids.contains(entry.id.as_str())
        });
        self.conversations.extend(chats);
        self.conversations.sort_by_key(|chat| !chat.pinned);
    }

    fn set_web_search_mode(&mut self, mode: &str) {
        self.web_search_disabled = mode == "disabled";
        if self.web_search_disabled {
            self.search = false;
        }
    }
}

enum Generation {
    Send {
        model: i64,
        chat: Option<Conversation>,
        project: Option<String>,
        prompt: String,
        attachments: Vec<Attachment>,
        image: Option<ImageModel>,
        search: bool,
    },
    Resume(StreamProgress),
}

fn generate(mut state: Signal<ChatState>, client: FranceStudent, request: Generation) -> Task {
    spawn(async move {
        let mut update_state = state;
        let update = move |progress: &StreamProgress| {
            let mut view = update_state.write();
            view.progress = progress.clone();
            view.accept_progress();
        };
        let result = match request {
            Generation::Send {
                model,
                chat,
                project,
                prompt,
                attachments,
                image,
                search,
            } => {
                let requested_image = image.is_some();
                let mut prepared = match client.prepare_image_request(prompt.clone(), image).await {
                    Ok(prepared) => prepared,
                    Err(error) => {
                        preparation_failed(state, error.to_string());
                        return;
                    }
                };
                let uploaded =
                    match prepare_attachments(state, &client, attachments, &mut prepared).await {
                        Ok(uploaded) => uploaded,
                        Err(error) => {
                            preparation_failed(state, error);
                            return;
                        }
                    };
                {
                    let mut view = state.write();
                    view.preparing = false;
                    view.pending_title = chat
                        .as_ref()
                        .map(|chat| chat.title.clone())
                        .unwrap_or_else(|| prompt.chars().take(65).collect());
                    view.progress = StreamProgress {
                        chat_id: chat.as_ref().map(|chat| chat.id.clone()),
                        ..StreamProgress::default()
                    };
                    view.messages.push(Message {
                        role: Role::User,
                        text: prompt,
                        images: Vec::new(),
                    });
                }
                let result = client
                    .send_with_attachments(
                        model,
                        chat.as_ref(),
                        project.as_deref(),
                        &prepared,
                        search,
                        uploaded,
                        update,
                    )
                    .await;
                if result.is_ok() {
                    let mut progress = state.peek().progress.clone();
                    client
                        .complete_generated_images(&mut progress, requested_image)
                        .await;
                    state.write().progress = progress;
                }
                result
            }
            Generation::Resume(progress) => {
                let result = client.resume(progress, update).await;
                if result.is_ok() {
                    let (mut progress, requested) = {
                        let view = state.peek();
                        (view.progress.clone(), view.image_mode.model().is_some())
                    };
                    client
                        .complete_generated_images(&mut progress, requested)
                        .await;
                    state.write().progress = progress;
                }
                result
            }
        };
        let mut view = state.write();
        view.busy = false;
        if let Err(error) = result {
            view.interrupted = true;
            view.error = Some(error.to_string());
        } else {
            view.draft.clear();
            release(std::mem::take(&mut view.attachments));
            view.attachment_feedback = None;
            view.interrupted = false;
            if view.progress.images.is_empty() {
                if view.image_mode.model().is_some() || view.progress.image_progress.announced() {
                    view.error = Some("Le service n’a renvoyé aucune image affichable.".into());
                } else if view.progress.text.is_empty() {
                    view.error = Some("La réponse ne contient aucun texte affichable.".into());
                }
            }
            if view.current.is_none() {
                view.interrupted = true;
                view.error = Some("Identifiant de discussion indisponible. Actualise l’historique pour retrouver la réponse.".into());
            }
            view.finish_message();
        }
    })
}

fn preparation_failed(mut state: Signal<ChatState>, error: String) {
    let mut view = state.write();
    view.busy = false;
    view.preparing = false;
    view.error = Some(error);
}

#[derive(Clone)]
pub struct ChatSession {
    pub client: FranceStudent,
    pub model: i64,
}

#[component]
pub fn Chat(
    title: &'static str,
    standalone: bool,
    #[props(default)] mobile: bool,
    on_session: Option<EventHandler<Option<ChatSession>>>,
) -> Element {
    let mut state = use_signal(ChatState::default);
    use_effect(move || {
        if mobile {
            document::eval(&format!("{PICKER_BRIDGE}\nreturn null;"));
        }
    });
    use_effect(move || {
        if let Some(callback) = on_session {
            let view = state.read();
            let session = view
                .client
                .clone()
                .zip(view.selected)
                .map(|(client, model)| ChatSession { client, model });
            callback.call(session);
        }
    });
    let store = try_use_context::<SecureSession>();
    let login_store = store.clone();
    let logout_store = store.clone();
    let remember = store.is_some();
    let mut cookie_mode = use_signal(move || !mobile);
    let mut cookie = use_signal(String::new);
    let mut email = use_signal(String::new);
    let mut password = use_signal(String::new);
    use_hook(move || {
        if let Some(store) = store {
            spawn(async move {
                match store.load() {
                    Ok(Some(cookie)) => {
                        connect(state, mobile, Some(store), Credentials::Saved(cookie))
                    }
                    Ok(None) => {}
                    Err(error) => state.write().error = Some(error),
                }
            });
        }
    });
    let mut generation = use_signal(|| None::<Task>);
    let mut tail = use_signal(|| None::<std::rc::Rc<MountedData>>);
    let transcript_position = use_memo(move || {
        let view = state.read();
        (
            !view.history_open && view.mobile_page == MobilePage::Chat,
            view.messages.len(),
            view.progress.text.len(),
            view.progress.images.len(),
        )
    });
    use_effect(move || {
        let (visible, messages, pending, images) = transcript_position();
        if visible && (messages > 0 || pending > 0 || images > 0) {
            if let Some(tail) = tail.read().clone() {
                spawn(async move {
                    let _ = tail.scroll_to(ScrollBehavior::Instant).await;
                });
            }
        }
    });
    let view = state.read();
    let connected = view.client.is_some();
    let busy = view.busy;
    let streaming = busy && generation.read().is_some();
    let history_open = view.history_open;
    let page = view.mobile_page;
    let project_id = view.project.as_ref().map(|project| project.id.as_str());
    let mut visible_conversations = view
        .conversations
        .iter()
        .filter(|chat| !mobile || chat.project.as_deref() == project_id)
        .peekable();
    let selected = view.selected.map(|id| id.to_string()).unwrap_or_default();
    let chat_title = view
        .current
        .as_ref()
        .map(|chat| chat.title.as_str())
        .unwrap_or("Nouvelle discussion");
    let can_send = !busy
        && !view.selecting_attachments
        && !view.interrupted
        && (!view.draft.trim().is_empty() || !view.attachments.is_empty())
        && view.selected.is_some();

    rsx! {
        section { class: if standalone { "chat chat-standalone" } else { "chat" }, aria_label: title,
            header { class: "chat-header",
                h1 { "{title}" }
                if connected {
                    button {
                        r#type: "button", disabled: mobile && busy,
                        aria_expanded: page == MobilePage::Chat && history_open,
                        onclick: move |_| {
                            let mut view = state.write();
                            view.history_open = view.mobile_page != MobilePage::Chat || !view.history_open;
                            view.mobile_page = MobilePage::Chat;
                        },
                        "Historique"
                    }
                    if mobile {
                        button {
                            r#type: "button", disabled: busy,
                            aria_expanded: page == MobilePage::Projects,
                            onclick: move |_| state.write().mobile_page = MobilePage::Projects,
                            "Projets"
                        }
                        button {
                            r#type: "button", disabled: busy,
                            aria_expanded: page == MobilePage::Settings,
                            onclick: move |_| state.write().mobile_page = MobilePage::Settings,
                            "Réglages"
                        }
                    }
                    button {
                        r#type: "button", disabled: busy,
                        onclick: move |_| {
                            if state.peek().busy { return; }
                            if let Some(store) = &logout_store {
                                if store.clear().is_err() {
                                    state.write().error = Some("Impossible de supprimer la session du coffre. Réessaie la déconnexion.".into());
                                    return;
                                }
                            }
                            generation.set(None);
                            cookie.set(String::new());
                            release(std::mem::take(&mut state.write().attachments));
                            state.set(ChatState::default());
                        },
                        "Déconnexion"
                    }
                }
            }
            if !connected {
                form { class: "login", onsubmit: move |event| {
                    event.prevent_default();
                    if state.peek().busy { return; }
                    let credentials = if cookie_mode() {
                        Credentials::Cookie(std::mem::take(&mut *cookie.write()))
                    } else {
                        Credentials::Password {
                            email: email.read().trim().to_owned(),
                            password: std::mem::take(&mut *password.write()),
                        }
                    };
                    connect(state, mobile, login_store.clone(), credentials);
                },
                    h2 { "Connexion FranceStudent" }
                    if remember {
                        p { "Ta session est conservée dans le coffre sécurisé de cet appareil jusqu’à la déconnexion." }
                    }
                    if cookie_mode() {
                        label { r#for: "session", "Cookie de session" }
                        input {
                            id: "session", r#type: "password", autocomplete: "off", spellcheck: "false",
                            disabled: busy, value: "{cookie}", oninput: move |event| cookie.set(event.value())
                        }
                    } else {
                        label { r#for: "login-email", "Adresse e-mail" }
                        input {
                            id: "login-email", r#type: "email", autocomplete: "username", spellcheck: "false",
                            disabled: busy, value: "{email}", oninput: move |event| email.set(event.value())
                        }
                        label { r#for: "login-password", "Mot de passe" }
                        input {
                            id: "login-password", r#type: "password", autocomplete: "current-password",
                            disabled: busy, value: "{password}", oninput: move |event| password.set(event.value())
                        }
                    }
                    button {
                        class: "primary", r#type: "submit",
                        disabled: busy || if cookie_mode() { cookie.read().trim().is_empty() } else { email.read().trim().is_empty() || password.read().is_empty() },
                        if busy { "Connexion…" } else { "Se connecter" }
                    }
                    if mobile {
                        button {
                            r#type: "button", disabled: busy,
                            onclick: move |_| {
                                let next = !cookie_mode();
                                cookie.set(String::new());
                                password.set(String::new());
                                cookie_mode.set(next);
                            },
                            if cookie_mode() { "Utiliser mon adresse e-mail" } else { "Utiliser un cookie de session" }
                        }
                    }
                    if let Some(error) = &view.error {
                        p { class: "error", role: "alert", "{error}" }
                    }
                }
            } else if page == MobilePage::Projects {
                Projects { state }
            } else if page == MobilePage::Settings {
                Settings { state }
            } else if page == MobilePage::Activity {
                Activity { state }
            } else if history_open {
                div { class: "history",
                    if let Some(project) = &view.project {
                        h2 { "Discussions de {project.name}" }
                    }
                    div { class: "history-toolbar",
                        button {
                            class: "primary", r#type: "button", disabled: busy,
                            onclick: move |_| state.write().clear_chat(), "Nouvelle discussion"
                        }
                        button {
                            r#type: "button", disabled: busy,
                            onclick: move |_| {
                                let (client, project) = {
                                    let view = state.peek();
                                    if view.busy { return; }
                                    (view.client.clone(), view.project.as_ref().map(|project| project.id.clone()))
                                };
                                let Some(client) = client else { return; };
                                {
                                    let mut view = state.write();
                                    view.busy = true;
                                    view.error = None;
                                }
                                generation.set(None);
                                spawn(async move {
                                    let result = match project.as_deref() {
                                        Some(id) => client.project_conversations(id).await,
                                        None => client.conversations().await,
                                    };
                                    let mut view = state.write();
                                    view.busy = false;
                                    match result {
                                        Ok(chats) => {
                                            if project.is_some() {
                                                view.replace_conversations(project.as_deref(), chats);
                                            } else {
                                                view.conversations = chats;
                                            }
                                        }
                                        Err(error) => view.error = Some(error.to_string()),
                                    }
                                });
                            }, "Actualiser"
                        }
                    }
                    if let Some(error) = &view.error {
                        p { class: "error", role: "alert", "{error}" }
                    }
                    if visible_conversations.peek().is_none() && !busy {
                        p { class: "muted", "Aucune discussion enregistrée." }
                    }
                    ul {
                        for chat in visible_conversations {
                            li { key: "{chat.id}",
                                button {
                                    r#type: "button", disabled: busy, title: "{chat.title}",
                                    onclick: {
                                        let chat = chat.clone();
                                        move |_| open_chat(state, generation, chat.clone())
                                    },
                                    if chat.pinned { span { class: "muted", "Épinglée · " } }
                                    "{chat.title}"
                                }
                            }
                        }
                    }
                }
            } else {
                if let Some(project) = &view.project {
                    div { class: "chat-project",
                        p { "Projet : {project.name}" }
                        button {
                            r#type: "button", disabled: busy,
                            onclick: move |_| {
                                let mut view = state.write();
                                view.project = None;
                                view.clear_chat();
                            },
                            "Quitter le projet"
                        }
                    }
                }
                div { class: "chat-topic",
                    h2 { "{chat_title}" }
                    if view.current.is_some() || !view.messages.is_empty() {
                        button { r#type: "button", disabled: busy, onclick: move |_| state.write().clear_chat(), "Nouveau" }
                    }
                }
                div { class: "transcript", aria_label: "Messages",
                    if view.messages.is_empty() && !busy {
                        p { class: "muted", "Écris un message pour commencer." }
                    }
                    for message in &view.messages {
                        MessageBubble { role: message.role, text: message.text.clone(), images: message.images.clone() }
                    }
                    if !view.progress.text.is_empty() || !view.progress.images.is_empty() {
                        MessageBubble { role: Role::Assistant, text: view.progress.text.clone(), images: view.progress.images.clone() }
                    }
                    if streaming && view.progress.text.is_empty() && view.progress.images.is_empty() {
                        p { class: "muted", role: "status",
                            if view.preparing {
                                "Préparation du message…"
                            } else if view.image_mode.model().is_some() || view.progress.image_progress.announced() {
                                "Génération d’image en cours…"
                            } else {
                                "Réponse en cours…"
                            }
                        }
                    }
                    div { aria_hidden: "true", onmounted: move |event| tail.set(Some(event.data())) }
                }
                if let Some(error) = &view.error {
                    div { class: "chat-notice",
                        p { class: "error", role: "alert", "{error}" }
                        if !busy && view.interrupted && view.progress.can_resume() {
                            button { r#type: "button", onclick: move |_| {
                                let (client, progress) = {
                                    let view = state.peek();
                                    if view.busy || !view.interrupted || !view.progress.can_resume() { return; }
                                    (view.client.clone(), view.progress.clone())
                                };
                                let Some(client) = client else { return; };
                                {
                                    let mut view = state.write();
                                    view.busy = true;
                                    view.error = None;
                                }
                                generation.set(Some(generate(state, client, Generation::Resume(progress))));
                            }, "Reprendre la réponse" }
                        }
                    }
                }
                form { class: "composer", onsubmit: move |event| {
                    event.prevent_default();
                    let (client, request) = {
                        let mut view = state.write();
                        let Some(client) = view.client.clone() else { return; };
                        let Some(model) = view.selected else { return; };
                        if view.busy || view.selecting_attachments || view.interrupted { return; }
                        let attachments = view.attachments.clone();
                        let prompt = if view.draft.trim().is_empty() {
                            if attachments.is_empty() { return; }
                            "Analyse les pièces jointes.".to_owned()
                        } else {
                            view.draft.trim().to_owned()
                        };
                        let chat = view.current.clone();
                        view.error = None;
                        view.busy = true;
                        view.preparing = true;
                        let project = view.project.as_ref().map(|project| project.id.clone());
                        let image = if mobile { view.image_mode.model() } else { None };
                        (client, Generation::Send { model, chat, project, prompt, attachments, image, search: view.search })
                    };
                    generation.set(Some(generate(state, client, request)));
                },
                    textarea {
                        aria_label: "Message", placeholder: "Écris ton message…", rows: "3",
                        value: "{view.draft}", disabled: busy, oninput: move |event| state.write().draft = event.value()
                    }
                    if mobile {
                        Attachments { state }
                    }
                    div { class: "composer-actions",
                        select {
                            aria_label: "Modèle", value: "{selected}", disabled: busy || view.current.is_some(),
                            onchange: move |event| {
                                if let Ok(id) = event.value().parse() {
                                    let mut view = state.write();
                                    if view.models.iter().any(|model| model.id == id) { view.selected = Some(id); }
                                }
                            },
                            if let Some(id) = view.selected.filter(|id| !view.models.iter().any(|model| model.id == *id)) {
                                option { value: "{id}", "Modèle {id}" }
                            }
                            for model in &view.models {
                                option { key: "{model.id}", value: "{model.id}", "{model.name}" }
                            }
                        }
                        label { class: "checkbox",
                            input {
                                r#type: "checkbox", checked: view.search, disabled: busy || view.web_search_disabled,
                                onchange: move |event| state.write().search = event.checked()
                            }
                            "Recherche web"
                        }
                        if mobile {
                            ImageControls {
                                mode: view.image_mode.clone(), disabled: busy,
                                on_change: move |mode| state.write().image_mode = mode
                            }
                        }
                        if streaming {
                            button { r#type: "button", onclick: move |_| stop(state, generation), "Arrêter" }
                        } else {
                            button { class: "primary", r#type: "submit", disabled: !can_send, "Envoyer" }
                        }
                    }
                }
            }
        }
    }
}

fn open_chat(
    mut state: Signal<ChatState>,
    mut generation: Signal<Option<Task>>,
    chat: Conversation,
) {
    let client = {
        let view = state.peek();
        if view.busy {
            return;
        }
        view.client.clone()
    };
    let Some(client) = client else {
        return;
    };
    generation.set(None);
    {
        let mut view = state.write();
        view.busy = true;
        view.error = None;
    }
    spawn(async move {
        let result = client.messages(&chat.id).await;
        let mut view = state.write();
        view.busy = false;
        match result {
            Ok(messages) => {
                view.clear_chat();
                view.selected = chat.model.or(view.selected);
                view.current = Some(chat);
                view.messages = messages;
            }
            Err(error) => view.error = Some(error.to_string()),
        }
    });
}

fn stop(mut state: Signal<ChatState>, mut generation: Signal<Option<Task>>) {
    let task = generation.write().take();
    let Some(task) = task else {
        return;
    };
    task.cancel();
    let (client, chat_id) = {
        let mut view = state.write();
        if view.preparing {
            view.preparing = false;
            view.busy = false;
            view.error = None;
            return;
        }
        let chat_id = view.progress.chat_id.clone();
        view.finish_message();
        view.interrupted = true;
        (view.client.clone(), chat_id)
    };
    let (Some(client), Some(chat_id)) = (client, chat_id) else {
        let mut view = state.write();
        view.busy = false;
        view.error = Some("Lecture arrêtée. Actualise l’historique pour vérifier si le serveur a reçu le message.".into());
        return;
    };
    spawn(async move {
        let result = client.cancel(&chat_id).await;
        let mut view = state.write();
        view.busy = false;
        view.error = Some(match result {
            Ok(()) => {
                "Réponse arrêtée. Rouvre la discussion pour synchroniser son historique.".into()
            }
            Err(error) => format!("Arrêt côté serveur non confirmé. {error}"),
        });
    });
}

#[component]
fn MessageBubble(role: Role, text: String, images: Vec<GeneratedImage>) -> Element {
    let (class, label) = match role {
        Role::User => ("message user", "Toi"),
        Role::Assistant => ("message assistant", "FranceStudent"),
    };
    rsx! {
        article { class,
            h3 { "{label}" }
            if !text.is_empty() {
                p { "{text}" }
            }
            GeneratedImages { images }
        }
    }
}
