"use strict";
// Keep the existing visual baseline without modifying the Capacitor source.
const fs = require("node:fs");
const path = require("node:path");
const source = path.resolve(__dirname, "../www");
const destination = path.resolve(__dirname, "public/legacy");
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
const indexPath = path.join(destination, "index.html");
let index = fs.readFileSync(indexPath, "utf8");
function removeOnce(text, expression, label) {
  if (!expression.test(text)) throw new Error(`${label} introuvable dans l'interface historique`);
  return text.replace(expression, "");
}
index = removeOnce(index, /^\s*<button id="france-ide-open"[^\r\n]*<\/button>\s*$/m, "Entrée France IDE");
index = removeOnce(index, /^\s*<link rel="stylesheet" href="ide-link\.css">\s*$/m, "Style France IDE");
index = removeOnce(index, /^\s*<script src="js\/ide-link\.js"><\/script>\s*$/m, "Script France IDE");
index = removeOnce(index, /^\s*<script src="js\/ide-link-remembered\.js"><\/script>\s*$/m, "Script de mémorisation France IDE");
const core = '<script src="js/core.js"></script>';
if (!index.includes(core)) throw new Error("Point d'entrée de l'interface historique introuvable");
fs.writeFileSync(indexPath, index.replace(core, core + '\n  <script src="js/tauri-bridge.js"></script>'));
fs.copyFileSync(path.join(__dirname, "legacy-bridge.js"), path.join(destination, "js/tauri-bridge.js"));
const appPath = path.join(destination, "app.js");
const app = fs.readFileSync(appPath, "utf8");
fs.writeFileSync(appPath, removeOnce(app, /^\s*\$\("france-ide-open"\)\.addEventListener\("click", openFranceIDE\);\s*$/m, "Initialisation France IDE"));
