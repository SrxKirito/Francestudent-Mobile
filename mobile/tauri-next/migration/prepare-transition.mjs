import { cp, readFile, writeFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { installIosBridge } from "./install-ios-bridge.mjs";

/**
 * Builds a transition copy of the legacy Capacitor app: same identity, same data
 * container, plus a backup-only export. The source tree is only ever read.
 */
const here = dirname(fileURLToPath(import.meta.url));
const EXCLUDED_TOP = new Set(["tauri-next", "tauri-api", "android-native", "node_modules", "dist"]);
const EARLY_FILE = "js/fs-migration-early.js";
const LATE_FILE = "js/fs-migration-late.js";
const BUILD_FLAG = "SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) FS_MIGRATION_EXPORT'";

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label} : repère introuvable ou ambigu ; copie non utilisable.`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function prepareTransition({ source = resolve(here, "../.."), output }) {
  if (!output) throw new Error("Dossier de sortie requis.");
  const sourceReal = await realpath(source);
  const target = resolve(output);
  if (isInside(sourceReal, target) || isInside(target, sourceReal)) throw new Error("Le dossier de sortie doit être séparé de l'application source.");
  const existing = await readdir(target).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  if (existing.length) throw new Error("Le dossier de sortie n'est pas vide.");
  await cp(sourceReal, target, {
    recursive: true,
    filter: path => {
      const parts = relative(sourceReal, path).split(sep).filter(Boolean);
      if (parts.length && EXCLUDED_TOP.has(parts[0])) return false;
      if (parts[0] === "ios" && parts[1] === "build-sidestore") return false;
      return !parts.includes("node_modules");
    }
  });
  
  // Classic scripts, so the app's let/const globals stay reachable by name.
  const { build } = await import("esbuild");
  for (const [entry, file] of [["entry-early.mjs", EARLY_FILE], ["entry-late.mjs", LATE_FILE]]) {
    await build({
      entryPoints: [join(here, entry)], outfile: join(target, "www", file), bundle: true, format: "iife", platform: "browser",
      target: "safari16", legalComments: "none", logLevel: "silent",
      banner: { js: "/* Généré par migration/prepare-transition.mjs : ne pas modifier. */" }
    });
  }
  
  const htmlPath = join(target, "www/index.html");
  let html = await readFile(htmlPath, "utf8");
  if (html.includes("fs-migration")) throw new Error("index.html contient déjà le raccordement ; copie non utilisable.");
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  html = replaceOnce(html, '<meta charset="UTF-8">', `<meta charset="UTF-8">${eol}  <script src="${EARLY_FILE}"></script>`, "index.html (garde précoce)");
  html = replaceOnce(html, '<script src="app.js"></script>', `<script src="${LATE_FILE}"></script>${eol}  <script src="app.js"></script>`, "index.html (export)");
  await writeFile(htmlPath, html);
  
  await installIosBridge(target);
  
  const scriptPath = join(target, "scripts/build-iphone.sh");
  const script = await readFile(scriptPath, "utf8");
  const scriptEol = script.includes("\r\n") ? "\r\n" : "\n";
  const signing = "CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \\";
  await writeFile(scriptPath, replaceOnce(script, signing, `${signing}${scriptEol}  ${BUILD_FLAG} \\`, "build-iphone.sh"));
  
  return { output: target, added: [`www/${EARLY_FILE}`, `www/${LATE_FILE}`, "ios/App/App/MigrationExportPlugin.swift"], modified: ["www/index.html", "ios/App/App.xcodeproj/project.pbxproj", "ios/App/App/FranceStudentViewController.swift", "scripts/build-iphone.sh"] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const result = await prepareTransition({ source: option("--source") ? resolve(option("--source")) : undefined, output: option("--output") });
  console.log("Copie de transition prête : " + result.output);
  console.log("Ajoutés : " + result.added.join(", "));
  console.log("Modifiés dans la copie : " + result.modified.join(", "));
}
