use std::sync::Arc;

use dioxus::prelude::*;
use francestudent::{Error, FranceStudent};

use crate::ChatState;

pub trait SecureSessionStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, String>;
    fn save(&self, cookie: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

pub type SecureSession = Arc<dyn SecureSessionStore>;

pub(crate) enum Credentials {
    Cookie(String),
    Password { email: String, password: String },
    Saved(String),
}

pub(crate) fn connect(
    mut state: Signal<ChatState>,
    mobile: bool,
    store: Option<SecureSession>,
    credentials: Credentials,
) {
    if state.peek().busy {
        return;
    }
    {
        let mut view = state.write();
        view.busy = true;
        view.error = None;
    }
    spawn(async move {
        let restore = matches!(credentials, Credentials::Saved(_));
        let cookie = match credentials {
            Credentials::Cookie(cookie) | Credentials::Saved(cookie) => Ok(cookie),
            Credentials::Password { email, password } => {
                FranceStudent::login_cookie(&email, password).await
            }
        };
        let client = match cookie.and_then(|cookie| FranceStudent::new(&cookie)) {
            Ok(client) => client,
            Err(error) => {
                failure(state, store.as_ref(), restore, error);
                return;
            }
        };
        let models = match client.models().await {
            Ok(models) => models,
            Err(error) => {
                failure(state, store.as_ref(), restore, error);
                return;
            }
        };
        let (client, persistence_error) = if let Some(store) = store {
            let error = match client.session_value().await {
                Some(cookie) => store.save(&cookie).err(),
                None => Some("Le cookie de session est indisponible.".to_owned()),
            };
            (
                client.with_session_sink(move |cookie| {
                    let _ = store.save(cookie);
                }),
                error,
            )
        } else {
            (client, None)
        };
        let history = client.conversations().await;
        let settings = if mobile {
            client.general_settings().await.ok()
        } else {
            None
        };
        let mut view = state.write();
        view.busy = false;
        view.selected = models
            .iter()
            .find(|model| model.preferred)
            .or_else(|| models.first())
            .map(|model| model.id);
        view.models = models;
        view.client = Some(client);
        match history {
            Ok(history) => view.conversations = history,
            Err(error) => view.error = Some(error.to_string()),
        }
        if let Some(settings) = settings {
            view.set_web_search_mode(&settings.web_search_mode);
        }
        if persistence_error.is_some() {
            view.error = persistence_error;
        }
    });
}

fn failure(
    mut state: Signal<ChatState>,
    store: Option<&SecureSession>,
    restore: bool,
    error: Error,
) {
    let mut view = state.write();
    view.busy = false;
    view.error = Some(error.to_string());
    if restore && matches!(error, Error::Unauthorized | Error::InvalidSession) {
        if store.is_some_and(|store| store.clear().is_err()) {
            view.error = Some("La session a expiré et sa suppression du coffre a échoué.".into());
        }
    }
}
