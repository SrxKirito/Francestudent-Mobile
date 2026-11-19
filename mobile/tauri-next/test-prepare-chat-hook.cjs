"use strict";
// Vérifie le résultat de prepare-legacy.cjs pour le chat Svelte : pont injecté (inerte), crochet de lecture du flux posé
// dans la COPIE de stream.js (jamais dans mobile/www) et toujours du JavaScript valide.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const here = __dirname;
const legacy = path.join(here, "public/legacy");
const index = fs.readFileSync(path.join(legacy, "index.html"), "utf8");
const stream = fs.readFileSync(path.join(legacy, "js/stream.js"), "utf8");
const originalStream = fs.readFileSync(path.resolve(here, "../www/js/stream.js"), "utf8");
let count = 0;
function test(name, fn) {
  try { fn(); count += 1; } catch (error) { console.error(`ÉCHEC : ${name}`); throw error; }
}

test("le pont du chat est copié tel quel et chargé après le pont de la coque", () => {
  const copy = path.join(legacy, "js/tauri-svelte-chat-engine.js");
  assert.ok(fs.existsSync(copy), "js/tauri-svelte-chat-engine.js absent");
  assert.equal(fs.readFileSync(copy, "utf8"), fs.readFileSync(path.join(here, "svelte-chat-engine.js"), "utf8"));
  const shell = index.indexOf('<script src="js/tauri-svelte-engine.js"></script>');
  const chat = index.indexOf('<script src="js/tauri-svelte-chat-engine.js"></script>');
  assert.ok(shell >= 0 && chat > shell, "le pont du chat doit suivre celui de la coque");
  assert.equal(index.split("tauri-svelte-chat-engine.js").length - 1, 1, "une seule balise");
});

test("le crochet de flux est posé une fois, avant le contrôle de la réponse HTTP", () => {
  const hook = stream.indexOf("window.__fsStreamReader");
  const check = stream.search(/if \(!response\.ok\) \{\r?\n    const detail = await response\.text\(\)/);
  assert.ok(hook > 0, "crochet absent");
  assert.ok(check > hook, "le crochet doit précéder le contrôle !response.ok");
  assert.equal(stream.split("window.__fsStreamReader({").length - 1, 1);
  for (const key of ["response", "conversation", "resume", "onDelta", "shouldStop", "fetchChatDetail", "resolveImage", "save"]) {
    assert.ok(stream.slice(hook, check).includes(key), `option « ${key} » transmise`);
  }
});

test("sans lecteur défini, le chemin historique reste en place et le fichier reste valide", () => {
  assert.match(stream, /if \(typeof window\.__fsStreamReader === "function"\)/);
  assert.doesNotThrow(() => new vm.Script(stream, { filename: "stream.js" }));
});

test("mobile/www n'est jamais modifié", () => {
  assert.ok(!originalStream.includes("__fsStreamReader"));
  assert.ok(!fs.readFileSync(path.resolve(here, "../www/index.html"), "utf8").includes("tauri-svelte-chat-engine"));
});

console.log(`test-prepare-chat-hook : ${count} tests réussis`);
