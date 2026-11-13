use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    desktop_host::Result,
    project_fs::{is_link, normalize, read_regular},
};

const LIBRARY: &str = include_str!("../../../../src/skills/builtin-libraries.json");
const FILE_NAME: &str = "SKILL.md";
const FILE_LIMIT: u64 = 2 * 1024 * 1024;
const MAX_INSTRUCTIONS: usize = 60_000;
const MAX_SKILLS: usize = 2000;
const MAX_EXTRA_FILES: usize = 50;
const MAX_CATALOG: usize = 24_000;

#[derive(Deserialize)]
struct Builtins {
    code: Collection,
    roblox: Collection,
}

#[derive(Deserialize)]
struct Collection {
    application: Option<String>,
    prelude: Option<String>,
    skills: Vec<(String, String, String, String, String)>,
}

struct Local {
    name: String,
    description: String,
    scope: &'static str,
    dir: PathBuf,
    disabled: bool,
    application: Option<String>,
}

pub struct Skills {
    local: BTreeMap<String, Local>,
    builtin: Builtins,
}

impl Skills {
    pub fn discover(user: &Path, project: &Path) -> Result<Self> {
        let mut local = BTreeMap::new();
        let project_settings = project.join(".frst");
        let project_skills = project_settings.join("skills");
        // La racine utilisateur configurée est choisie par l’utilisateur. Pour
        // le projet, chaque répertoire est contrôlé avant d’ouvrir les skills.
        let user = user.canonicalize().ok();
        let project = plain_directory(&project_settings)
            .then_some(project_skills)
            .filter(|dir| plain_directory(dir));
        for (root, scope) in [(user, "utilisateur"), (project, "projet")] {
            let Some(root) = root else { continue };
            let Ok(entries) = fs::read_dir(root) else {
                continue;
            };
            let mut folders: Vec<_> = entries
                .filter_map(std::result::Result::ok)
                .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
                .map(|entry| entry.path())
                .filter(|dir| plain_directory(dir))
                .collect();
            folders.sort();
            for folder in folders {
                let Ok((skill, _)) = local_skill(&folder, scope) else {
                    continue;
                };
                let key = name_key(&skill.name);
                if local.len() < MAX_SKILLS || local.contains_key(&key) {
                    local.insert(key, skill);
                }
            }
        }
        Ok(Self {
            local,
            builtin: serde_json::from_str(LIBRARY)?,
        })
    }

    pub fn catalog(&self) -> String {
        let mut result = String::new();
        let mut length = 0;
        let mut append = |name: &str, scope: &str, description: &str| {
            let description = if description.is_empty() {
                "sans description"
            } else {
                clip(description, 300)
            };
            let name = json!(name);
            let line = format!("- {name} ({scope}) : {description}");
            let size = line.encode_utf16().count() + 1;
            if length + size <= MAX_CATALOG {
                result.push_str(&line);
                result.push('\n');
                length += size;
            }
        };
        for (id, _, _, description, _) in &self.builtin.roblox.skills {
            if !self.local.contains_key(&name_key(id)) {
                append(id, "intégré", description);
            }
        }
        for skill in self.local.values().filter(|skill| skill.is_code_enabled()) {
            append(&skill.name, skill.scope, &skill.description);
        }
        result.pop();
        result
    }

    pub fn load(&self, name: &str) -> Result<Value> {
        let wanted = name_key(name);
        if wanted.is_empty() {
            return Err("Le nom du skill est requis.".into());
        }
        let local = self.local.get(&wanted).or_else(|| {
            self.local.values().find(|skill| {
                skill
                    .dir
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name_key(name) == wanted)
            })
        });
        if let Some(skill) = local {
            let (skill, body) = local_skill(&skill.dir, skill.scope)?;
            if skill.application.as_deref() == Some("effectcraft") {
                return Err("Ce skill appartient à l’espace Motion design.".into());
            }
            if !skill.disabled {
                let instructions = clip(&body, MAX_INSTRUCTIONS);
                let mut files = Vec::new();
                collect_files(&skill.dir, Path::new(""), 0, &mut files);
                files.sort();
                return Ok(json!({
                    "name": skill.name, "scope": skill.scope, "dir": skill.dir.to_string_lossy(),
                    "description": skill.description, "instructions": instructions,
                    "files": files, "truncated": instructions.len() != body.len(), "changed": false,
                    "message": format!("Skill {} chargé.", skill.name)
                }));
            }
        } else {
            for collection in [&self.builtin.code, &self.builtin.roblox] {
                if let Some((id, title, _, description, body)) =
                    collection.skills.iter().find(|(id, title, _, _, _)| {
                        name_key(id) == wanted || name_key(title) == wanted
                    })
                {
                    let application = collection
                        .application
                        .as_ref()
                        .map_or_else(String::new, |value| format!("application: {value}\n"));
                    let prelude = collection
                        .prelude
                        .as_ref()
                        .map_or_else(String::new, |value| format!("{value}\n\n"));
                    let instructions = format!(
                        "---\nname: {id}\ndescription: {description}\n{application}---\n\n# {title}\n\n{prelude}{body}\n"
                    );
                    return Ok(json!({
                        "name": id, "scope": "intégré", "dir": "",
                        "description": description, "instructions": instructions,
                        "files": [], "truncated": false, "changed": false,
                        "message": format!("Skill {id} chargé.")
                    }));
                }
            }
        }
        Err(
            format!("Skill inconnu ou désactivé : {name}. Consulte le catalogue des skills.")
                .into(),
        )
    }
}

impl Local {
    fn is_code_enabled(&self) -> bool {
        !self.disabled && self.application.as_deref() != Some("effectcraft")
    }
}

fn local_skill(dir: &Path, scope: &'static str) -> Result<(Local, String)> {
    let root = dir.parent().ok_or("Dossier de skills invalide.")?;
    if !plain_directory(dir)
        || !plain_directory(root)
        || (scope == "projet" && !root.parent().is_some_and(plain_directory))
    {
        return Err("Dossier de skill inaccessible.".into());
    }
    let (bytes, _) = read_regular(&dir.join(FILE_NAME), FILE_LIMIT)?;
    let text = String::from_utf8_lossy(&bytes);
    let source = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let (meta, body) = frontmatter(&source);
    let field = |name| meta.get(name).map(String::as_str).unwrap_or_default();
    let name = field("name").trim();
    let name = if name.is_empty() {
        dir.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
    } else {
        name
    };
    let description = field("description")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let description = if description.is_empty() {
        let first = body
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_default();
        clip(first.trim_start_matches('#').trim_start(), 200).to_owned()
    } else {
        description
    };
    Ok((
        Local {
            name: name.to_owned(),
            description,
            scope,
            dir: dir.to_owned(),
            disabled: matches!(
                field("disabled").trim().to_ascii_lowercase().as_str(),
                "true" | "yes" | "1" | "on"
            ),
            application: match field("application") {
                name @ ("effectcraft" | "code" | "roblox") => Some(name.to_owned()),
                _ => None,
            },
        },
        body.to_owned(),
    ))
}

fn frontmatter(source: &str) -> (BTreeMap<String, String>, &str) {
    let mut meta = BTreeMap::new();
    let Some(block) = source.strip_prefix("---\n") else {
        return (meta, source.trim());
    };
    let mut end = 0;
    let mut header = None;
    for line in block.split_inclusive('\n') {
        let marker = line.trim_end_matches([' ', '\t', '\n']);
        if marker == "---" && end > 0 {
            header = Some((&block[..end], block[end + line.len()..].trim()));
            break;
        }
        end += line.len();
    }
    let Some((header, body)) = header else {
        return (meta, source.trim());
    };
    let mut lines = header.lines().peekable();
    while let Some(line) = lines.next() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim_end();
        if key.is_empty()
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            continue;
        }
        let value = value.trim();
        let mut value = if matches!(value, "" | "|" | ">") {
            let mut block = Vec::new();
            while lines.peek().is_some_and(|line| {
                line.starts_with(char::is_whitespace) && !line.trim().is_empty()
            }) {
                block.push(lines.next().unwrap_or_default().trim());
            }
            block.join(if value == "|" { "\n" } else { " " })
        } else {
            value.to_owned()
        };
        if value.len() >= 2
            && (value.starts_with('"') && value.ends_with('"')
                || value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len() - 1].to_owned();
        }
        meta.insert(key.to_ascii_lowercase(), value);
    }
    (meta, body)
}

fn collect_files(root: &Path, relative: &Path, depth: usize, files: &mut Vec<String>) {
    let path = root.join(relative);
    if depth > 2 || !plain_directory(&path) {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(std::result::Result::ok).collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        if files.len() >= MAX_EXTRA_FILES {
            break;
        }
        let Ok(info) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        let name = entry.file_name();
        let next = relative.join(&name);
        let Some(label) = next.to_str().map(|value| value.replace('\\', "/")) else {
            continue;
        };
        if is_link(&info) || normalize(&label).is_err() {
            continue;
        }
        if info.is_dir() {
            collect_files(root, &next, depth + 1, files);
        } else if info.is_file() && (depth != 0 || name != FILE_NAME) {
            files.push(label);
        }
    }
}

fn plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|info| info.is_dir() && !is_link(&info))
}

fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn clip(text: &str, limit: usize) -> &str {
    let mut size = 0;
    for (offset, c) in text.char_indices() {
        size += c.len_utf16();
        if size > limit {
            return &text[..offset];
        }
    }
    text
}
