use std::{
    fs::{self, File, Metadata},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::desktop_host::Result;

pub struct Project {
    pub root: PathBuf,
    protected: PathBuf,
}

impl Project {
    pub fn is_protected(&self, relative: &str) -> bool {
        self.root.join(relative).starts_with(&self.protected)
    }

    pub fn open(root: &Path, profile: &Path) -> Result<Self> {
        let root = root.canonicalize()?;
        let protected = profile.canonicalize()?;
        if !root.is_dir() || root.starts_with(&protected) {
            return Err("Ce dossier n’est pas un projet accessible.".into());
        }
        Ok(Self { root, protected })
    }

    pub fn path(&self, relative: &str) -> Result<PathBuf> {
        let relative = normalize(relative)?;
        let mut path = self.root.clone();
        for part in relative.split('/').filter(|part| *part != ".") {
            path.push(part);
            if self.protected == path {
                return Err("Le dossier de données de l’IDE est protégé.".into());
            }
            match fs::symlink_metadata(&path) {
                Ok(info) if is_link(&info) => {
                    return Err("Lien symbolique ou jonction interdit.".into());
                }
                Ok(info) if !info.is_file() && !info.is_dir() => {
                    return Err("Type de fichier interdit.".into());
                }
                Ok(_) => {
                    let resolved = path.canonicalize()?;
                    if !resolved.starts_with(&self.root) || resolved.starts_with(&self.protected) {
                        return Err("Chemin hors de l’espace de travail.".into());
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(path)
    }

    pub fn mkdirs(&self, relative: &str) -> Result<()> {
        let relative = normalize(relative)?;
        let mut prefix = String::new();
        for part in relative.split('/').filter(|part| *part != ".") {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            let target = self.path(&prefix)?;
            match fs::create_dir(&target) {
                Ok(()) => {}
                Err(error)
                    if error.kind() == io::ErrorKind::AlreadyExists
                        && self.path(&prefix)?.is_dir() => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    pub fn read(&self, relative: &str, limit: u64) -> Result<(Vec<u8>, u32)> {
        read_regular(&self.path(relative)?, limit)
    }

    pub fn write(
        &self,
        relative: &str,
        data: &[u8],
        mode: u32,
        previous: Option<&str>,
        limit: u64,
    ) -> Result<()> {
        let target = self.path(relative)?;
        let parent = target.parent().ok_or("Dossier parent introuvable.")?;
        if target == self.root {
            return Err("La racine du projet n’est pas un fichier.".into());
        }
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(data)?;
        set_mode(file.as_file(), mode)?;
        file.as_file().sync_all()?;
        self.check_previous(relative, previous, limit)?;
        if previous.is_some() {
            file.persist(target)?;
        } else {
            file.persist_noclobber(target)?;
        }
        Ok(())
    }

    pub fn remove_file(&self, relative: &str, previous: &str, limit: u64) -> Result<()> {
        self.check_previous(relative, Some(previous), limit)?;
        fs::remove_file(self.path(relative)?)?;
        Ok(())
    }

    fn check_previous(&self, relative: &str, previous: Option<&str>, limit: u64) -> Result<()> {
        if let Some(expected) = previous {
            if digest(&self.read(relative, limit)?.0) != expected {
                return Err(format!(
                    "{relative} a changé depuis la lecture. Actualise avant de continuer."
                )
                .into());
            }
        }
        Ok(())
    }
}

pub fn normalize(input: &str) -> Result<String> {
    if input.trim().is_empty()
        || input.len() > 1024
        || input.starts_with(['/', '\\'])
        || input.contains(['\0', ':'])
    {
        return Err("Chemin relatif invalide.".into());
    }
    let parts: Vec<_> = input
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.len() > 40 {
        return Err("Chemin trop profond.".into());
    }
    for part in &parts {
        let lower = part.to_ascii_lowercase();
        let stem = lower.split('.').next().unwrap_or_default();
        let extension = lower.rsplit_once('.').map(|(_, extension)| extension);
        let reserved = matches!(stem, "con" | "prn" | "aux" | "nul" | "conin$" | "conout$")
            || ["com", "lpt"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|end| {
                    matches!(
                        end,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            });
        if part.ends_with(['.', ' '])
            || part.chars().any(char::is_control)
            || reserved
            || matches!(
                lower.as_str(),
                ".git"
                    | "node_modules"
                    | ".frst"
                    | "dist"
                    | "build"
                    | "coverage"
                    | ".ssh"
                    | ".aws"
                    | ".azure"
                    | ".gnupg"
                    | ".config"
                    | ".kube"
                    | ".npmrc"
                    | ".netrc"
                    | ".pgpass"
            )
            || matches!(
                extension,
                Some("asar" | "pem" | "key" | "p12" | "pfx" | "kdbx" | "keystore" | "jks")
            )
            || lower.starts_with(".env")
            || matches!(
                stem,
                "id_rsa" | "id_ed25519" | "credentials" | "secret" | "secrets"
            )
        {
            return Err(format!("Chemin exclu ou sensible : {part}.").into());
        }
    }
    let path = parts.join("/");
    let lower = path.to_ascii_lowercase();
    if lower == ".docker/config.json" || lower.ends_with("/.docker/config.json") {
        return Err("Fichier de configuration sensible.".into());
    }
    Ok(if path.is_empty() { ".".into() } else { path })
}

pub fn digest(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

pub fn read_regular(path: &Path, limit: u64) -> Result<(Vec<u8>, u32)> {
    let before = fs::symlink_metadata(path)?;
    if !before.is_file() || is_link(&before) {
        return Err("Seuls les fichiers ordinaires sont accessibles.".into());
    }
    if before.len() > limit {
        return Err("La taille maximale du fichier ou du projet est dépassée.".into());
    }
    let mut data = Vec::new();
    File::open(path)?.take(limit + 1).read_to_end(&mut data)?;
    let after = fs::symlink_metadata(path)?;
    if !after.is_file()
        || is_link(&after)
        || before.modified()? != after.modified()?
        || before.len() != after.len()
        || data.len() as u64 != after.len()
        || data.len() as u64 > limit
    {
        return Err("Un fichier a changé pendant la lecture. Réessaie.".into());
    }
    Ok((data, mode(&after)))
}

pub fn is_link(info: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return info.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    info.file_type().is_symlink()
}

fn mode(info: &Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        info.permissions().mode() & 0o777
    }
    #[cfg(not(unix))]
    if info.permissions().readonly() {
        0o444
    } else {
        0o666
    }
}

fn set_mode(file: &File, mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(mode))
    }
    #[cfg(not(unix))]
    {
        let mut permissions = file.metadata()?.permissions();
        permissions.set_readonly(mode & 0o200 == 0);
        file.set_permissions(permissions)
    }
}
