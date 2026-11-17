import assert from "node:assert/strict";
import { mountMigrationUI } from "./ui.mjs";
import { createMigrationHost } from "./host.mjs";

class Element {
  constructor() { this.children = []; this.value = ""; this.files = []; this.textContent = ""; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute() {}
  remove() { this.removed = true; }
}
const document = { createElement: () => new Element() };
const container = new Element();
let restored = 0;
const host = { async export() {}, async inspect() { return { records: 2, conflicts: [] }; }, async restore() { restored++; return { restored: false, conflicts: [{ key: "same" }] }; } };
const ui = mountMigrationUI({ document, container, host });
const [, , label, exportButton, fileLabel, inspectButton, restoreButton, status] = ui.section.children;
const password = label.children[0], file = fileLabel.children[0];
password.value = "court";
await exportButton.onclick();
assert.match(status.textContent, /12 caractères/);
file.files = [new Blob(["backup"])];
password.value = "une phrase longue";
await inspectButton.onclick();
assert.match(status.textContent, /2 élément/);
assert.equal(password.value, "");
password.value = "une phrase longue";
await restoreButton.onclick();
assert.equal(restored, 1);
assert.match(status.textContent, /Aucun écrasement/);
assert.equal(password.value, "");
ui.destroy(); assert.equal(ui.section.removed, true);

// Export seul (ancienne app) : ni fichier, ni vérification, ni import ; le nom du fichier est affiché.
const exportOnlyContainer = new Element();
let exportedWith = null;
const exportOnly = mountMigrationUI({
  document, container: exportOnlyContainer, allowImport: false,
  host: { async export(secret) { exportedWith = secret; return { name: "sauvegarde.fsbackup" }; } }
});
assert.equal(exportOnly.section.children.length, 5, "titre, aide, phrase, bouton d’export, état");
const [, , exportOnlyLabel, exportOnlyButton, exportOnlyStatus] = exportOnly.section.children;
assert.equal(exportOnlyButton.textContent, "Créer une sauvegarde");
exportOnlyLabel.children[0].value = "une phrase longue";
await exportOnlyButton.onclick();
assert.equal(exportedWith, "une phrase longue");
assert.match(exportOnlyStatus.textContent, /sauvegarde\.fsbackup/);
assert.match(exportOnlyStatus.textContent, /Fichiers/);
assert.equal(exportOnlyLabel.children[0].value, "");
assert.throws(() => createMigrationHost({}), /Verrou exclusif/);
console.log("Interface : validation, conflits et effacement du secret vérifiés.");
