use dioxus::prelude::*;
use francestudent::{FranceStudent, WebDomainSettings, WebFilterType, WebSearchMode};

use crate::ChatState;

#[derive(Default)]
struct WebPanel {
    open: bool,
    mode: WebSearchMode,
    filter: WebFilterType,
    allowed: String,
    blocked: String,
    domains_loaded: bool,
    loading: bool,
    feedback: Option<(String, bool)>,
}

#[component]
pub(crate) fn WebSettings(mut state: Signal<ChatState>, initial_mode: String) -> Element {
    let mut panel = use_signal(|| WebPanel {
        mode: WebSearchMode::parse(&initial_mode).unwrap_or_default(),
        ..WebPanel::default()
    });
    let view = panel.read();
    let busy = state.read().busy;

    rsx! {
        section { class: "mobile-web-settings",
            h3 { "Recherche web" }
            if !view.open {
                button { r#type: "button", disabled: busy,
                    onclick: move |_| {
                        panel.write().open = true;
                        if let Some(client) = { state.peek().client.clone() } {
                            spawn(load_domains(panel, client));
                        }
                    },
                    "Modifier les filtres"
                }
            } else {
                form { class: "mobile-form", onsubmit: move |event| {
                    event.prevent_default();
                    save(state, panel);
                },
                    label { r#for: "search-mode", "Mode de recherche" }
                    select {
                        id: "search-mode", value: view.mode.as_str(), disabled: busy,
                        onchange: move |event| {
                            if let Some(mode) = WebSearchMode::parse(&event.value()) {
                                panel.write().mode = mode;
                            }
                        },
                        option { value: "open", "Sans restriction" }
                        option { value: "filtered", "Sites filtrés" }
                        option { value: "disabled", "Désactivée" }
                    }
                    if view.mode == WebSearchMode::Filtered {
                        if view.domains_loaded {
                            label { r#for: "domain-filter", "Type de filtre" }
                            select {
                                id: "domain-filter", disabled: busy,
                                value: if view.filter == WebFilterType::Allowlist { "allowlist" } else { "blocklist" },
                                onchange: move |event| panel.write().filter = if event.value() == "allowlist" {
                                    WebFilterType::Allowlist
                                } else {
                                    WebFilterType::Blocklist
                                },
                                option { value: "allowlist", "Autoriser seulement ces sites" }
                                option { value: "blocklist", "Bloquer ces sites" }
                            }
                            label { r#for: "allowed-domains", "Domaines autorisés" }
                            textarea { id: "allowed-domains", rows: "3", disabled: busy,
                                value: "{view.allowed}",
                                oninput: move |event| panel.write().allowed = event.value()
                            }
                            label { r#for: "blocked-domains", "Domaines bloqués" }
                            textarea { id: "blocked-domains", rows: "3", disabled: busy,
                                value: "{view.blocked}",
                                oninput: move |event| panel.write().blocked = event.value()
                            }
                        } else if view.loading {
                            p { class: "muted", role: "status", "Chargement des domaines…" }
                        } else {
                            button { r#type: "button", disabled: busy, onclick: move |_| {
                                if let Some(client) = { state.peek().client.clone() } {
                                    spawn(load_domains(panel, client));
                                }
                            }, "Réessayer le chargement" }
                        }
                    }
                    div { class: "mobile-page-actions",
                        button { class: "primary", r#type: "submit",
                            disabled: busy || view.loading || (view.mode == WebSearchMode::Filtered && !view.domains_loaded),
                            "Enregistrer la recherche web"
                        }
                    }
                }
            }
            if let Some((message, error)) = &view.feedback {
                p { class: if *error { "error" } else { "muted" },
                    role: if *error { "alert" } else { "status" },
                    "{message}"
                }
            }
        }
    }
}

async fn load_domains(mut panel: Signal<WebPanel>, client: FranceStudent) {
    if panel.peek().loading {
        return;
    }
    {
        let mut view = panel.write();
        view.loading = true;
        view.feedback = None;
    }
    let result = client.web_domain_settings().await;
    let mut view = panel.write();
    view.loading = false;
    match result {
        Ok(domains) => {
            view.domains_loaded = true;
            view.filter = domains.filter_type;
            view.allowed = domains.allowed_domains.join("\n");
            view.blocked = domains.blocked_domains.join("\n");
        }
        Err(error) => view.feedback = Some((format!("Filtres indisponibles. {error}"), true)),
    }
}

fn save(mut state: Signal<ChatState>, mut panel: Signal<WebPanel>) {
    let (mode, domains) = {
        let view = panel.peek();
        if view.loading || (view.mode == WebSearchMode::Filtered && !view.domains_loaded) {
            return;
        }
        let domains = (view.mode == WebSearchMode::Filtered)
            .then(|| WebDomainSettings::from_input(view.filter, &view.allowed, &view.blocked))
            .transpose();
        (view.mode, domains)
    };
    let domains = match domains {
        Ok(domains) => domains,
        Err(error) => {
            panel.write().feedback = Some((error.into(), true));
            return;
        }
    };
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
        let result = async {
            if let Some(domains) = &domains {
                client
                    .save_web_domain_settings(domains)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            client.save_web_search_mode(mode).await.map_err(|error| {
                if domains.is_some() {
                        format!("Domaines enregistrés. Impossible de confirmer l’enregistrement du mode. {error}")
                } else {
                    error.to_string()
                }
            })
        }
        .await;
        let mut chat = state.write();
        chat.busy = false;
        panel.write().feedback = Some(match result {
            Ok(()) => {
                chat.set_web_search_mode(mode.as_str());
                ("Préférences de recherche enregistrées.".into(), false)
            }
            Err(error) => (error, true),
        });
    });
}
