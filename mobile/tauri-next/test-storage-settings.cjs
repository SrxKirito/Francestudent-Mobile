"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MB = 1024 * 1024;
const NBSP = "\u00a0";
const script = fs.readFileSync(path.join(__dirname, "storage-settings.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.hidden = false; this.attributes = {}; this.dataset = {};
    this.style = {}; this.textContent = ""; this.className = ""; this.id = ""; this.disabled = false;
  }
  set innerHTML(value) { throw new Error("innerHTML interdit : " + value); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  get childElementCount() { return this.children.length; }
}
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function findById(root, id) { let found = null; walk(root, node => { if (node.id === id) found = node; }); return found; }
const fakeDoc = { createElement: tag => new Node(tag) };

// ---------- Fonctions pures ----------
function testPure() {
  const context = vm.createContext({ Number, String, Date, Promise });
  vm.runInContext(script, context);
  const s = context.tauriStorageSettings;
  assert.equal(s.formatBytes(0), "0" + NBSP + "o");
  assert.equal(s.formatBytes(1536), "1,5" + NBSP + "Ko");
  assert.equal(s.formatBytes(5 * MB), "5" + NBSP + "Mo");
  for (const bad of [-1, NaN, Infinity, "5", null, undefined]) assert.equal(s.formatBytes(bad), "—");
  assert.equal(s.formatDate(0), "");
  assert.equal(s.formatDate("x"), "");
  assert.notEqual(s.formatDate(1700000000), "");
  assert.equal(s.formatDate(1700000000), s.formatDate(1700000000000));

  assert.deepEqual(plain(s.parseUsage({ usedBytes: 10 * MB, maxBytes: 100 * MB, filesBytes: 6 * MB, skillsBytes: MB })),
    { used: 10 * MB, max: 100 * MB, remaining: 90 * MB, percent: 10, full: false, files: 6 * MB, skills: MB });
  assert.equal(s.parseUsage({ usedBytes: 10, maxBytes: 100, remainingBytes: 50 }).remaining, 50, "le reste fourni par le serveur prime");
  const over = s.parseUsage({ usedBytes: 120, maxBytes: 100 });
  assert.equal(over.percent, 100); assert.equal(over.full, true); assert.equal(over.remaining, 0);
  const zero = s.parseUsage({ usedBytes: 0, maxBytes: 0 });
  assert.equal(zero.percent, 0); assert.equal(zero.full, false);
  assert.equal(s.parseUsage({ usedBytes: 1, maxBytes: 2 }).files, null);
  for (const bad of [null, undefined, "x", {}, { usedBytes: -1, maxBytes: 5 }, { usedBytes: "1", maxBytes: 5 }, { usedBytes: NaN, maxBytes: 5 }, { usedBytes: 1 }]) {
    assert.equal(s.parseUsage(bad), null);
  }
}

// ---------- Chargement indépendant des catégories ----------
async function testOverviewIsolation() {
  const context = vm.createContext({ Number, String, Date, Promise });
  vm.runInContext(script, context);
  const s = context.tauriStorageSettings;
  const partial = plain(await s.loadOverview(async path => {
    if (path === "/filesv2/usage") return { usedBytes: 1, maxBytes: 2 };
    if (path === "/files") throw Object.assign(new Error("Erreur 410"), { status: 410 });
    if (path === "/chats/archived?limit=50") return { chats: [{}, {}], hasMore: true };
    throw new Error("Requête inattendue : " + path);
  }));
  assert.equal(partial.usage.ok, true);
  assert.deepEqual(partial.images, { ok: false, error: "Erreur 410" });
  assert.deepEqual(partial.archived, { ok: true, value: { count: 2, more: true } });

  const invalid = plain(await s.loadOverview(async path => (path === "/filesv2/usage" ? { nope: true } : path === "/files" ? {} : { chats: "x" })));
  assert.deepEqual(invalid.usage, { ok: false, error: "Quota de stockage non reconnu." });
  assert.equal(invalid.images.ok, false);
  assert.equal(invalid.archived.ok, false);

  const raw = plain(await s.loadOverview(() => Promise.reject("boom")));
  assert.equal(raw.usage.error, "Erreur inconnue.");
}

// ---------- Contrôleur ----------
function makeEnv(overrides = {}) {
  const env = {
    session: "s1", usedBytes: 10 * MB, deleteResult: true, confirmAnswer: true,
    calls: [], previews: [], downloads: [], confirms: [], opened: { skills: 0, archived: 0 }, failPaths: new Set()
  };
  env.api = async (apiPath, options) => {
    const method = options?.method || "GET";
    env.calls.push(method + " " + apiPath);
    if (env.failPaths.has(apiPath)) throw new Error("Panne " + apiPath);
    if (apiPath === "/filesv2/usage") return { usedBytes: env.usedBytes, maxBytes: 100 * MB, filesBytes: 8 * MB, skillsBytes: 2 * MB };
    if (apiPath === "/files") return ["a", "b", "c"];
    if (apiPath === "/chats/archived?limit=50") return { chats: [{ id: "1" }], hasMore: false };
    if (apiPath === "/filesv2?limit=30") return { data: [{ id: "one", filename: "<img src=x onerror=alert(1)>.pdf", bytes: 1536, created_at: 1700000000 }], has_more: true, last_id: "one" };
    if (apiPath === "/filesv2?limit=30&after=one") return { data: [{ id: "two", filename: "b.pdf", bytes: 2048, isValid: false }], has_more: false, last_id: "two" };
    if (apiPath === "/filesv2/one" && method === "DELETE") return { deleted: env.deleteResult };
    throw new Error("Requête inattendue : " + method + " " + apiPath);
  };
  Object.assign(env, overrides);
  return env;
}
function makeController(env) {
  const context = vm.createContext({ Number, String, Date, Promise, encodeURIComponent });
  vm.runInContext(script, context);
  const root = new Node("section");
  const controller = context.tauriStorageSettings.createController({
    doc: fakeDoc, root, api: (p, o) => env.api(p, o), getSession: () => env.session,
    confirmAction: message => { env.confirms.push(message); return env.confirmAnswer; },
    previewFile: file => env.previews.push(plain(file)), downloadFile: file => env.downloads.push(plain(file)),
    openSkills: () => { env.opened.skills++; }, canOpenArchived: () => true, openArchived: () => { env.opened.archived++; }
  });
  return controller;
}
const text = node => node.children.map(child => child.textContent);

async function testController() {
  const env = makeEnv();
  const c = makeController(env);
  const e = c.elements;
  await c.show(); await tick();
  assert.equal(e.usageText.textContent, `10${NBSP}Mo utilisés sur 100${NBSP}Mo`);
  assert.equal(e.meter.hidden, false);
  assert.equal(e.meter.attributes["aria-valuenow"], "10");
  assert.equal(e.fill.style.width, "10%");
  assert.equal(e.remainingText.textContent, `90${NBSP}Mo disponibles`);
  assert.equal(e.categories.children.length, 4);
  const rows = e.categories.children.map(row => text(row));
  assert.deepEqual(rows[0], ["Fichiers", `8${NBSP}Mo`]);
  assert.deepEqual(rows[1], ["Images", `3 images · taille non fournie`]);
  assert.deepEqual(rows[2], ["Conversations archivées", "1 conversation archivée"]);
  assert.deepEqual(rows[3], ["Skills", `2${NBSP}Mo`]);
  assert.equal(e.categories.children[1].tag, "div", "les images n'ont pas d'action");
  assert.equal(e.categories.children[0].tag, "button");
  assert.equal(e.overviewStatus.textContent, "");

  e.categories.children[3].onclick(); assert.equal(env.opened.skills, 1);
  e.categories.children[2].onclick(); assert.equal(env.opened.archived, 1);

  // Liste des fichiers : pagination, texte non interprété, aperçu, téléchargement.
  e.categories.children[0].onclick(); await tick();
  assert.equal(e.overview.hidden, true); assert.equal(e.detail.hidden, false);
  assert.equal(e.list.children.length, 1);
  const first = e.list.children[0];
  assert.equal(first.children[0].children[0].textContent, "<img src=x onerror=alert(1)>.pdf");
  assert.ok(first.children[0].children[1].textContent.startsWith(`1,5${NBSP}Ko · `));
  assert.equal(e.more.hidden, false);
  e.more.onclick(); await tick();
  assert.equal(e.list.children.length, 2); assert.equal(e.more.hidden, true);
  assert.ok(e.list.children[1].children[0].children[1].textContent.includes("fichier invalide"));
  first.children[1].children[0].onclick();
  assert.deepEqual(env.previews[0], { name: "<img src=x onerror=alert(1)>.pdf", kind: "file", remoteKind: "file", remoteId: "one", size: 1536 });
  first.children[1].children[1].onclick();
  assert.deepEqual(env.downloads[0], { name: "<img src=x onerror=alert(1)>.pdf", remoteId: "one" });

  // Suppression : refus, non confirmée par le serveur, puis réussie.
  const removeFirst = () => first.children[1].children[2].onclick();
  env.confirmAnswer = false; await removeFirst();
  assert.ok(!env.calls.includes("DELETE /filesv2/one")); assert.equal(e.list.children.length, 2);
  env.confirmAnswer = true; env.deleteResult = false; await removeFirst();
  assert.equal(e.list.children.length, 2);
  assert.equal(e.detailStatus.textContent, "Suppression impossible : Suppression non confirmée par le serveur.");
  env.deleteResult = true; env.usedBytes = 9 * MB;
  const usageCallsBefore = env.calls.filter(call => call === "GET /filesv2/usage").length;
  await removeFirst();
  assert.equal(e.list.children.length, 1);
  assert.equal(e.detailStatus.textContent, "Fichier supprimé du stockage.");
  assert.equal(env.calls.filter(call => call === "GET /filesv2/usage").length, usageCallsBefore + 1, "le quota est relu après suppression");
  assert.equal(e.usageText.textContent, `9${NBSP}Mo utilisés sur 100${NBSP}Mo`);

  // Changement de session : aucune action distante.
  const second = e.list.children[0];
  env.session = "s2"; const confirmsBefore = env.confirms.length;
  await second.children[1].children[2].onclick();
  assert.equal(env.confirms.length, confirmsBefore);
  assert.equal(e.detailStatus.textContent, "La session a changé. Rouvre l'onglet Stockage.");
  env.session = "s1";

  e.back.onclick(); assert.equal(e.overview.hidden, false); assert.equal(e.detail.hidden, true);
}

async function testFailuresAndEdgeCases() {
  // Catégorie en erreur : les autres restent affichées.
  let env = makeEnv(); env.failPaths.add("/files");
  let c = makeController(env);
  await c.show(); await tick();
  let rows = c.elements.categories.children;
  assert.ok(rows[1].className.includes("is-error"));
  assert.equal(rows[1].children[1].textContent, "Indisponible : Panne /files");
  assert.equal(rows[0].children[1].textContent, `8${NBSP}Mo`);
  assert.equal(c.elements.overviewStatus.textContent, "Certaines informations n'ont pas pu être chargées.");

  // Quota en erreur.
  env = makeEnv(); env.failPaths.add("/filesv2/usage");
  c = makeController(env); await c.show(); await tick();
  assert.equal(c.elements.meter.hidden, true);
  assert.ok(c.elements.usageText.textContent.startsWith("Quota indisponible : Panne"));
  assert.ok(c.elements.categories.children[0].children[1].textContent.startsWith("Indisponible : "));

  // Quota plein.
  env = makeEnv({ usedBytes: 100 * MB });
  c = makeController(env); await c.show(); await tick();
  assert.equal(c.elements.meter.attributes["aria-valuenow"], "100");
  assert.ok(c.elements.meter.className.includes("is-high"));
  assert.ok(c.elements.remainingText.textContent.startsWith("Stockage plein"));

  // Sans session : aucun appel réseau.
  env = makeEnv({ session: "" });
  c = makeController(env); await c.show(); await tick();
  assert.equal(c.elements.usageText.textContent, "Connecte-toi pour voir ton stockage.");
  assert.equal(env.calls.length, 0);

  // Réponse périmée : la dernière ouverture gagne.
  const pending = [];
  env = makeEnv();
  const baseApi = env.api;
  env.api = (apiPath, options) => apiPath === "/filesv2/usage" && !options
    ? new Promise(resolve => pending.push(resolve))
    : baseApi(apiPath, options);
  c = makeController(env);
  const p1 = c.show(), p2 = c.show();
  pending[1]({ usedBytes: 20 * MB, maxBytes: 100 * MB }); await p2;
  pending[0]({ usedBytes: 10 * MB, maxBytes: 100 * MB }); await p1; await tick();
  assert.equal(c.elements.usageText.textContent, `20${NBSP}Mo utilisés sur 100${NBSP}Mo`);

  // Session perdue pendant le chargement : rien n'est affiché.
  env = makeEnv();
  const late = [];
  env.api = (apiPath, options) => apiPath === "/filesv2/usage" ? new Promise(resolve => late.push(resolve)) : baseApi(apiPath, options);
  c = makeController(env);
  const pending3 = c.show();
  env.session = "autre";
  late[0]({ usedBytes: 1, maxBytes: 2 }); await pending3; await tick();
  assert.equal(c.elements.usageText.textContent, "");
  assert.equal(c.elements.overviewStatus.textContent, "La session a changé. Rouvre l'onglet Stockage.");

  // Liste vide, erreur puis nouvelle tentative, curseur incohérent.
  env = makeEnv();
  const original = env.api;
  env.api = async (apiPath, options) => apiPath === "/filesv2?limit=30" ? { data: [], has_more: false } : original(apiPath, options);
  c = makeController(env); await c.show(); c.openFiles(); await tick();
  assert.equal(c.elements.detailStatus.textContent, "Aucun fichier enregistré.");

  env = makeEnv(); let failOnce = true;
  const base2 = env.api;
  env.api = async (apiPath, options) => { if (apiPath === "/filesv2?limit=30" && failOnce) { failOnce = false; throw new Error("réseau"); } return base2(apiPath, options); };
  c = makeController(env); await c.show(); c.openFiles(); await tick();
  assert.equal(c.elements.detailStatus.textContent, "Chargement impossible : réseau");
  assert.equal(c.elements.more.hidden, false); assert.equal(c.elements.more.textContent, "Réessayer");
  c.elements.more.onclick(); await tick();
  assert.equal(c.elements.list.children.length, 1);

  env = makeEnv();
  const base3 = env.api;
  env.api = async (apiPath, options) => apiPath === "/filesv2?limit=30" ? { data: [], has_more: true } : base3(apiPath, options);
  c = makeController(env); await c.show(); c.openFiles(); await tick();
  assert.equal(c.elements.detailStatus.textContent, "Chargement impossible : Curseur de pagination indisponible.");
}

// ---------- Installation dans les paramètres ----------
async function testInstall() {
  const tablist = new Node("nav"); tablist.id = "settings-tablist";
  const panels = new Node("div");
  const calls = []; const clicks = { toggle: 0, closeSettings: 0 };
  const document = {
    createElement: tag => new Node(tag),
    getElementById: id => findById(tablist, id) || findById(panels, id),
    querySelector: selector => (selector === "#settings-menu .settings-panels" ? panels : null)
  };
  const context = vm.createContext({
    Number, String, Date, Promise, encodeURIComponent, document,
    store: { session: "s1" }, confirm: () => true,
    settingsApi: async apiPath => {
      calls.push(apiPath);
      if (apiPath === "/filesv2/usage") return { usedBytes: 5 * MB, maxBytes: 50 * MB };
      if (apiPath === "/files") return [];
      if (apiPath === "/chats/archived?limit=50") return { chats: [], hasMore: false };
      throw new Error("Requête inattendue : " + apiPath);
    },
    previewAttachment() {}, downloadTauriRemoteFile() {},
    closeSettings: () => { clicks.closeSettings++; }
  });
  vm.runInContext("const selected = []; function selectSettingsTab(name, focus) { selected.push([name, focus]); }", context);
  vm.runInContext("const archivedChats = { toggle: null, panel: { hidden: true } };", context);
  vm.runInContext(script, context);

  const tab = findById(tablist, "tab-storage"), panel = findById(panels, "panel-storage");
  assert.ok(tab && panel);
  assert.equal(tab.dataset.tab, "storage");
  assert.equal(tab.attributes.role, "tab");
  assert.equal(tab.attributes["aria-controls"], "panel-storage");
  assert.equal(tab.attributes["aria-selected"], "false");
  assert.equal(tab.children[0].textContent, "Stockage");
  assert.equal(panel.dataset.panel, "storage");
  assert.equal(panel.attributes.role, "tabpanel");
  assert.equal(panel.attributes["aria-labelledby"], "tab-storage");
  assert.equal(panel.hidden, true);
  assert.equal(context.tauriStorageSettings.install(document), null, "l'installation est idempotente");
  assert.equal(tablist.children.length, 1);

  context.selectSettingsTab("general", false); await tick();
  assert.equal(calls.length, 0, "les autres onglets ne déclenchent aucun appel");
  context.selectSettingsTab("storage", true); await tick();
  assert.deepEqual(plain(vm.runInContext("selected", context)), [["general", false], ["storage", true]]);
  assert.deepEqual(plain(calls.sort()), ["/chats/archived?limit=50", "/files", "/filesv2/usage"]);
  const usageNode = findAll(panel, node => node.className === "ss-usage-text")[0];
  assert.equal(usageNode.textContent, `5${NBSP}Mo utilisés sur 50${NBSP}Mo`);

  // L'accès aux archives est résolu au moment de l'appel : le bouton n'existe pas tant que le panneau n'est pas prêt.
  const categories = findAll(panel, node => node.className === "ss-categories")[0];
  assert.equal(categories.children[2].tag, "div");
  const archive = vm.runInContext("archivedChats", context);
  archive.toggle = { click: () => { clicks.toggle++; } };
  context.selectSettingsTab("storage"); await tick();
  const row = findAll(panel, node => node.className === "ss-categories")[0].children[2];
  assert.equal(row.tag, "button");
  row.onclick();
  assert.equal(clicks.closeSettings, 1); assert.equal(clicks.toggle, 1);
  archive.panel.hidden = false; row.onclick();
  assert.equal(clicks.toggle, 1, "le panneau déjà ouvert n'est pas refermé");
  findAll(panel, node => node.className === "ss-categories")[0].children[3].onclick();
  assert.deepEqual(plain(vm.runInContext("selected", context)).at(-1), ["skills", false]);

  // Sans les éléments des paramètres, le module ne fait rien et ne plante pas.
  const bare = vm.createContext({ Number, String, Date, Promise, document: { getElementById: () => null, querySelector: () => null, createElement: tag => new Node(tag) } });
  vm.runInContext(script, bare);
  assert.equal(typeof bare.tauriStorageSettings.install, "function");
}
function findAll(root, predicate) { const out = []; walk(root, node => { if (predicate(node)) out.push(node); }); return out; }

(async () => {
  testPure();
  await testOverviewIsolation();
  await testController();
  await testFailuresAndEdgeCases();
  await testInstall();
  console.log("Onglet Stockage : formats, quota, catégories indépendantes, pagination, suppression confirmée et garde de session vérifiés.");
})().catch(error => { console.error(error); process.exitCode = 1; });
