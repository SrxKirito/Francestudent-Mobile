use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{
    desktop_host::Result,
    project_fs::{Project, digest, is_link, normalize, read_regular},
};

const MAX_PROJECT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_FILES: usize = 100_000;
const MAX_CHANGES: usize = 100;
const MAX_VERSIONS: usize = 50;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
struct FileVersion {
    hash: String,
    size: u64,
    mode: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    id: String,
    at: String,
    task: String,
    kind: String,
    workspace: PathBuf,
    excluded: usize,
    excluded_paths: BTreeSet<String>,
    files: BTreeMap<String, FileVersion>,
}

#[derive(Default)]
struct Scan {
    files: BTreeMap<String, FileVersion>,
    excluded: BTreeSet<String>,
    bytes: u64,
}

#[derive(Serialize)]
struct Change {
    path: String,
    action: &'static str,
}

pub fn action(profile: &Path, request: &Value) -> Result<Value> {
    let workspace = Path::new(
        request["workspace"]
            .as_str()
            .ok_or("Aucun projet sélectionné.")?,
    );
    let project = Project::open(workspace, profile)?;
    let storage = Path::new(
        request["storage"]
            .as_str()
            .ok_or("Dossier de sauvegarde introuvable.")?,
    );
    check_storage(storage, profile)?;
    let id = request["id"].as_str().unwrap_or_default();
    match request["action"].as_str() {
        Some("save") => {
            let task = request["task"].as_str().unwrap_or_default();
            let version = save(&project, workspace, storage, task, "prompt")?;
            Ok(json!({"id": version.id}))
        }
        Some("list") => Ok(json!(list(storage, workspace)?.into_iter().map(|point| json!({
            "id": point.id, "at": point.at, "task": point.task, "kind": point.kind, "excluded": point.excluded
        })).collect::<Vec<_>>())),
        Some("preview") => {
            let point = get(storage, workspace, id)?;
            let scan = scan(&project, None)?;
            let changes = differences(&point, &scan)?;
            let expected = fingerprint(&point, &scan)?;
            Ok(json!({ "id": id, "task": point.task, "changes": changes, "expected": expected,
                "excluded": scan.excluded.len(), "savedExcluded": point.excluded,
                "excludedPaths": point.excluded_paths.union(&scan.excluded).collect::<Vec<_>>() }))
        }
        Some("restore") => restore(&project, workspace, storage, id, request["expected"].as_str().unwrap_or_default()),
        Some("remove") => {
            get(storage, workspace, id)?;
            let directory = version_dir(storage, id)?;
            fs::remove_dir_all(directory)?;
            Ok(json!({"removed": true}))
        }
        _ => Err("Action de sauvegarde inconnue.".into()),
    }
}

fn check_storage(storage: &Path, profile: &Path) -> Result<()> {
    let relative = storage
        .strip_prefix(profile)
        .map_err(|_| "Dossier de sauvegarde hors du profil.")?;
    if !relative
        .components()
        .all(|part| matches!(part, std::path::Component::Normal(_)))
        || storage.file_name().and_then(|name| name.to_str()) != Some("file-versions")
    {
        return Err("Dossier de sauvegarde invalide.".into());
    }
    let mut current = profile.to_owned();
    for segment in relative.components() {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(info) if !info.is_dir() || is_link(&info) => {
                return Err("Lien ou fichier dans le stockage des versions.".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn scan(project: &Project, objects: Option<&Path>) -> Result<Scan> {
    let mut scan = Scan::default();
    visit(project, ".", objects, &mut scan)?;
    Ok(scan)
}

fn visit(
    project: &Project,
    directory: &str,
    objects: Option<&Path>,
    scan: &mut Scan,
) -> Result<()> {
    for entry in fs::read_dir(project.path(directory)?)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Nom de fichier non UTF-8 dans le projet.")?;
        let relative = if directory == "." {
            name
        } else {
            format!("{directory}/{name}")
        };
        let kind = entry.file_type()?;
        let generated = kind.is_dir()
            && (name_is_target(&relative)
                || matches!(
                    key(&relative).as_str(),
                    "release/effectcraft-source"
                        | "release/effectcraft-target"
                        | "desktop/vendor-effectcraft"
                        | "desktop/renderer/vendor"
                ));
        // Les chemins exclus participent à la validation de la restauration.
        if generated
            || normalize(&relative).ok().as_deref() != Some(&relative)
            || is_link(&fs::symlink_metadata(entry.path())?)
            || project.is_protected(&relative)
        {
            scan.excluded.insert(relative);
            continue;
        }
        if kind.is_dir() {
            visit(project, &relative, objects, scan)?;
        } else if kind.is_file() {
            if scan.files.len() >= MAX_FILES {
                return Err("Le projet contient trop de fichiers à sauvegarder.".into());
            }
            let (data, mode) = project.read(&relative, MAX_PROJECT_BYTES - scan.bytes)?;
            scan.bytes += data.len() as u64;
            let hash = digest(&data);
            if let Some(objects) = objects {
                let target = objects.join(&hash);
                match fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(target)
                {
                    Ok(mut file) => {
                        file.write_all(&data)?;
                        file.sync_all()?;
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
            }
            scan.files.insert(
                relative,
                FileVersion {
                    hash,
                    mode,
                    size: data.len() as u64,
                },
            );
        } else {
            scan.excluded.insert(relative);
        }
    }
    Ok(())
}

fn name_is_target(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| name.eq_ignore_ascii_case("target"))
}

fn save(
    project: &Project,
    workspace: &Path,
    storage: &Path,
    task: &str,
    kind: &str,
) -> Result<Manifest> {
    if kind == "prompt"
        && list(storage, workspace)?
            .iter()
            .filter(|point| point.kind != "safety")
            .count()
            >= MAX_VERSIONS
    {
        return Err("50 sauvegardes avant demande existent déjà. Supprime une ancienne version avant de continuer.".into());
    }
    fs::create_dir_all(storage)?;
    let staging = tempfile::Builder::new()
        .prefix(".pending-")
        .tempdir_in(storage)?;
    let scan = scan(project, Some(staging.path()))?;
    let point = Manifest {
        version: 1,
        id: Uuid::new_v4().to_string(),
        at: OffsetDateTime::now_utc().format(&Rfc3339)?,
        task: task
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(120)
            .collect(),
        kind: kind.into(),
        workspace: workspace.to_owned(),
        excluded: scan.excluded.len(),
        excluded_paths: scan.excluded,
        files: scan.files,
    };
    let mut file = fs::File::create(staging.path().join("manifest.json"))?;
    serde_json::to_writer(&mut file, &point)?;
    file.sync_all()?;
    drop(file);
    fs::rename(staging.path(), storage.join(&point.id))?;
    Ok(point)
}

fn version_dir(storage: &Path, id: &str) -> Result<PathBuf> {
    if Uuid::parse_str(id).is_err() || id.len() != 36 {
        return Err("Version invalide.".into());
    }
    let path = storage.join(id);
    let info = fs::symlink_metadata(&path)?;
    let resolved = path.canonicalize()?;
    if !info.is_dir()
        || is_link(&info)
        || resolved.parent() != Some(storage.canonicalize()?.as_path())
    {
        return Err("Dossier de version invalide.".into());
    }
    Ok(path)
}

fn get(storage: &Path, workspace: &Path, id: &str) -> Result<Manifest> {
    let manifest = version_dir(storage, id)?.join("manifest.json");
    let point: Manifest = serde_json::from_slice(&read_regular(&manifest, 64 * 1024 * 1024)?.0)?;
    if point.version != 1
        || point.id != id
        || point.workspace != workspace
        || point.files.iter().any(|(rel, file)| {
            normalize(rel).ok().as_deref() != Some(rel.as_str())
                || rel == "."
                || file.mode > 0o777
                || file.hash.len() != 64
                || !file.hash.bytes().all(|b| b.is_ascii_hexdigit())
        })
    {
        return Err("Version invalide pour ce projet.".into());
    }
    Ok(point)
}

fn list(storage: &Path, workspace: &Path) -> Result<Vec<Manifest>> {
    let entries = match fs::read_dir(storage) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut points: Vec<_> = entries
        .filter_map(|entry| get(storage, workspace, entry.ok()?.file_name().to_str()?).ok())
        .collect();
    points.sort_by_cached_key(|point| {
        std::cmp::Reverse(OffsetDateTime::parse(&point.at, &Rfc3339).ok())
    });
    Ok(points)
}

fn differences(point: &Manifest, current: &Scan) -> Result<Vec<Change>> {
    let paths: BTreeSet<_> = point.files.keys().chain(current.files.keys()).collect();
    let changes: Vec<_> = paths
        .into_iter()
        .filter_map(|path| {
            let action = match (point.files.get(path), current.files.get(path)) {
                (None, Some(_)) => "retirer",
                (Some(_), None) => "rétablir",
                (Some(saved), Some(actual)) if saved != actual => "restaurer",
                _ => return None,
            };
            Some(Change {
                path: path.clone(),
                action,
            })
        })
        .collect();
    let names = changes
        .iter()
        .map(|change| key(&change.path))
        .collect::<BTreeSet<_>>();
    if names.len() != changes.len() {
        return Err("Conflit de casse entre les chemins à restaurer.".into());
    }
    let excluded: BTreeSet<_> = point
        .excluded_paths
        .union(&current.excluded)
        .map(|path| key(path))
        .collect();
    for name in &names {
        if excluded.contains(name)
            || ancestors(name).any(|parent| names.contains(parent) || excluded.contains(parent))
            || excluded
                .range(format!("{name}/")..)
                .next()
                .is_some_and(|path| path.starts_with(&format!("{name}/")))
        {
            return Err(format!(
                "La restauration de {name} chevauche un dossier exclu ou un chemin en conflit."
            )
            .into());
        }
    }
    Ok(changes)
}

fn key(path: &str) -> String {
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path.into()
    }
}

fn ancestors(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/').map(|(index, _)| &path[..index])
}

fn fingerprint(point: &Manifest, current: &Scan) -> Result<String> {
    Ok(digest(&serde_json::to_vec(&(
        point,
        &current.files,
        &current.excluded,
    ))?))
}

fn restore(
    project: &Project,
    workspace: &Path,
    storage: &Path,
    id: &str,
    expected: &str,
) -> Result<Value> {
    let point = get(storage, workspace, id)?;
    let current = scan(project, None)?;
    if expected != fingerprint(&point, &current)? {
        return Err(
            "Le projet ou la sauvegarde a changé depuis l’aperçu. Actualise avant de restaurer."
                .into(),
        );
    }
    let changes = differences(&point, &current)?;
    if changes.is_empty() {
        return Ok(json!({"restored": 0}));
    }
    if changes.len() > MAX_CHANGES {
        return Err("La restauration est limitée à 100 fichiers.".into());
    }
    let directory = version_dir(storage, id)?;
    let content = |saved: &FileVersion| -> Result<Vec<u8>> {
        let (data, _) = read_regular(&directory.join(&saved.hash), MAX_PROJECT_BYTES)?;
        if digest(&data) != saved.hash || data.len() as u64 != saved.size {
            return Err("Le contenu de la sauvegarde est endommagé.".into());
        }
        Ok(data)
    };
    for change in &changes {
        let target = project.path(&change.path)?;
        if !current.files.contains_key(&change.path) && target.try_exists()? {
            return Err(format!(
                "Restauration impossible : {} est devenu un dossier.",
                change.path
            )
            .into());
        }
        if let Some(saved) = point.files.get(&change.path) {
            content(saved)?;
        }
    }
    let safety = save(
        project,
        workspace,
        storage,
        &format!("Avant restauration : {}", point.task),
        "safety",
    )?;
    if safety.files != current.files || safety.excluded_paths != current.excluded {
        return Err(
            "Le projet a changé pendant la sauvegarde de sécurité. Actualise l’aperçu.".into(),
        );
    }
    let mut restored = 0;
    let result: Result<()> = (|| {
        for change in &changes {
            let old = current
                .files
                .get(&change.path)
                .map(|file| file.hash.as_str());
            if let Some(saved) = point.files.get(&change.path) {
                if let Some((parent, _)) = change.path.rsplit_once('/') {
                    project.mkdirs(parent)?;
                }
                project.write(
                    &change.path,
                    &content(saved)?,
                    saved.mode,
                    old,
                    MAX_PROJECT_BYTES,
                )?;
            } else {
                project.remove_file(
                    &change.path,
                    old.ok_or("État du fichier inconnu.")?,
                    MAX_PROJECT_BYTES,
                )?;
            }
            restored += 1;
        }
        Ok(())
    })();
    if let Err(error) = result {
        return Err(format!("Restauration interrompue après {restored} fichier(s) : {error}. La version de sécurité est disponible.").into());
    }
    Ok(
        json!({"restored": restored, "safetyId": safety.id, "paths": changes.iter().map(|change| &change.path).collect::<Vec<_>>() }),
    )
}
