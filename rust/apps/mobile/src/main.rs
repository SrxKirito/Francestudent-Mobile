#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chat_ui::{Chat, Styles};
use dioxus::prelude::*;

#[cfg(any(target_os = "android", target_os = "ios"))]
mod session;

fn main() {
    dioxus::launch(app);
}

fn app() -> Element {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    use_context_provider(|| std::sync::Arc::new(session::MobileSession) as chat_ui::SecureSession);
    rsx! {
        Styles {}
        main { class: "mobile-shell",
            Chat { title: "FranceStudent Chat", standalone: true, mobile: true }
        }
    }
}
