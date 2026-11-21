"use strict";
// Vérifie le résultat de prepare-legacy.cjs pour le pont de réglages Svelte : copie fidèle, une seule balise,
// chargement après les scripts de l'application historique, et mobile/www jamais modifié.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const here = __dirname;
const legacy = path.join(here, "public/legacy");
const index = fs.readFileSync(path.join(legacy, "index.html"), "utf8");
let count = 0;
function test(name, fn) {
  try { fn(); count += 1; } catch (error) { console.error(`ÉCHEC : ${name}`); throw error; }
}

test("le pont de réglages est copié tel quel", () => {
  const copy = path.join(legacy, "js/tauri-svelte-settings-engine.js");
  assert.ok(fs.existsSync(copy), "js/tauri-svelte-settings-engine.js absent");
  assert.equal(fs.readFileSync(copy, "utf8"), fs.readFileSync(path.join(here, "svelte-settings-engine.js"), "utf8"));
});

test("une seule balise, après app.js et après le pont du chat", () => {
  const tag = '<script src="js/tauri-svelte-settings-engine.js"></script>';
  assert.equal(index.split("tauri-svelte-settings-engine.js").length - 1, 1, "une seule balise");
  const app = index.indexOf('<script src="app.js"></script>');
  const chat = index.indexOf('<script src="js/tauri-svelte-chat-engine.js"></script>');
  const settings = index.indexOf(tag);
  assert.ok(app >= 0 && chat > app, "ordre app.js puis pont du chat");
  assert.ok(settings > chat, "le pont de réglages doit suivre celui du chat");
});

test("le script copié est du JavaScript valide", () => {
  const source = fs.readFileSync(path.join(legacy, "js/tauri-svelte-settings-engine.js"), "utf8");
  assert.doesNotThrow(() => new vm.Script(source, { filename: "tauri-svelte-settings-engine.js" }));
});

test("mobile/www n'est jamais modifié", () => {
  const original = fs.readFileSync(path.resolve(here, "../www/index.html"), "utf8");
  assert.ok(!original.includes("tauri-svelte-settings-engine"));
  assert.ok(!fs.existsSync(path.resolve(here, "../www/js/tauri-svelte-settings-engine.js")));
});

console.log(`test-prepare-settings-hook : ${count} tests réussis`);
