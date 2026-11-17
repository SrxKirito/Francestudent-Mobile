import assert from "node:assert/strict";
import { capacitorRecords } from "./source.mjs";
import { exportBackup } from "./backup.mjs";
import { createMigrationPage } from "./migration-page.mjs";

globalThis.IDBKeyRange = { lowerBound: key => ({ after: key }) };

function database(name, version) {
  const stores = {};
  return {
    name, version, stores, closed: false,
    objectStoreNames: { contains: store => store in stores },
    createObjectStore(store, options) { stores[store] = new Map(); stores[store].options = options; },
    close() { this.closed = true; },
    transaction(store) {
      const map = stores[store];
      const tx = { objectStore() { return {
        get(key) { const request = {}; queueMicrotask(() => { request.result = map.get(key); request.onsuccess?.(); tx.oncomplete?.(); }); return request; },
 put(value, key) { map.set(key ?? value.id, value); },
 openCursor(range) { const request = {}; queueMicrotask(() => { const found = [...map.keys()].sort().find(k => !range || k > range.after); request.result = found === undefined ? null : { key: found, value: map.get(found) }; request.onsuccess?.(); tx.oncomplete?.(); }); return request; }
      }; }, abort() { tx.onabort?.(); } };
      return tx;
    }
  };
}
function fakeIndexedDB() {
  const databases = new Map();
  return {
    databases,
    open(name, version) {
      const request = {};
      queueMicrotask(() => {
 let db = databases.get(name);
        const fresh = !db;
        if (fresh) { db = database(name, version); databases.set(name, db); }
        request.result = db;
 if (fresh) request.onupgradeneeded?.();
 request.onsuccess?.();
      });
      return request;
    }
  };
}

class Element {
  constructor() { this.children = []; this.value = ""; this.files = []; this.textContent = ""; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute() {}
  remove() { this.removed = true; }
}
const document = { createElement: () => new Element() };

const PASSWORD = "une phrase longue pour sauvegarde";
const chat = { id: "chat-1", messages: [{ role: "user", content: "message hors ligne" }] };
const rawState = JSON.stringify({ session: "ancienne-session", theme: "dark", conversations: [chat] });
const source = database("source");
source.createObjectStore("files", { keyPath: "id" });
source.createObjectStore("library", { keyPath: "id" });
const chunks = [];
await exportBackup({ password: PASSWORD, records: capacitorRecords({ rawState, conversations: [chat], previewDb: source }), sink: { async write(chunk) { chunks.push(chunk.slice()); } } });
const archive = new Blob(chunks);

const calls = [];
let secret = null;
let cancelFails = false;
const invoke = async (command, args) => {
  calls.push(command);
  if (command === "session_read") return secret;
  if (command === "session_write") { secret = args.value; return; }
  if (command === "migration_cancel" && cancelFails) throw new Error("Redémarrage nécessaire");
};
const indexedDB = fakeIndexedDB();
let stored = null;
const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
const container = new Element();
const page = createMigrationPage({ document, container, invoke, indexedDB, storage });

// Page d'import seule : pas de bouton d'export.
const [, section, back] = container.children;
const [, , label, fileLabel, inspectButton, restoreButton, status] = section.children;
assert.equal(section.children.length, 7);
const password = label.children[0];
const file = fileLabel.children[0];
file.files = [archive];

// Vérification : aucune écriture natale ni locale.
password.value = PASSWORD;
await inspectButton.onclick();
assert.match(status.textContent, /élément\(s\) vérifié\(s\), sans conflit/);
assert.ok(!calls.includes("migration_mark_writes") && !calls.includes("migration_finish"));
assert.equal(stored, null);
assert.equal(indexedDB.databases.get("francestudent-conversations").version, 1);
assert.equal(indexedDB.databases.get("francestudent-previews").version, 2);
assert.deepEqual(Object.keys(indexedDB.databases.get("francestudent-previews").stores).sort(), ["files", "library"]);
assert.equal(indexedDB.databases.get("francestudent-previews").stores.files.options.keyPath, "id");
assert.ok(indexedDB.databases.get("francestudent-conversations").closed, "les bases sont refermées");

// Import : notification native avant la première écriture du coffre, puis fin et verrouillage de l'interface.
calls.length = 0;
password.value = PASSWORD;
await restoreButton.onclick();
assert.match(status.textContent, /Import terminé \(\d+ élément/);
assert.match(status.textContent, /Ferme complètement l’application/);
assert.ok(calls.indexOf("migration_mark_writes") >= 0 && calls.indexOf("migration_mark_writes") < calls.indexOf("session_write"));
assert.equal(calls.at(-1), "migration_finish");
assert.equal(secret, "ancienne-session");
assert.equal(indexedDB.databases.get("francestudent-conversations").stores.state.get("conversations")[0].id, "chat-1");
assert.ok(inspectButton.disabled && restoreButton.disabled, "interface verrouillée après import");
calls.length = 0;
password.value = PASSWORD;
await restoreButton.onclick();
assert.deepEqual(calls, [], "aucune nouvelle opération avant redémarrage");

// Retour à l'application : demandé au natif, qui le refuse après écriture.
cancelFails = true;
await back.onclick();
assert.ok(calls.includes("migration_cancel"));
assert.match(container.children[3].textContent, /Retour impossible/);
assert.equal(back.disabled, false);
cancelFails = false;
await back.onclick();
assert.equal(back.disabled, true);

assert.throws(() => createMigrationPage({ document, container, indexedDB, storage }), /indisponible/);
console.log("Page d'import : schémas locaux, ordre des écritures, verrouillage et retour vérifiés.");
