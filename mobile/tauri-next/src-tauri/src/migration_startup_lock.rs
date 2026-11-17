//! Preparatory process lease for migration-only startup. Not wired into Tauri.
//!
//! Every process using the same WebView data store must acquire this lock
//! before creating any WebView or touching the store. The lock is advisory and
//! cannot exclude processes which do not participate. The application must also
//! ensure that no normal WebView exists while a migration is running.

use std::{
    fs::{File, OpenOptions},
    io,
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Startup,
    Normal,
    Migration,
    RestartRequired,
}

struct Inner {
    // Never unlink or replace this file. Keeping its handle alive retains the
    // OS lock, including after a partial migration, until the process exits.
    _file: File,
    phase: Mutex<Phase>,
}

#[derive(Clone)]
pub struct StartupProcessLock(Arc<Inner>);

pub struct MigrationLease {
    inner: Arc<Inner>,
    writes_possible: bool,
}

impl StartupProcessLock {
    /// `lock_file` must be a fixed path in the private application data
    /// directory, on a local filesystem, shared by all participating processes.
    pub fn acquire(lock_file: &Path) -> io::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).create(true).open(lock_file)?;
        file.try_lock().map_err(|e| io::Error::new(io::ErrorKind::WouldBlock, format!("Verrou de processus indisponible : {e:?}")))?;
        Ok(Self(Arc::new(Inner { _file: file, phase: Mutex::new(Phase::Startup) })))
    }

    /// Call immediately before normal WebView creation. Never enter normal mode
    /// after a write was attempted until this process has actually restarted.
    pub fn begin_normal_runtime(&self) -> Result<(), &'static str> {
        let mut phase = self.0.phase.lock().map_err(|_| "Verrou de migration indisponible")?;
        if *phase != Phase::Startup { return Err("Démarrage normal interdit pendant la migration"); }
        *phase = Phase::Normal;
        Ok(())
    }

    pub fn begin_migration(&self) -> Result<MigrationLease, &'static str> {
        let mut phase = self.0.phase.lock().map_err(|_| "Verrou de migration indisponible")?;
        if *phase != Phase::Startup { return Err("La migration exige un démarrage isolé"); }
        *phase = Phase::Migration;
        Ok(MigrationLease { inner: self.0.clone(), writes_possible: false })
    }
}

impl MigrationLease {
    /// Must be called before allowing any restore operation, including one that
    /// subsequently fails or is interrupted. This transition is irreversible.
    pub fn mark_writes_possible(&mut self) { self.writes_possible = true; }
}

impl Drop for MigrationLease {
    fn drop(&mut self) {
        if let Ok(mut phase) = self.inner.phase.lock() {
            *phase = if self.writes_possible { Phase::RestartRequired } else { Phase::Startup };
        }
    }
}
