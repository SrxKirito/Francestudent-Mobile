// Choix de l'interface (classique / Svelte 5) côté Svelte : mêmes règles que interface-settings.js (écran historique).
import assert from "node:assert/strict";
import { interfaceState, applyInterface, chooseInterface } from "./src/lib/utils/interface-choice.ts";

let count = 0;
async function test(name, fn) {
  try {
    await fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
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
    removeItem(key) {
      data.delete(key);
    }
  };
}

await test("état : Svelte 5 et son chat sont la valeur par défaut", () => {
  assert.deepEqual(interfaceState("", fakeStorage()), { ui: "svelte", chat: true });
  assert.deepEqual(interfaceState("?autre=1", fakeStorage({ "fs-ui": "n'importe quoi", "fs-chat": "?" })), { ui: "svelte", chat: true });
});

await test("état : ?ui=legacy ou la clé locale donnent l'interface classique ; ?ui l'emporte", () => {
  assert.equal(interfaceState("?ui=legacy", fakeStorage()).ui, "legacy");
  assert.equal(interfaceState("", fakeStorage({ "fs-ui": "legacy" })).ui, "legacy");
  assert.equal(interfaceState("?ui=svelte", fakeStorage({ "fs-ui": "legacy" })).ui, "svelte");
  assert.equal(interfaceState("?ui=inconnu", fakeStorage({ "fs-ui": "legacy" })).ui, "legacy");
});

await test("état : le chat Svelte n'existe qu'avec l'interface Svelte ; ?chat l'emporte", () => {
  assert.equal(interfaceState("", fakeStorage({ "fs-chat": "legacy" })).chat, false);
  assert.equal(interfaceState("?chat=svelte", fakeStorage({ "fs-chat": "legacy" })).chat, true);
  assert.equal(interfaceState("?chat=legacy", fakeStorage()).chat, false);
  assert.equal(interfaceState("?ui=legacy", fakeStorage({ "fs-chat": "svelte" })).chat, false);
  assert.equal(interfaceState("", fakeStorage({ "fs-ui": "legacy" })).chat, false);
});

await test("état : un stockage qui lève une erreur à la lecture retombe sur les défauts", () => {
  const broken = {
    getItem() {
      throw new Error("refusé");
    },
    setItem() {},
    removeItem() {}
  };
  assert.deepEqual(interfaceState("", broken), { ui: "svelte", chat: true });
});

await test("choisir l'interface classique : fs-ui = legacy, fs-chat retiré, ?ui et ?chat ôtés, le reste conservé", () => {
  const storage = fakeStorage({ "fs-ui": "svelte", "fs-chat": "svelte", autre: "garde" });
  const href = applyInterface({ ui: "legacy", chat: false }, storage, "https://app.test/index.html?ui=svelte&chat=svelte&x=1#haut");
  assert.equal(href, "https://app.test/index.html?x=1#haut");
  assert.equal(storage.getItem("fs-ui"), "legacy");
  assert.equal(storage.getItem("fs-chat"), null);
  assert.equal(storage.getItem("autre"), "garde");
});

await test("choisir Svelte 5 avec le chat historique : fs-ui = svelte, fs-chat = legacy", () => {
  const storage = fakeStorage({ "fs-ui": "legacy" });
  assert.equal(applyInterface({ ui: "svelte", chat: false }, storage, "https://app.test/"), "https://app.test/");
  assert.equal(storage.getItem("fs-ui"), "svelte");
  assert.equal(storage.getItem("fs-chat"), "legacy");
});

await test("choisir Svelte 5 avec le chat Svelte : fs-ui et fs-chat valent svelte", () => {
  const storage = fakeStorage({ "fs-chat": "legacy" });
  assert.equal(applyInterface({ ui: "svelte", chat: true }, storage, "tauri://localhost/"), "tauri://localhost/");
  assert.equal(storage.getItem("fs-ui"), "svelte");
  assert.equal(storage.getItem("fs-chat"), "svelte");
});

await test("aller-retour : l'état relu après chaque choix est celui demandé", () => {
  const storage = fakeStorage();
  let href = "https://app.test/?ui=svelte&chat=svelte";
  const choices = [
    { ui: "legacy", chat: false },
    { ui: "svelte", chat: true },
    { ui: "svelte", chat: false },
    { ui: "legacy", chat: false },
    { ui: "svelte", chat: true }
  ];
  for (const choice of choices) {
    href = applyInterface(choice, storage, href);
    assert.deepEqual(interfaceState(new URL(href).search, storage), choice);
  }
});

await test("le chat Svelte demandé sans l'interface Svelte est ignoré (aucune clé fs-chat orpheline)", () => {
  const storage = fakeStorage({ "fs-chat": "svelte" });
  applyInterface({ ui: "legacy", chat: true }, storage, "https://app.test/");
  assert.equal(storage.getItem("fs-ui"), "legacy");
  assert.equal(storage.getItem("fs-chat"), null);
});

await test("stockage refusé : null et anciennes valeurs restaurées", () => {
  const storage = fakeStorage({ "fs-ui": "legacy" }, { failOn: "fs-chat" });
  assert.equal(applyInterface({ ui: "svelte", chat: true }, storage, "https://app.test/"), null);
  assert.equal(storage.getItem("fs-ui"), "legacy");
  assert.equal(storage.getItem("fs-chat"), null);
  const other = fakeStorage({}, { failOn: "fs-ui" });
  assert.equal(applyInterface({ ui: "legacy", chat: false }, other, "https://app.test/"), null);
  assert.equal(other.getItem("fs-ui"), null);
});

await test("adresse invalide : null, aucune clé modifiée", () => {
  const storage = fakeStorage({ "fs-ui": "svelte" });
  assert.equal(applyInterface({ ui: "legacy", chat: false }, storage, "pas une adresse"), null);
  assert.equal(storage.getItem("fs-ui"), "svelte");
});

await test("boutons et interrupteur : mêmes choix que l'écran historique", () => {
  const svelteWithChat = { ui: "svelte", chat: true };
  const svelteClassicChat = { ui: "svelte", chat: false };
  const classic = { ui: "legacy", chat: false };
  assert.deepEqual(chooseInterface(classic, { kind: "ui", ui: "svelte" }), { ui: "svelte", chat: true });
  assert.deepEqual(chooseInterface(svelteClassicChat, { kind: "ui", ui: "svelte" }), { ui: "svelte", chat: false });
  assert.deepEqual(chooseInterface(svelteWithChat, { kind: "ui", ui: "svelte" }), { ui: "svelte", chat: true });
  assert.deepEqual(chooseInterface(svelteWithChat, { kind: "ui", ui: "legacy" }), { ui: "legacy", chat: false });
  assert.deepEqual(chooseInterface(svelteWithChat, { kind: "chat" }), { ui: "svelte", chat: false });
  assert.deepEqual(chooseInterface(svelteClassicChat, { kind: "chat" }), { ui: "svelte", chat: true });
  assert.deepEqual(chooseInterface(classic, { kind: "chat" }), { ui: "svelte", chat: true });
});

console.log(`test-svelte-interface-choice : ${count} tests réussis`);
