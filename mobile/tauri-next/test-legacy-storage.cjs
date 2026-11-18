"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.hidden = false; this.attributes = {}; this.textContent = ""; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  after(...nodes) { this.parent.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  get childElementCount() { return this.children.length; }
  querySelector(selector) { return selector === "header" ? this.header : null; }
}

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

async function main() {
  const dialog = new Node("dialog"); dialog.header = new Node("header"); dialog.append(dialog.header);
  const calls = [];
  const context = vm.createContext({
    openLibrary: async () => {},
    store: { session: "test-session" },
    document: { getElementById: () => dialog, createElement: tag => new Node(tag) },
    settingsApi: async (path, options) => {
      calls.push([path, options?.method || "GET"]);
      if (path === "/filesv2/usage") return { usedBytes: 10, maxBytes: 100 };
      if (path === "/filesv2?limit=30") return { data: [{ id: "one", filename: "a.pdf" }], has_more: true, last_id: "one" };
      if (path === "/filesv2?limit=30&after=one") return { data: [{ id: "two", filename: "b.pdf" }], has_more: false, last_id: "two" };
      if (path === "/filesv2/one" && options?.method === "DELETE") return { deleted: true };
      throw Error("Unexpected request: " + path);
    },
    previewAttachment() {}, confirm: () => true, Number, String, encodeURIComponent
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "files-store.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-storage.js"), "utf8"), context);
  await context.openLibrary();
  const toggle = dialog.children[1], panel = dialog.children[2];
  toggle.onclick();
  await tick();
  const list = panel.children[2], more = panel.children[3];
  assert.equal(list.childElementCount, 1);
  assert.equal(more.hidden, false);
  more.onclick();
  await tick();
  assert.equal(list.childElementCount, 2);
  assert.equal(more.hidden, true);
  await list.children[0].children[2].onclick();
  assert.equal(list.childElementCount, 1);
  assert.ok(calls.some(([path, method]) => path === "/filesv2/one" && method === "DELETE"));
  context.store.session = "other-session";
  await list.children[0].children[2].onclick();
  assert.equal(list.childElementCount, 1);
  assert.ok(!calls.some(([path, method]) => path === "/filesv2/two" && method === "DELETE"));
  assert.equal(panel.children[0].textContent, "Stockage utilisé : 0 Mo sur 0 Mo.");

  // Réouverture de la bibliothèque : le cache partagé évite de relire la liste.
  context.store.session = "test-session";
  const listCallsBefore = calls.filter(([path]) => path.startsWith("/filesv2?")).length;
  dialog.children.length = 1;
  await context.openLibrary();
  dialog.children[1].onclick(); await tick();
  assert.equal(calls.filter(([path]) => path.startsWith("/filesv2?")).length, listCallsBefore, "liste servie depuis le cache");
  assert.equal(dialog.children[2].children[2].childElementCount, 1);
}
main().then(() => console.log("Stockage : pagination et suppression confirmée vérifiées.")).catch(error => { console.error(error); process.exitCode = 1; });
