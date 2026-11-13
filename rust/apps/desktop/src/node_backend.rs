use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tao::event_loop::EventLoopProxy;

use crate::desktop_host::{HostEvent, Result};

pub const MAX_MESSAGE: usize = 64 * 1024 * 1024;
type Callback = SyncSender<std::result::Result<Value, String>>;
type Callbacks = Arc<Mutex<HashMap<String, Callback>>>;

#[derive(Clone)]
pub struct ServiceBridge {
    output: SyncSender<Vec<u8>>,
    callbacks: Callbacks,
}

pub struct NodeBackend {
    child: Child,
    output: Option<SyncSender<Vec<u8>>>,
    callbacks: Callbacks,
}

impl NodeBackend {
    pub fn start(
        root: &Path,
        profile: &Path,
        proxy: EventLoopProxy<HostEvent>,
        account_transport: bool,
    ) -> Result<Self> {
        let token = uuid::Uuid::new_v4().to_string();
        let mut command = Command::new("node");
        command
            .arg(root.join("desktop/main.js"))
            .arg("--rust-host")
            .current_dir(root)
            .env("FS_CODEX_COPY_DATA", profile)
            .env("FS_DATA_DIR", profile.join("core"))
            .env("FS_STATE_DIR", profile.join("state"))
            .env("FS_RUST_HOST_TOKEN", &token)
            .env("NODE_USE_SYSTEM_CA", "1")
            .env(
                "FS_RUST_ACCOUNT_TRANSPORT",
                if account_transport { "1" } else { "0" },
            )
            .env("FS_RUST_NATIVE_SERVICES", "1")
            .env("FS_RUST_NATIVE_SKILLS", "1")
            .env_remove("FS_RUST_OPEN_FOLDER")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if let Some(folder) = std::env::args_os().nth(1) {
            let path = std::env::current_dir()?.join(folder);
            let resolved = path
                .canonicalize()
                .map_err(|_| "Le dossier de projet donné au lancement est introuvable.")?;
            if !resolved.is_dir() {
                return Err("Le chemin donné au lancement doit être un dossier.".into());
            }
            // Node understands ordinary Windows drive paths. Preserve the path supplied by the user.
            command.env("FS_RUST_OPEN_FOLDER", path);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| {
            format!("Impossible de lancer Node.js pour les services de l’IDE : {error}")
        })?;
        let mut input = child.stdin.take().expect("Entrée du service configurée");
        let output = child.stdout.take().expect("Sortie du service configurée");
        let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(32);
        let callbacks: Callbacks = Arc::new(Mutex::new(HashMap::new()));
        let pending = callbacks.clone();
        thread::spawn(move || {
            for line in receiver {
                if input
                    .write_all(&line)
                    .and_then(|()| input.write_all(b"\n"))
                    .is_err()
                {
                    break;
                }
            }
        });
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            let mut line = Vec::new();
            while let Ok(length) = reader
                .by_ref()
                .take((MAX_MESSAGE + 2) as u64)
                .read_until(b'\n', &mut line)
            {
                if length == 0 || length > MAX_MESSAGE + 1 {
                    break;
                }
                if let Ok(Value::Object(mut packet)) = serde_json::from_slice(&line) {
                    if packet.remove("token").as_ref().and_then(Value::as_str) == Some(&token) {
                        if packet.get("kind").and_then(Value::as_str) == Some("agentCallbackReply")
                        {
                            if let Some(id) = packet.get("id").and_then(Value::as_str) {
                                if let Some(callback) = pending.lock().unwrap().remove(id) {
                                    let result = if packet.get("ok").and_then(Value::as_bool)
                                        == Some(true)
                                    {
                                        Ok(packet.remove("value").unwrap_or_default())
                                    } else {
                                        Err(packet
                                            .get("error")
                                            .and_then(Value::as_str)
                                            .unwrap_or("Service indisponible.")
                                            .to_owned())
                                    };
                                    let _ = callback.try_send(result);
                                }
                            }
                            line.clear();
                            continue;
                        }
                        if proxy
                            .send_event(HostEvent::Backend(Value::Object(packet)))
                            .is_err()
                        {
                            return;
                        }
                    }
                }
                line.clear();
            }
            pending.lock().unwrap().clear();
            let _ = proxy.send_event(HostEvent::Disconnected);
        });
        Ok(Self {
            child,
            output: Some(sender),
            callbacks,
        })
    }

    pub fn send(&self, packet: &Value) -> Result<()> {
        let output = self
            .output
            .as_ref()
            .ok_or("Le service de l’IDE est arrêté.")?;
        send(output, packet)
    }

    pub fn service(&self) -> Option<ServiceBridge> {
        Some(ServiceBridge {
            output: self.output.as_ref()?.clone(),
            callbacks: self.callbacks.clone(),
        })
    }

    pub fn offline(&mut self) {
        self.output.take();
        self.callbacks.lock().unwrap().clear();
    }

    pub fn close(&mut self) {
        self.offline();
        let until = Instant::now() + Duration::from_millis(2600);
        while Instant::now() < until {
            if self.child.try_wait().is_ok_and(|status| status.is_some()) {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn encode_packet(packet: &Value) -> Result<Vec<u8>> {
    let data = serde_json::to_vec(packet)?;
    if data.len() > MAX_MESSAGE {
        return Err("La demande dépasse la limite de transfert.".into());
    }
    Ok(data)
}

fn send(output: &SyncSender<Vec<u8>>, packet: &Value) -> Result<()> {
    output
        .try_send(encode_packet(packet)?)
        .map_err(|error| match error {
            mpsc::TrySendError::Full(_) => {
                "Le service de l’IDE reçoit trop de demandes. Réessaie.".into()
            }
            mpsc::TrySendError::Disconnected(_) => "Le service de l’IDE est arrêté.".into(),
        })
}

impl ServiceBridge {
    pub fn send_reply(&self, packet: &Value) -> Result<()> {
        self.output
            .send(encode_packet(packet)?)
            .map_err(|_| "Le service de l’IDE est arrêté.".into())
    }

    pub fn call(
        &self,
        run: &str,
        method: &str,
        payload: Value,
        stop: &AtomicBool,
    ) -> Result<Value> {
        if stop.load(Ordering::Acquire) {
            return Err("Tâche interrompue.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::sync_channel(1);
        self.callbacks.lock().unwrap().insert(id.clone(), sender);
        let packet =
            json!({"kind":"agentCallback","id":id,"run":run,"method":method,"payload":payload});
        let result = send(&self.output, &packet).and_then(|()| {
            loop {
                match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(result) => break result.map_err(Into::into),
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        break Err("Service interrompu.".into());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) if stop.load(Ordering::Acquire) => {
                        break Err("Tâche interrompue.".into());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
        });
        self.callbacks.lock().unwrap().remove(&id);
        result
    }
}
impl Drop for NodeBackend {
    fn drop(&mut self) {
        self.close();
    }
}
