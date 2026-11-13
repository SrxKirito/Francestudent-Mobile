use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct Entry {
    pub name: String,
    pub relative: PathBuf,
    pub directory: bool,
}

pub struct Document {
    pub relative: PathBuf,
    original: String,
}

impl Document {
    pub fn display_text(&self) -> String {
        self.original
            .strip_prefix('\u{feff}')
            .unwrap_or(&self.original)
            .replace("\r\n", "\n")
    }
}

pub struct Workspace {
    root: PathBuf,
    pub display_path: PathBuf,
}

impl Workspace {
    pub fn open(path: &Path) -> io::Result<Self> {
        let root = dunce::canonicalize(path)?;
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "Le dossier est introuvable.",
            ));
        }
        Ok(Self {
            display_path: root.clone(),
            root,
        })
    }

    pub fn entries(&self, folder: &Path) -> io::Result<Vec<Entry>> {
        let path = self.resolve(folder)?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if !kind.is_dir() && !kind.is_file() {
                continue;
            }
            entries.push(Entry {
                name: entry.file_name().to_string_lossy().into_owned(),
                relative: folder.join(entry.file_name()),
                directory: kind.is_dir(),
            });
        }
        entries.sort_by(|a, b| {
            b.directory
                .cmp(&a.directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(entries)
    }

    pub fn read(&self, relative: &Path) -> io::Result<Document> {
        let original = read_text(&self.resolve(relative)?)?;
        Ok(Document {
            relative: relative.to_owned(),
            original,
        })
    }

    pub fn save(&self, document: &mut Document, edited: &str) -> io::Result<()> {
        let path = self.resolve(&document.relative)?;
        if document.original != read_text(&path)? {
            return Err(io::Error::other(
                "Le fichier a changé sur le disque. Copie ton texte, puis rouvre le fichier avant de réessayer.",
            ));
        }
        let had_bom = document.original.starts_with('\u{feff}');
        let had_crlf = document.original.contains("\r\n")
            && document.original.match_indices('\n').all(|(position, _)| {
                position > 0 && document.original.as_bytes()[position - 1] == b'\r'
            });
        let text = if had_crlf {
            edited.replace('\n', "\r\n")
        } else {
            edited.to_owned()
        };
        let text = if had_bom {
            format!("\u{feff}{text}")
        } else {
            text
        };
        if text.len() as u64 > MAX_FILE_BYTES {
            return Err(io::Error::other("Le fichier dépasse 2 Mio."));
        }

        let parent = path
            .parent()
            .ok_or_else(|| io::Error::other("Dossier parent introuvable."))?;
        let mut output = tempfile::NamedTempFile::new_in(parent)?;
        output
            .as_file()
            .set_permissions(fs::metadata(&path)?.permissions())?;
        output.write_all(text.as_bytes())?;
        output.as_file().sync_all()?;
        output.persist(&path).map_err(|error| error.error)?;
        document.original = text;
        Ok(())
    }

    fn resolve(&self, relative: &Path) -> io::Result<PathBuf> {
        let mut path = self.root.clone();
        for component in relative.components() {
            let Component::Normal(name) = component else {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Chemin hors du projet.",
                ));
            };
            path.push(name);
            if fs::symlink_metadata(&path)?.file_type().is_symlink() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Lien symbolique ignoré.",
                ));
            }
        }
        let resolved = dunce::canonicalize(path)?;
        if !resolved.starts_with(&self.root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Chemin hors du projet.",
            ));
        }
        Ok(resolved)
    }
}

fn read_text(path: &Path) -> io::Result<String> {
    if !fs::metadata(path)?.is_file() {
        return Err(io::Error::other(
            "Seuls les fichiers ordinaires peuvent être ouverts.",
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(io::Error::other("Le fichier dépasse 2 Mio."));
    }
    if bytes.contains(&0) {
        return Err(io::Error::other(
            "Ce fichier n’est pas un fichier texte UTF-8.",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| io::Error::other("Ce fichier n’est pas un fichier texte UTF-8."))
}
