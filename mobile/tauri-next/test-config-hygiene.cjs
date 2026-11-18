"use strict";
// Un BOM UTF-8 en tête d'un JSON de configuration casse Vite et svelte-check, alors que les tests Node l'acceptent.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const candidates = [
  "mobile/tauri-next/package.json",
  "mobile/tauri-next/tsconfig.json",
  "mobile/tauri-next/src-tauri/tauri.conf.json",
  "mobile/tauri-next/src-tauri/capabilities"
];

function jsonFiles(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isDirectory()) return fs.readdirSync(full).filter(name => name.endsWith(".json")).map(name => path.join(full, name));
  return [full];
}

let checked = 0;
for (const file of candidates.flatMap(jsonFiles)) {
  const bytes = fs.readFileSync(file);
  assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), "BOM UTF-8 interdit : " + path.relative(root, file));
  if (path.basename(file) !== "tsconfig.json") JSON.parse(bytes.toString("utf8")); // tsconfig accepte commentaires et virgules finales
  checked++;
}
assert.ok(checked >= 2, "fichiers de configuration introuvables");
console.log("Configuration : " + checked + " fichiers JSON sans BOM et valides.");
