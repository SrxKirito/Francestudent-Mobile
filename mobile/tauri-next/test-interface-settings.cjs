"use strict";
// Choix de l'interface (classique / Svelte 5 bêta) dans Paramètres > Général : logique pure du script legacy.
// Svelte 5 est l'interface par défaut ; l'interface classique se choisit avec fs-ui = "legacy".
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "interface-settings.js"), "utf8");

// Sans DOM : seules les fonctions pures sont exposées, le branchement visuel est ignoré (aucun #panel-general).
function load() {
  const context = vm.createContext({ URL, URLSearchParams, document: { getElementById: () => null } });
  vm.runInContext(script, context);
  return context;
}

function fakeStorage(initial = {}, { failOn } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (failOn === key) throw new Error("quota");
      data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); },
  };
}

let count = 0;
function test(name, fn) {
  try {
    fn();
    count += 1;
  } catch (error) {
    console.error("ÉCHEC : " + name);
    throw error;
  }
}

test("état : sans réglage, Svelte 5 et son chat Svelte sont la valeur par défaut", () => {
  const { tauriInterfaceState } = load();
  assert.deepEqual({ ...tauriInterfaceState("", fakeStorage()) }, { ui: "svelte", chat: true });
  assert.deepEqual({ ...tauriInterfaceState("?autre=1", fakeStorage({ "fs-ui": "n'importe quoi", "fs-chat": "?" })) }, { ui: "svelte", chat: true });
});

test("état : la clé locale ou ?ui=legacy donnent l'interface classique ; ?ui l'emporte sur la clé", () => {
  const { tauriInterfaceState } = load();
  assert.equal(tauriInterfaceState("?ui=legacy", fakeStorage()).ui, "legacy");
  assert.equal(tauriInterfaceState("", fakeStorage({ "fs-ui": "legacy" })).ui, "legacy");
  assert.equal(tauriInterfaceState("?ui=svelte", fakeStorage({ "fs-ui": "legacy" })).ui, "svelte");
  assert.equal(tauriInterfaceState("?ui=inconnu", fakeStorage({ "fs-ui": "legacy" })).ui, "legacy");
});

test("état : le chat n'existe en Svelte qu'avec l'interface Svelte ; ?chat l'emporte sur la clé", () => {
  const { tauriInterfaceState } = load();
  assert.equal(tauriInterfaceState("", fakeStorage({ "fs-chat": "legacy" })).chat, false);
  assert.equal(tauriInterfaceState("?chat=svelte", fakeStorage({ "fs-chat": "legacy" })).chat, true);
  assert.equal(tauriInterfaceState("?chat=legacy", fakeStorage()).chat, false);
  assert.equal(tauriInterfaceState("?chat=inconnu", fakeStorage({ "fs-chat": "legacy" })).chat, false);
  assert.equal(tauriInterfaceState("?ui=legacy", fakeStorage({ "fs-chat": "svelte" })).chat, false);
  assert.equal(tauriInterfaceState("", fakeStorage({ "fs-ui": "legacy" })).chat, false);
});

test("choisir l'interface classique : fs-ui = legacy, fs-chat retiré, ?ui et ?chat ôtés de l'adresse, le reste conservé", () => {
  const { tauriInterfaceApply } = load();
  const storage = fakeStorage({ "fs-ui": "svelte", "fs-chat": "svelte", "autre": "garde" });
  const href = tauriInterfaceApply({ ui: "legacy", chat: false }, storage, "https://app.test/index.html?ui=svelte&chat=svelte&x=1#haut");
  assert.equal(href, "https://app.test/index.html?x=1#haut");
  assert.equal(storage.getItem("fs-ui"), "legacy");
  assert.equal(storage.getItem("fs-chat"), null);
  assert.equal(storage.getItem("autre"), "garde", "les autres clés ne sont pas touchées");
});

test("choisir Svelte 5 avec le chat historique : fs-ui = svelte, fs-chat = legacy", () => {
  const { tauriInterfaceApply } = load();
  const storage = fakeStorage({ "fs-ui": "legacy" });
  const href = tauriInterfaceApply({ ui: "svelte", chat: false }, storage, "https://app.test/");
  assert.equal(href, "https://app.test/");
  assert.equal(storage.getItem("fs-ui"), "svelte");
  assert.equal(storage.getItem("fs-chat"), "legacy");
});

test("choisir Svelte 5 avec le chat Svelte : fs-ui et fs-chat valent svelte", () => {
  const { tauriInterfaceApply } = load();
  const storage = fakeStorage({ "fs-chat": "legacy" });
  tauriInterfaceApply({ ui: "svelte", chat: true }, storage, "tauri://localhost/");
  assert.equal(storage.getItem("fs-ui"), "svelte");
  assert.equal(storage.getItem("fs-chat"), "svelte");
});

test("aller-retour : l'état relu après chaque choix est celui demandé, même avec ?ui et ?chat dans l'adresse", () => {
  const { tauriInterfaceApply, tauriInterfaceState } = load();
  const storage = fakeStorage();
  let href = "https://app.test/?ui=svelte&chat=svelte";
  const choices = [{ ui: "legacy", chat: false }, { ui: "svelte", chat: true }, { ui: "svelte", chat: false }, { ui: "legacy", chat: false }, { ui: "svelte", chat: true }];
  for (const choice of choices) {
    href = tauriInterfaceApply(choice, storage, href);
    assert.deepEqual({ ...tauriInterfaceState(new URL(href).search, storage) }, choice);
  }
  href = tauriInterfaceApply({ ui: "legacy", chat: false }, storage, "https://app.test/?ui=legacy");
  assert.deepEqual({ ...tauriInterfaceState(new URL(href).search, storage) }, { ui: "legacy", chat: false });
});

test("le chat Svelte demandé sans l'interface Svelte est ignoré (aucune clé fs-chat orpheline)", () => {
  const { tauriInterfaceApply } = load();
  const storage = fakeStorage({ "fs-chat": "svelte" });
  tauriInterfaceApply({ ui: "legacy", chat: true }, storage, "https://app.test/");
  assert.equal(storage.getItem("fs-ui"), "legacy");
  assert.equal(storage.getItem("fs-chat"), null);
});

test("stockage refusé : le choix est signalé (null) et les anciennes valeurs sont restaurées", () => {
  const { tauriInterfaceApply } = load();
  const storage = fakeStorage({ "fs-ui": "legacy" }, { failOn: "fs-chat" });
  const href = tauriInterfaceApply({ ui: "svelte", chat: true }, storage, "https://app.test/");
  assert.equal(href, null);
  assert.equal(storage.getItem("fs-ui"), "legacy");
  assert.equal(storage.getItem("fs-chat"), null);
  const other = fakeStorage({}, { failOn: "fs-ui" });
  assert.equal(tauriInterfaceApply({ ui: "legacy", chat: false }, other, "https://app.test/"), null);
  assert.equal(other.getItem("fs-ui"), null);
});

test("adresse invalide : null, aucune clé modifiée", () => {
  const { tauriInterfaceApply } = load();
  const storage = fakeStorage({ "fs-ui": "svelte" });
  assert.equal(tauriInterfaceApply({ ui: "legacy", chat: false }, storage, "pas une adresse"), null);
  assert.equal(storage.getItem("fs-ui"), "svelte");
});

test("le script n'écrit que les clés fs-ui et fs-chat et n'utilise aucun appel réseau", () => {
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(script));
  assert.deepEqual([...new Set(script.match(/"fs-[a-z]+"/g))].sort(), ['"fs-chat"', '"fs-ui"']);
});

test("la préparation du legacy copie le script et l'injecte dans la page, sans modifier mobile/www", () => {
  const prepared = path.join(__dirname, "public", "legacy");
  const index = fs.readFileSync(path.join(prepared, "index.html"), "utf8");
  assert.ok(index.includes('<script src="js/tauri-interface-settings.js"></script>'));
  assert.equal(fs.readFileSync(path.join(prepared, "js", "tauri-interface-settings.js"), "utf8"), script);
  const original = fs.readFileSync(path.join(__dirname, "..", "www", "index.html"), "utf8");
  assert.ok(!original.includes("tauri-interface-settings"));
});

console.log("test-interface-settings : " + count + " tests réussis");
