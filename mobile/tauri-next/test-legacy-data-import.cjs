"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ""; this.disabled = false; this.textContent = ""; this.nodes = {}; }
  set innerHTML(html) {
    this.html = html;
    this.nodes = { "[data-status]": new Element("p"), "[data-schedule]": new Element("button") };
  }
  querySelector(selector) { return this.nodes[selector] || null; }
  prepend(node) { this.prepended = node; }
  append(node) { this.appended = node; }
}

async function run({ transport, confirm = true, withPanel = true }) {
  const section = new Element("section");
  const actions = new Element("div");
  const panel = new Element("div");
  panel.nodes[".settings-actions"] = actions;
  const confirms = [];
  const ctx = vm.createContext({
    document: { createElement: () => section, getElementById: id => (id === "panel-account" && withPanel ? panel : null) },
    window: { parent: { __franceStudentTransport: transport }, confirm: message => { confirms.push(message); return confirm; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "legacy-data-import.js"), "utf8"), ctx);
  return { section, actions, panel, confirms };
}

async function main() {
  // Hors Tauri (pas de transport) ou sans panneau : rien n'est ajouté.
  assert.equal((await run({ transport: undefined })).actions.prepended, undefined);
  assert.equal((await run({ transport: {} })).actions.prepended, undefined);
  assert.equal((await run({ transport: { scheduleMigration() {} }, withPanel: false })).actions.prepended, undefined);

  // Refus de la confirmation : rien n'est programmé.
  let scheduled = 0;
  let view = await run({ transport: { scheduleMigration: async () => { scheduled++; } }, confirm: false });
  assert.equal(view.actions.prepended, view.section);
  await view.section.querySelector("[data-schedule]").onclick();
  assert.equal(scheduled, 0);
  assert.equal(view.confirms.length, 1);
  assert.equal(view.section.querySelector("[data-schedule]").disabled, false);

  // Programmation acceptée : message de redémarrage, bouton désactivé.
  view = await run({ transport: { scheduleMigration: async () => { scheduled++; } } });
  await view.section.querySelector("[data-schedule]").onclick();
  assert.equal(scheduled, 1);
  assert.match(view.section.querySelector("[data-status]").textContent, /Ferme complètement/);
  assert.equal(view.section.querySelector("[data-schedule]").disabled, true);

  // Échec natif : message d'erreur, bouton réactivé.
  view = await run({ transport: { scheduleMigration: async () => { throw new Error("disque plein"); } } });
  await view.section.querySelector("[data-schedule]").onclick();
  assert.match(view.section.querySelector("[data-status]").textContent, /Import impossible : disque plein/);
  assert.equal(view.section.querySelector("[data-schedule]").disabled, false);

  console.log("Import des données de l’ancienne application : demande, refus et erreurs vérifiés.");
}
main().catch(error => { console.error(error); process.exit(1); });
