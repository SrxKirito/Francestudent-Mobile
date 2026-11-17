import assert from "node:assert/strict";
import { installEarlyGuard, createSuspender, drainConversationWrites, mountLegacyExport, GUARD_PROPERTY } from "./legacy-export-wiring.mjs";

class IDBDatabase { constructor() { this.name = "autre"; } transaction() { return {}; } }
class Storage { setItem() {} removeItem() {} clear() {} }
const locks = { request: (name, options, callback) => Promise.resolve().then(() => callback()) };

// --- Étape A : garde précoce -------------------------------------------------
const conversations = [{ id: "a", messages: [] }];
const local = { state: '{"theme":"dark"}', getItem: () => local.state };
const target = {};
let storeReady = false;
const readConversations = () => { if (!storeReady) throw new Error("store indisponible"); return conversations; };
assert.throws(() => installEarlyGuard({ IDBDatabase, Storage, locks, localStorage: local, target: {} }), /Lecture des discussions/);
const acquire = installEarlyGuard({ IDBDatabase, Storage, locks, localStorage: local, readConversations, target });
assert.equal(target[GUARD_PROPERTY], acquire);
assert.throws(() => { target[GUARD_PROPERTY] = null; }, TypeError, "propriété non modifiable");
assert.throws(() => installEarlyGuard({ IDBDatabase, Storage, locks, localStorage: local, readConversations, target }), /déjà installée/);
await assert.rejects(acquire(), /store indisponible/, "sans store, aucune capture silencieuse");
storeReady = true;
const release = await acquire();
await release.assertValid();
conversations.push({ id: "b" });
await assert.rejects(release.assertValid(), /modification/);
await release();
const second = await acquire();
local.state = '{"theme":"light"}';
await assert.rejects(second.assertValid(), /modification/, "un changement des réglages est détecté");
await second();

// --- Suspension de l'interface -----------------------------------------------
function makeDom() {
  const body = { children: [], append(node) { body.children.push(node); } };
  const make = () => ({ style: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, remove() { const i = body.children.indexOf(this); if (i >= 0) body.children.splice(i, 1); }, append(...n) { (this.children ||= []).push(...n); }, textContent: "", value: "" });
  const document = { body, createElement: () => make() };
  body.children.push(make(), Object.assign(make(), { inert: true }));
  return { document, body };
}
{
  const { document, body } = makeDom();
  await assert.rejects(createSuspender({ document, isBusy: () => true, isSyncRunning: () => false })(), /réponse est en cours/);
  await assert.rejects(createSuspender({ document, isBusy: () => false, isSyncRunning: () => true })(), /synchronisation/);
  assert.equal(body.children.length, 2, "aucun écran de blocage si la suspension est refusée");
  const resume = await createSuspender({ document, isBusy: () => false, isSyncRunning: () => false })();
  assert.equal(body.children.length, 3);
  assert.ok(body.children.slice(0, 2).every(child => child.inert === true));
  assert.equal(body.children[2].attributes.role, "alert");
  await resume(); await resume();
  assert.equal(body.children.length, 2);
  assert.equal(body.children[0].inert, false);
  assert.equal(body.children[1].inert, true, "l'état inert d'origine est restauré");
}

// --- Attente de l'écriture des discussions -------------------------------------
{
  let write = null, pending = true;
  setTimeout(() => { pending = false; }, 20);
  write = new Promise(resolve => setTimeout(() => { write = null; resolve(); }, 40));
  await drainConversationWrites({ getWrite: () => write, hasPending: () => pending, intervalMs: 5 });
  assert.equal(write, null); assert.equal(pending, false);
  await assert.rejects(drainConversationWrites({ getWrite: () => null, hasPending: () => true, timeoutMs: 30, intervalMs: 5 }), /en cours d’enregistrement/);
}

// --- Étape B : montage ----------------------------------------------------------
{
  const { document, body } = makeDom();
  const container = document.createElement("section");
  let committed = 0, singleChecks = 0, openedPreviews = 0;
  const plugin = {
    async begin() { return { id: "t" }; }, async append() {}, async commit() { committed++; return { name: "FranceStudent-t.fsbackup" }; }, async abort() {},
    async verifySingleWebView() { singleChecks++; return { single: true }; }
  };
  const capacitor = { isPluginAvailable: name => name === "MigrationExport", Plugins: { MigrationExport: plugin } };
  const guard = async () => { const done = async () => {}; done.assertValid = async () => {}; return done; };
  let busyNow = false;
  const globals = { isBusy: () => busyNow, isSyncRunning: () => false, getWrite: () => null, hasPending: () => false, readConversations: () => [] };
  const options = { capacitor, document, container, acquireGuard: guard, localStorage: { getItem: () => "{}" }, globals, async openPreviewDatabase() { openedPreviews++; return { objectStoreNames: { contains: () => false }, transaction() {} }; } };
  assert.equal(mountLegacyExport({ ...options, capacitor: { isPluginAvailable: () => false } }), null, "build de production : rien n'est monté");
  assert.equal(mountLegacyExport({ ...options, capacitor: undefined }), null);
  assert.equal(container.children, undefined);
  assert.throws(() => mountLegacyExport({ ...options, acquireGuard: undefined }), /Garde d'export absente/);
  assert.equal(container.children, undefined, "pas d'interface sans garde");
  const mounted = mountLegacyExport(options);
  const [, , label, button, status] = mounted.ui.section.children;
  assert.equal(mounted.ui.section.children.length, 5, "export seul : pas d'import");
  label.children[0].value = "une phrase longue de test";
  await button.onclick();
  assert.match(status.textContent, /FranceStudent-t\.fsbackup/);
  assert.equal(committed, 1); assert.ok(singleChecks >= 2); assert.equal(openedPreviews, 1);
  assert.equal(body.children.length, 2, "l'interface est reprise après l'export");
  busyNow = true;
  label.children[0].value = "une phrase longue de test";
  await button.onclick();
  assert.match(status.textContent, /réponse est en cours/);
  assert.equal(committed, 1, "aucune sauvegarde pendant une réponse");
  assert.equal(body.children.length, 2);
}
console.log("Raccordement de l’export : garde, suspension, écritures et montage vérifiés.");
