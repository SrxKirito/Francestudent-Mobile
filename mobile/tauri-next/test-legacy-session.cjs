"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const script = fs.readFileSync(require("node:path").join(__dirname, "legacy-session.js"), "utf8");

function setup(oldSession, initialVault) {
  let vault = initialVault;
  let saved = "";
  let message = "";
  let writes = 0;
  const context = vm.createContext({
    store: { session: oldSession, deviceId: "device", theme: "dark" }, STORE_KEY: "fs-chat-state",
    localStorage: { setItem(key, value) { assert.equal(key, "fs-chat-state"); saved = value; } },
    saveStore() { const snapshot = { ...context.store }; delete snapshot.session; context.localStorage.setItem("fs-chat-state", JSON.stringify(snapshot)); },
    bindEvents() {}, showLogin(value) { message = value; }, showToast() {}, alert() {},
    authError: text => new Error(text),
    tauriTransport: {
      readSession: async () => vault,
      writeSession: async value => { writes++; vault = value; },
      deleteSession: async () => { vault = null; },
      exchange: async () => ({ accessToken: "short-lived-token" })
    },
    async startApp() { context.saveStore(); },
    async activateSession(value) { context.store.session = value; context.saveStore(); },
    async logout() { context.store.session = ""; context.saveStore(); }
  });
  vm.runInContext(script, context);
  return { context, vault: () => vault, saved: () => saved, message: () => message, writes: () => writes };
}

async function main() {
  const state = setup("old-session", null);
  await state.context.startApp();
  assert.equal(state.vault(), "old-session");
  assert.equal(JSON.parse(state.saved()).session, undefined);
  assert.equal(JSON.parse(state.saved()).theme, "dark");
  await state.context.activateSession("new-session");
  assert.equal(state.vault(), "new-session");
  assert.equal(JSON.parse(state.saved()).session, undefined);
  await state.context.logout();
  assert.equal(state.vault(), null);
  const conflict = setup("legacy-session", "other-session");
  await conflict.context.startApp();
  assert.equal(conflict.vault(), "other-session");
  assert.equal(conflict.writes(), 0);
  assert.equal(conflict.saved(), "");
  assert.match(conflict.message(), /données ont été conservées/);
}
main().then(() => console.log("Session : migration vérifiée et conflit conservé.")).catch(error => { console.error(error); process.exitCode = 1; });
