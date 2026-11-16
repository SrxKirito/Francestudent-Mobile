"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.hidden = false; this.attributes = {}; this.textContent = ""; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  after(...nodes) { this.parent.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  get childElementCount() { return this.children.length; }
  querySelector(selector) { return selector === "header" ? this.header : null; }
}

async function main() {
  const dialog = new Node("dialog"); dialog.header = new Node("header"); dialog.append(dialog.header);
  const calls = [];
  const context = vm.createContext({
    openLibrary: async () => {},
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
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-storage.js"), "utf8"), context);
  await context.openLibrary();
  const toggle = dialog.children[1], panel = dialog.children[2];
  toggle.onclick();
  await new Promise(resolve => setImmediate(resolve));
  const list = panel.children[2], more = panel.children[3];
  assert.equal(list.childElementCount, 1);
  assert.equal(more.hidden, false);
  more.onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(list.childElementCount, 2);
  assert.equal(more.hidden, true);
  await list.children[0].children[2].onclick();
  assert.equal(list.childElementCount, 1);
  assert.ok(calls.some(([path, method]) => path === "/filesv2/one" && method === "DELETE"));
}
main().then(() => console.log("Stockage : pagination et suppression confirmée vérifiées.")).catch(error => { console.error(error); process.exitCode = 1; });
