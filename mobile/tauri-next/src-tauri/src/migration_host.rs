//! Native side of the one-shot import of data exported by the legacy app.
//!
//! The normal application asks for an import by writing a marker file
//! (`migration_schedule`). The next process start sees the marker *before*
//! any WebView exists, takes the migration lease and opens only the dedicated
//! `migration` window, which loads `migration.html` and none of the chat code.
//! Once a restore may have written anything the process can only exit: the
//! lease is never released and the normal window is never created again in
//! this process (see `migration_startup_lock`).
//!
//! Commands are bound to a window label: the import commands answer only to
//! the `migration` window, and scheduling only to the `main` window.

use crate::migration_startup_lock::{MigrationLease, StartupProcessLock};
use std::{
    fs, io,
    path::Path,
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

pub const WINDOW: &str = "migration";
const MARKER: &str = "migration-requested";

pub fn is_requested(directory: &Path) -> bool {
    directory.join(MARKER).is_file()
}

pub fn request(directory: &Path) -> io::Result<()> {
    fs::write(directory.join(MARKER), b"1")
}

/// Removes only the marker created by `request`; user data is never touched.
pub fn clear(directory: &Path) -> io::Result<()> {
    match fs::remove_file(directory.join(MARKER)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[derive(Default)]
struct Session {
    lease: Option<MigrationLease>,
    writes: bool,
}

/// Managed in every run; empty unless the process started in migration mode.
#[derive(Default)]
pub struct MigrationState(Mutex<Session>);

impl MigrationState {
    pub fn active(lease: MigrationLease) -> Self {
        Self(Mutex::new(Session {
            lease: Some(lease),
            writes: false,
        }))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Session>, String> {
        self.0
            .lock()
            .map_err(|_| "État de migration indisponible.".to_owned())
    }

    pub fn assert_active(&self) -> Result<(), String> {
        if self.lock()?.lease.is_some() {
            Ok(())
        } else {
            Err("Aucune migration en cours.".into())
        }
    }

    pub fn writes_possible(&self) -> Result<bool, String> {
        Ok(self.lock()?.writes)
    }

    /// Irreversible. Call before the first write of a restore.
    pub fn mark_writes(&self) -> Result<(), String> {
        let mut session = self.lock()?;
        session
            .lease
            .as_mut()
            .ok_or("Aucune migration en cours.")?
            .mark_writes_possible();
        session.writes = true;
        Ok(())
    }

    /// Valid only after writes were announced. The lease is deliberately kept
    /// until the process exits.
    pub fn finish(&self) -> Result<(), String> {
        let session = self.lock()?;
        if session.lease.is_none() {
            Err("Aucune migration en cours.".into())
        } else if !session.writes {
            Err("Aucune écriture n'a eu lieu : utilise l'annulation.".into())
        } else {
            Ok(())
        }
    }

    /// Releases the lease so normal startup may proceed, but only when no
    /// write was ever announced.
    pub fn cancel(&self) -> Result<(), String> {
        let mut session = self.lock()?;
        if session.writes {
            return Err("Redémarrage nécessaire : des écritures ont pu avoir lieu.".into());
        }
        session
            .lease
            .take()
            .map(drop)
            .ok_or_else(|| "Aucune migration en cours.".to_owned())
    }
}

fn require_window(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err("Commande réservée à une autre fenêtre.".into())
    }
}

fn data_directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub fn build_window(app: &AppHandle) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(app, WINDOW, tauri::WebviewUrl::App("migration.html".into()))
        .title("France Student – Import des données")
        .build()?;
    Ok(())
}

/// Called from the normal window. Takes effect at the next process start.
#[tauri::command]
pub fn migration_schedule(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_window(&window, "main")?;
    request(&data_directory(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn migration_assert(
    window: WebviewWindow,
    state: State<'_, MigrationState>,
) -> Result<(), String> {
    require_window(&window, WINDOW)?;
    state.assert_active()
}

#[tauri::command]
pub fn migration_mark_writes(
    window: WebviewWindow,
    state: State<'_, MigrationState>,
) -> Result<(), String> {
    require_window(&window, WINDOW)?;
    state.mark_writes()
}

/// After a restore that may have written: forget the request, keep the lease.
#[tauri::command]
pub fn migration_finish(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, MigrationState>,
) -> Result<(), String> {
    require_window(&window, WINDOW)?;
    state.finish()?;
    clear(&data_directory(&app)?).map_err(|e| e.to_string())
}

/// Leave the migration without any write: back to the normal application.
#[tauri::command]
pub async fn migration_cancel(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, MigrationState>,
    lock: State<'_, StartupProcessLock>,
) -> Result<(), String> {
    require_window(&window, WINDOW)?;
    state.assert_active()?;
    if state.writes_possible()? {
        return Err("Redémarrage nécessaire : des écritures ont pu avoir lieu.".into());
    }
    clear(&data_directory(&app)?).map_err(|e| e.to_string())?;
    state.cancel()?;
    lock.begin_normal_runtime().map_err(str::to_owned)?;
    crate::build_main_window(&app).map_err(|e| e.to_string())?;
    window.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let directory =
            std::env::temp_dir().join(format!("fs-migration-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn lock_in(directory: &Path) -> StartupProcessLock {
        StartupProcessLock::acquire(&directory.join("startup-process.lock")).unwrap()
    }

    #[test]
    fn marker_is_requested_then_cleared_idempotently() {
        let directory = scratch("marker");
        assert!(!is_requested(&directory));
        request(&directory).unwrap();
        assert!(is_requested(&directory));
        clear(&directory).unwrap();
        clear(&directory).unwrap();
        assert!(!is_requested(&directory));
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn inactive_state_refuses_every_import_operation() {
        let state = MigrationState::default();
        assert!(state.assert_active().is_err());
        assert!(state.mark_writes().is_err());
        assert!(state.finish().is_err());
        assert!(state.cancel().is_err());
    }

    #[test]
    fn cancel_without_writes_allows_normal_startup() {
        let directory = scratch("cancel");
        let lock = lock_in(&directory);
        let state = MigrationState::active(lock.begin_migration().unwrap());
        assert!(
            lock.begin_normal_runtime().is_err(),
            "pas de démarrage normal pendant la migration"
        );
        assert!(state.finish().is_err(), "finir sans écriture est refusé");
        state.cancel().unwrap();
        lock.begin_normal_runtime().unwrap();
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn once_writes_are_announced_the_process_can_only_restart() {
        let directory = scratch("writes");
        let lock = lock_in(&directory);
        let state = MigrationState::active(lock.begin_migration().unwrap());
        state.mark_writes().unwrap();
        assert!(state.writes_possible().unwrap());
        assert!(
            state.cancel().is_err(),
            "l'annulation est interdite après écriture"
        );
        state.finish().unwrap();
        assert!(
            state.assert_active().is_ok(),
            "le verrou reste tenu après la fin"
        );
        drop(state);
        assert!(
            lock.begin_normal_runtime().is_err(),
            "jamais de démarrage normal dans ce processus"
        );
        fs::remove_dir_all(&directory).unwrap();
    }
}
