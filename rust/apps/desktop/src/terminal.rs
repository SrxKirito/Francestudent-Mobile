use std::{
    collections::HashMap,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

use command_group::CommandGroup;
use portable_pty::{ChildKiller, CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use serde_json::{Value, json};
use tao::event_loop::EventLoopProxy;

use crate::desktop_host::{HostEvent, Result};

#[derive(Deserialize)]
pub struct Shell {
    file: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    name: String,
    #[serde(default)]
    restricted: bool,
}

impl Shell {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.file);
        command
            .args(&self.args)
            .current_dir(&self.cwd)
            .env_remove("NO_COLOR")
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor")
            .env("TERM_PROGRAM", "FranceStudentCode");
        if self.restricted {
            for (name, _) in std::env::vars_os() {
                let upper = name.to_string_lossy().to_ascii_uppercase();
                if upper.starts_with("FS_")
                    || [
                        "TOKEN",
                        "SECRET",
                        "KEY",
                        "PASSWORD",
                        "PASSWD",
                        "CREDENTIAL",
                        "FORCE_COLOR",
                    ]
                    .iter()
                    .any(|part| upper.contains(part))
                {
                    command.env_remove(name);
                }
            }
            command.env("NO_COLOR", "1");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
    }
}

enum Input {
    Write(String),
    Resize(PtySize),
}

enum Running {
    Pty(SyncSender<Input>, Box<dyn ChildKiller + Send + Sync>),
    Command(Arc<AtomicBool>),
}

#[derive(Default)]
pub struct Terminals {
    next_id: u64,
    active: HashMap<u64, Running>,
}

impl Terminals {
    pub fn action(&mut self, p: &Value, proxy: &EventLoopProxy<HostEvent>) -> Result<Value> {
        let id = p["id"].as_u64().unwrap_or_default();
        match p["action"].as_str() {
            Some("create" | "run") => {
                if self.active.len() >= 32 {
                    return Err("Ferme un terminal avant d’en ouvrir un autre.".into());
                }
                let shell = serde_json::from_value::<Shell>(p["shell"].clone())?;
                self.next_id += 1;
                let id = self.next_id;
                if p["action"] == "create" {
                    self.create(id, shell, size(p), proxy.clone())
                } else {
                    let stop = Arc::new(AtomicBool::new(false));
                    self.active.insert(id, Running::Command(stop.clone()));
                    let proxy = proxy.clone();
                    thread::spawn(move || {
                        let output = proxy.clone();
                        let result = run(&shell, &stop, None, move |text| {
                            event(&output, "terminalData", json!({ "id": id, "text": text }));
                        });
                        if let Err(error) = &result {
                            event(
                                &proxy,
                                "terminalData",
                                json!({ "id": id, "text": format!("{error}\n") }),
                            );
                        }
                        let code = result.ok().and_then(|output| output["exit_code"].as_i64());
                        let _ = proxy.send_event(HostEvent::TerminalEnded {
                            id,
                            pty: false,
                            code,
                        });
                    });
                    Ok(json!(id))
                }
            }
            Some("write" | "resize") => {
                let Some(Running::Pty(sender, _)) = self.active.get(&id) else {
                    return Ok(json!(false));
                };
                let input = if p["action"] == "resize" {
                    Input::Resize(size(p))
                } else {
                    Input::Write(
                        p["data"]
                            .as_str()
                            .ok_or("Entrée du terminal invalide.")?
                            .to_owned(),
                    )
                };
                sender
                    .try_send(input)
                    .map_err(|_| "Le terminal ne reçoit plus d’entrées ou sa file est pleine.")?;
                Ok(json!(true))
            }
            Some("kill") => {
                let existed = self.stop(id);
                Ok(json!(existed))
            }
            Some("stopAll") => {
                self.stop_all();
                Ok(Value::Null)
            }
            _ => Err("Action de terminal inconnue.".into()),
        }
    }

    fn create(
        &mut self,
        id: u64,
        shell: Shell,
        dimensions: PtySize,
        proxy: EventLoopProxy<HostEvent>,
    ) -> Result<Value> {
        let pair = native_pty_system().openpty(dimensions)?;
        let mut command = CommandBuilder::new(shell.file);
        command.args(shell.args);
        command.cwd(shell.cwd);
        command.env_remove("NO_COLOR");
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "FranceStudentCode");
        let reader = pair.master.try_clone_reader()?;
        let mut writer = pair.master.take_writer()?;
        let mut child = pair.slave.spawn_command(command)?;
        drop(pair.slave);
        let pid = child.process_id();
        let killer = child.clone_killer();
        let (sender, receiver) = mpsc::sync_channel(256);
        self.active.insert(id, Running::Pty(sender, killer));
        let master = pair.master;
        thread::spawn(move || {
            for input in receiver {
                match input {
                    Input::Write(text) => {
                        if writer
                            .write_all(text.as_bytes())
                            .and_then(|()| writer.flush())
                            .is_err()
                        {
                            break;
                        }
                    }
                    Input::Resize(size) => {
                        let _ = master.resize(size);
                    }
                }
            }
        });
        let output = proxy.clone();
        let reader = thread::spawn(move || {
            drain(reader, |text| {
                event(&output, "ptyData", json!({"id": id, "data": text}))
            });
        });
        thread::spawn(move || {
            let code = child
                .wait()
                .ok()
                .map(|status| i64::from(status.exit_code()));
            // Ferme le master pour libérer le lecteur, puis laisse passer les derniers octets.
            let _ = proxy.send_event(HostEvent::TerminalExited(id));
            let _ = reader.join();
            let _ = proxy.send_event(HostEvent::TerminalEnded {
                id,
                pty: true,
                code,
            });
        });
        Ok(json!({ "id": id, "pid": pid, "shell": shell.name }))
    }

    pub fn forget(&mut self, id: u64) {
        self.active.remove(&id);
    }

    fn stop(&mut self, id: u64) -> bool {
        let Some(terminal) = self.active.remove(&id) else {
            return false;
        };
        match terminal {
            Running::Pty(_, mut killer) => {
                thread::spawn(move || {
                    let _ = killer.kill();
                });
            }
            Running::Command(stop) => stop.store(true, Ordering::Release),
        }
        true
    }

    pub fn stop_all(&mut self) {
        let ids: Vec<_> = self.active.keys().copied().collect();
        for id in ids {
            self.stop(id);
        }
    }
}

fn size(value: &Value) -> PtySize {
    let dimension = |key: &str, fallback, max| {
        value[key]
            .as_u64()
            .filter(|&n| n != 0)
            .unwrap_or(fallback)
            .min(max) as u16
    };
    PtySize {
        cols: dimension("cols", 80, 1000),
        rows: dimension("rows", 24, 500),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn event(proxy: &EventLoopProxy<HostEvent>, channel: &str, data: Value) {
    let _ = proxy.send_event(HostEvent::LocalEvent(
        json!({ "kind": "event", "channel": channel, "data": data }),
    ));
}

fn drain(mut reader: impl Read, mut emit: impl FnMut(&str)) {
    let mut bytes = [0u8; 8192];
    let mut pending = Vec::new();
    loop {
        let size = match reader.read(&mut bytes) {
            Ok(0) => break,
            Ok(size) => size,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        pending.extend_from_slice(&bytes[..size]);
        let remaining = std::str::from_utf8(&pending)
            .err()
            .filter(|error| error.error_len().is_none())
            .map_or(0, |error| pending.len() - error.valid_up_to());
        let end = pending.len() - remaining;
        if end > 0 {
            emit(&String::from_utf8_lossy(&pending[..end]));
        }
        pending.drain(..end);
    }
    if !pending.is_empty() {
        emit(&String::from_utf8_lossy(&pending));
    }
}

pub fn run(
    shell: &Shell,
    stop: &AtomicBool,
    timeout: Option<Duration>,
    emit: impl Fn(&str) + Send + Sync + 'static,
) -> Result<Value> {
    let mut command = shell.command();
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.group().kill_on_drop(true).spawn()?;
    let stdout = child
        .inner()
        .stdout
        .take()
        .ok_or("Sortie du terminal indisponible.")?;
    let stderr = child
        .inner()
        .stderr
        .take()
        .ok_or("Sortie d’erreur du terminal indisponible.")?;
    let emit = Arc::new(emit);
    let output = Arc::clone(&emit);
    let stdout = thread::spawn(move || drain(stdout, |text| output(text)));
    let stderr = thread::spawn(move || drain(stderr, |text| emit(text)));
    let started = Instant::now();
    let (status, interrupted, timed_out) = loop {
        let interrupted = stop.load(Ordering::Acquire);
        let timed_out = timeout.is_some_and(|limit| started.elapsed() >= limit);
        if interrupted || timed_out {
            let _ = child.kill();
            break (child.wait()?, interrupted, timed_out);
        }
        if let Some(status) = child.try_wait()? {
            break (status, false, false);
        }
        thread::sleep(Duration::from_millis(35));
    };
    // Ferme le groupe à la fin, y compris si un processus descendant a hérité d’un tube.
    let _ = child.kill();
    drop(child);
    let _ = stdout.join();
    let _ = stderr.join();
    Ok(
        json!({ "exit_code": status.code(), "duration_ms": started.elapsed().as_millis(),
        "interrupted": interrupted, "timed_out": timed_out }),
    )
}

pub fn cd(root: &Path, current: &str, target: &str) -> Result<Value> {
    let root = root.canonicalize()?;
    let current = root.join(current).canonicalize()?;
    if !current.starts_with(&root) {
        return Err("Dossier hors du projet.".into());
    }
    let target = target.trim().trim_matches(['"', '\'']);
    let folder = if target.is_empty() || target == "~" {
        root.clone()
    } else {
        current.join(target).canonicalize()?
    };
    if !folder.is_dir() {
        return Err("Dossier introuvable.".into());
    }
    let relative = folder
        .strip_prefix(root)
        .map_err(|_| "Dossier hors du projet.")?;
    let name = relative
        .to_str()
        .ok_or("Chemin non UTF-8.")?
        .replace('\\', "/");
    Ok(json!(if name.is_empty() { "." } else { &name }))
}
