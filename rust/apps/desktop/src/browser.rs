use serde_json::{Value, json};
use tao::{event_loop::EventLoopProxy, window::Window};
use url::Url;

use crate::desktop_host::{HostEvent, Result};

pub struct Browser {
    proxy: EventLoopProxy<HostEvent>,
    view: Option<wry::WebView>,
    generation: u64,
    url: String,
    title: String,
    loading: bool,
    visible: bool,
    history: Vec<String>,
    index: usize,
}

impl Browser {
    pub fn new(proxy: EventLoopProxy<HostEvent>) -> Self {
        Self {
            proxy,
            view: None,
            generation: 0,
            url: String::new(),
            title: String::new(),
            loading: false,
            visible: false,
            history: Vec::new(),
            index: 0,
        }
    }

    pub fn action(&mut self, window: &Window, request: &Value) -> Result<Value> {
        let payload = &request["payload"];
        match request["action"].as_str() {
            Some("open") => {
                let url = browser_url(
                    payload["url"]
                        .as_str()
                        .ok_or("Adresse du site manquante.")?,
                )?;
                self.ensure(window)?;
                self.visible = true;
                self.navigate(url.as_str())?;
            }
            Some("bounds") => {
                if let Some(view) = &self.view {
                    let number = |name| payload[name].as_f64().unwrap_or_default().max(0.0);
                    let available = window.inner_size().to_logical::<f64>(window.scale_factor());
                    let x = number("x").min(available.width);
                    let y = number("y").min(available.height);
                    let width = number("width").min(available.width - x);
                    let height = number("height").min(available.height - y);
                    view.set_bounds(wry::Rect {
                        position: tao::dpi::LogicalPosition::new(x, y).into(),
                        size: tao::dpi::LogicalSize::new(width, height).into(),
                    })?;
                    view.set_visible(
                        self.visible && payload["visible"] == true && width > 0.0 && height > 0.0,
                    )?;
                }
            }
            Some("show") => self.visible = true,
            Some("hide") => {
                self.visible = false;
                if let Some(view) = &self.view {
                    view.set_visible(false)?;
                }
            }
            Some("close") => {
                self.view = None;
                self.generation = self.generation.wrapping_add(1);
                self.history.clear();
                self.index = 0;
                self.url.clear();
                self.title.clear();
                self.loading = false;
                self.visible = false;
            }
            Some("status") => {}
            Some("reload") => {
                if !self.url.is_empty() {
                    self.navigate(&self.url.clone())?;
                }
            }
            Some("back") if self.index > 0 => {
                self.index -= 1;
                self.navigate(&self.history[self.index].clone())?;
            }
            Some("forward") if self.index + 1 < self.history.len() => {
                self.index += 1;
                self.navigate(&self.history[self.index].clone())?;
            }
            Some("back" | "forward") => {}
            Some("devtools") =>
            {
                #[cfg(debug_assertions)]
                if let Some(view) = &self.view {
                    view.open_devtools();
                }
            }
            _ => return Err("Action du navigateur inconnue.".into()),
        }
        Ok(self.state())
    }

    fn navigate(&mut self, url: &str) -> Result<()> {
        if let Some(view) = &self.view {
            view.load_url(url)?;
            self.url = url.into();
            self.loading = true;
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn ensure(&mut self, window: &Window) -> Result<()> {
        if self.view.is_some() {
            return Ok(());
        }
        let generation = self.generation;
        let pages = self.proxy.clone();
        let titles = self.proxy.clone();
        let view = wry::WebViewBuilder::new()
            .with_incognito(true)
            .with_visible(false)
            .with_devtools(cfg!(debug_assertions))
            .with_navigation_handler(|url| browser_url(&url).is_ok())
            .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
            .with_download_started_handler(|_, _| false)
            .with_on_page_load_handler(move |event, url| {
                let loading = matches!(event, wry::PageLoadEvent::Started);
                let _ = pages.send_event(HostEvent::BrowserPage {
                    generation,
                    url,
                    loading,
                });
            })
            .with_document_title_changed_handler(move |title| {
                let _ = titles.send_event(HostEvent::BrowserTitle { generation, title });
            })
            .build_as_child(window)?;
        deny_browser_permissions(&view)?;
        self.view = Some(view);
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    fn ensure(&mut self, _: &Window) -> Result<()> {
        Err("Le navigateur intégré reste à porter sur cette plateforme.".into())
    }

    pub fn page(&mut self, generation: u64, url: String, loading: bool) -> Option<Value> {
        if generation != self.generation || self.view.is_none() || browser_url(&url).is_err() {
            return None;
        }
        self.url = url;
        self.loading = loading;
        if !loading && self.history.get(self.index) != Some(&self.url) {
            self.history.truncate(self.index + 1);
            self.history.push(self.url.clone());
            self.index = self.history.len() - 1;
        }
        Some(self.state())
    }

    pub fn title(&mut self, generation: u64, title: String) -> Option<Value> {
        if generation != self.generation || self.view.is_none() {
            return None;
        }
        self.title = title;
        Some(self.state())
    }

    fn state(&self) -> Value {
        json!({
            "url": self.url,
            "title": if self.title.is_empty() { "Navigateur local" } else { &self.title },
            "loading": self.loading,
            "error": "",
            "canGoBack": self.index > 0,
            "canGoForward": self.index + 1 < self.history.len(),
        })
    }
}

fn browser_url(value: &str) -> Result<Url> {
    let url = Url::parse(value)?;
    if matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
    {
        Ok(url)
    } else {
        Err("Seules les adresses HTTP et HTTPS sans identifiants sont autorisées.".into())
    }
}

#[cfg(target_os = "windows")]
fn deny_browser_permissions(view: &wry::WebView) -> Result<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_DENY,
        PermissionRequestedEventHandler,
    };
    use wry::WebViewExtWindows;

    // WebView2 owns the callback after registration. The browser has no native bridge.
    unsafe {
        view.webview().add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
                Ok(())
            })),
            &mut 0,
        )?;
    }
    Ok(())
}
