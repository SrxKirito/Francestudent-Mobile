"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.hidden = false; this.attributes = {}; this.textContent = ""; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  after(...nodes) { this.parent.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  addEventListener(type, listener) { (this.listeners ||= {})[type] = listener; }
  get childElementCount() { return this.children.length; }
  querySelector(selector) { return selector === "header" ? this.header : null; }
}

// Observateur d'intersection factice : rien n'est chargé tant que le test ne signale pas la visibilité.
class FakeObserver {
  static instances = [];
  constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; FakeObserver.instances.push(this); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
  show(target) { this.callback([{ isIntersecting: true, target }]); }
}

const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const PANEL = { usage: 0, controls: 1, status: 2, list: 3, more: 4 };
const ROW = { thumb: 0, label: 1, preview: 2, remove: 3, download: 4 };

function setup({ settingsApi, fetchBlob, withObserver = true, withThumbnails = true }) {
  FakeObserver.instances = [];
  const dialog = new Node("dialog"); dialog.header = new Node("header"); dialog.append(dialog.header);
  const urls = { created: [], revoked: [] };
  const context = vm.createContext({
    openLibrary: async () => {},
    store: { session: "test-session" },
    document: { getElementById: () => dialog, createElement: tag => new Node(tag) },
    settingsApi,
    tauriThumbnailBlob: fetchBlob || (async () => { throw Error("Aucune vignette attendue."); }),
    URL: { createObjectURL: () => { const url = "blob:test/" + (urls.created.length + 1); urls.created.push(url); return url; }, revokeObjectURL: url => urls.revoked.push(url) },
    Blob, AbortController,
    IntersectionObserver: withObserver ? FakeObserver : undefined,
    previewAttachment() {}, confirm: () => true, Number, String, encodeURIComponent
  });
  vm.runInContext(read("files-store.js"), context);
  if (withThumbnails) vm.runInContext(read("file-thumbnails.js"), context);
  vm.runInContext(read("legacy-storage.js"), context);
  return { context, dialog, urls };
}

const labels = list => list.children.map(row => row.children[ROW.label].textContent);

async function testPaginationAndDelete() {
  const calls = [];
  const { context, dialog } = setup({
    settingsApi: async (requestPath, options) => {
      calls.push([requestPath, options?.method || "GET"]);
      if (requestPath === "/filesv2/usage") return { usedBytes: 10, maxBytes: 100 };
      if (requestPath === "/filesv2?limit=30") return { data: [{ id: "one", filename: "a.pdf" }], has_more: true, last_id: "one" };
      if (requestPath === "/filesv2?limit=30&after=one") return { data: [{ id: "two", filename: "b.pdf" }], has_more: false, last_id: "two" };
      if (requestPath === "/filesv2/one" && options?.method === "DELETE") return { deleted: true };
      throw Error("Unexpected request: " + requestPath);
    }
  });
  await context.openLibrary();
  const toggle = dialog.children[1], panel = dialog.children[2];
  toggle.onclick();
  await tick();
  const list = panel.children[PANEL.list], more = panel.children[PANEL.more], status = panel.children[PANEL.status];
  const [, kindSelect] = panel.children[PANEL.controls].children;
  assert.equal(list.childElementCount, 1);
  assert.equal(more.hidden, false);

  // Un filtre appliqué alors que la liste serveur n'est pas entièrement chargée le dit honnêtement.
  kindSelect.value = "image"; kindSelect.onchange();
  assert.equal(list.childElementCount, 0);
  assert.match(status.textContent, /Aucun fichier ne correspond parmi les 1 fichiers chargés/);
  assert.match(status.textContent, /Charge-en davantage/);
  kindSelect.value = "*"; kindSelect.onchange();
  assert.equal(list.childElementCount, 1);
  assert.equal(status.textContent, "");

  more.onclick();
  await tick();
  assert.equal(list.childElementCount, 2);
  assert.equal(more.hidden, true);
  context.confirm = () => false;
  await list.children[0].children[ROW.remove].onclick();
  assert.equal(list.childElementCount, 2, "suppression refusée : rien n'est supprimé");
  assert.ok(!calls.some(([, method]) => method === "DELETE"));
  context.confirm = () => true;
  await list.children[0].children[ROW.remove].onclick();
  assert.equal(list.childElementCount, 1);
  assert.ok(calls.some(([requestPath, method]) => requestPath === "/filesv2/one" && method === "DELETE"));
  context.store.session = "other-session";
  await list.children[0].children[ROW.remove].onclick();
  assert.equal(list.childElementCount, 1);
  assert.ok(!calls.some(([requestPath, method]) => requestPath === "/filesv2/two" && method === "DELETE"));
  assert.equal(panel.children[PANEL.usage].textContent, "Stockage utilisé : 0 Mo sur 0 Mo.");

  // Réouverture de la bibliothèque : le cache partagé évite de relire la liste.
  context.store.session = "test-session";
  const listCallsBefore = calls.filter(([requestPath]) => requestPath.startsWith("/filesv2?")).length;
  dialog.children.length = 1;
  await context.openLibrary();
  dialog.children[1].onclick(); await tick();
  assert.equal(calls.filter(([requestPath]) => requestPath.startsWith("/filesv2?")).length, listCallsBefore, "liste servie depuis le cache");
  assert.equal(dialog.children[2].children[PANEL.list].childElementCount, 1);
}

const FILES = [
  { id: "i1", filename: "photo.png", bytes: 100, created_at: 300 },
  { id: "t1", filename: "notes.txt", bytes: 50, created_at: 200 },
  { id: "p1", filename: "cours.pdf", bytes: 500, created_at: 100 },
  { id: "b1", filename: "enorme.png", bytes: 5 * 1024 * 1024, created_at: 400 },
  { id: "c1", filename: "main.py", bytes: 20, created_at: 50 }
];

function thumbnailApi(files, calls) {
  return async (requestPath, options) => {
    calls.push([requestPath, options?.method || "GET"]);
    if (requestPath === "/filesv2/usage") return { usedBytes: 1, maxBytes: 10 };
    if (requestPath === "/filesv2?limit=30") return { data: files, has_more: false, last_id: files[files.length - 1].id };
    if (options?.method === "DELETE") return { deleted: true };
    throw Error("Unexpected request: " + requestPath);
  };
}

async function testControlsAndThumbnails() {
  const calls = [], fetched = [];
  const { context, dialog, urls } = setup({
    settingsApi: thumbnailApi(FILES, calls),
    fetchBlob: async (file, options) => {
      fetched.push({ id: file.id, limit: options.limit, truncate: options.truncate, hasSignal: Boolean(options.signal) });
      return file.id === "i1" ? new Blob(["x"], { type: "image/png" }) : new Blob(["bonjour\nmonde"], { type: "text/plain" });
    }
  });
  await context.openLibrary();
  const toggle = dialog.children[1], panel = dialog.children[2];
  toggle.onclick();
  await tick();
  const list = panel.children[PANEL.list], status = panel.children[PANEL.status];
  const [search, kindSelect, sortSelect] = panel.children[PANEL.controls].children;
  const observer = FakeObserver.instances[0];

  // Ordre par défaut : plus récents d'abord. Aucune requête de vignette avant la visibilité.
  assert.deepEqual(labels(list), ["enorme.png", "photo.png", "notes.txt", "cours.pdf", "main.py"]);
  assert.equal(fetched.length, 0);
  assert.equal(observer.options.rootMargin, "160px");
  // PDF et image trop lourde : icône d'emblée, jamais observées, donc jamais demandées.
  assert.equal(observer.targets.size, 3);
  const thumbOf = name => list.children[labels(list).indexOf(name)].children[ROW.thumb];
  assert.equal(observer.targets.has(thumbOf("cours.pdf")), false);
  assert.equal(observer.targets.has(thumbOf("enorme.png")), false);
  assert.equal(thumbOf("cours.pdf").children[0].textContent, "PDF");

  // Visibilité signalée : seules les vignettes concernées sont demandées, avec leurs bornes.
  observer.show(thumbOf("photo.png")); await tick();
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].id, "i1");
  assert.equal(fetched[0].limit, 2 * 1024 * 1024);
  assert.equal(fetched[0].hasSignal, true);
  const image = thumbOf("photo.png").children[0];
  assert.equal(image.tag, "img");
  assert.equal(image.src, "blob:test/1");
  assert.equal(thumbOf("photo.png").attributes["data-state"], "image");
  observer.show(thumbOf("notes.txt")); await tick();
  assert.equal(fetched[1].truncate, true);
  assert.equal(thumbOf("notes.txt").children[0].tag, "pre");
  assert.equal(thumbOf("notes.txt").children[0].textContent, "bonjour\nmonde");
  observer.show(thumbOf("photo.png")); await tick();
  assert.equal(fetched.length, 2, "une vignette déjà demandée n'est pas redemandée");
  assert.equal(observer.targets.has(thumbOf("photo.png")), false);

  // Tri.
  sortSelect.value = "size-asc"; sortSelect.onchange();
  assert.deepEqual(labels(list), ["main.py", "notes.txt", "photo.png", "cours.pdf", "enorme.png"]);
  sortSelect.value = "name-desc"; sortSelect.onchange();
  assert.deepEqual(labels(list), ["photo.png", "notes.txt", "main.py", "enorme.png", "cours.pdf"]);
  assert.equal(status.textContent, "", "liste complète : aucun avertissement");
  sortSelect.value = "date-asc"; sortSelect.onchange();
  assert.deepEqual(labels(list), ["main.py", "cours.pdf", "notes.txt", "photo.png", "enorme.png"]);

  // Type et recherche (insensibles à la casse et aux accents).
  kindSelect.value = "code"; kindSelect.onchange();
  assert.deepEqual(labels(list), ["main.py"]);
  kindSelect.value = "image"; kindSelect.onchange();
  assert.deepEqual(labels(list), ["photo.png", "enorme.png"]);
  assert.equal(urls.revoked.length, 0, "rien n'est révoqué tant que le cache n'est pas vidé");
  kindSelect.value = "*"; kindSelect.onchange();
  search.value = "NOTÉS"; search.oninput();
  assert.deepEqual(labels(list), ["notes.txt"]);
  search.value = "introuvable"; search.oninput();
  assert.equal(list.childElementCount, 0);
  assert.equal(status.textContent, "Aucun fichier ne correspond.");
  search.value = ""; search.oninput();
  assert.equal(list.childElementCount, 5);
  assert.equal(fetched.length, 2, "revenir sur la liste ne relance aucune requête");
  const restored = thumbOf("photo.png");
  assert.equal(restored.children[0].tag, "span", "la nouvelle ligne repart d'une icône, l'image est redemandée à la visibilité");
  observer.show(restored); await tick();
  assert.equal(fetched.length, 2, "image servie par le cache de vignettes");
  assert.equal(restored.children[0].src, "blob:test/1");

  // Suppression d'un fichier : la ligne disparaît, la requête DELETE part une seule fois.
  await list.children[labels(list).indexOf("cours.pdf")].children[ROW.remove].onclick();
  assert.equal(list.childElementCount, 4);
  assert.equal(calls.filter(([, method]) => method === "DELETE").length, 1);

  // Fermeture : URL d'objet révoquées, observateur déconnecté, abonnement libéré.
  assert.equal(typeof dialog.listeners.close, "function");
  dialog.listeners.close();
  assert.deepEqual([...urls.revoked], ["blob:test/1"]);
  assert.equal(observer.disconnected, true);
  assert.equal(urls.created.length, 1);
}

async function testThumbnailsIgnoredWhenNothingRenders() {
  // Sans IntersectionObserver (ou sans module de vignettes), la liste fonctionne avec des icônes seules.
  for (const options of [{ withObserver: false }, { withThumbnails: false }]) {
    const calls = [];
    const { context, dialog } = setup({ settingsApi: thumbnailApi(FILES, calls), ...options });
    await context.openLibrary();
    dialog.children[1].onclick(); await tick();
    const list = dialog.children[2].children[PANEL.list];
    assert.equal(list.childElementCount, 5);
    assert.equal(list.children[0].children[ROW.thumb].children[0].tag, "span");
  }
}

async function testErrorsBecomeIcons() {
  const calls = [];
  const { context, dialog } = setup({
    settingsApi: thumbnailApi(FILES, calls),
    fetchBlob: async () => { throw Error("réseau coupé"); }
  });
  await context.openLibrary();
  dialog.children[1].onclick(); await tick();
  const list = dialog.children[2].children[PANEL.list];
  const observer = FakeObserver.instances[0];
  const thumb = list.children[labels(list).indexOf("photo.png")].children[ROW.thumb];
  observer.show(thumb); await tick();
  assert.equal(thumb.children[0].tag, "span");
  assert.equal(thumb.attributes["data-state"], "error");
  assert.equal(thumb.children[0].textContent, "PNG");
}

(async () => {
  await testPaginationAndDelete();
  await testControlsAndThumbnails();
  await testThumbnailsIgnoredWhenNothingRenders();
  await testErrorsBecomeIcons();
})().then(() => console.log("Stockage : pagination, suppression, recherche/filtre/tri et vignettes vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
