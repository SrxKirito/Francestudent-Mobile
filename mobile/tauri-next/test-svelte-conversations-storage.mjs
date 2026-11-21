// Tests du stockage des discussions (IndexedDB) sur un faux IndexedDB qui clone les valeurs comme le vrai (structured clone),
// et contre-épreuve avec l'ancien core.js : ce que le TypeScript écrit, l'ancienne interface le relit.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  DB_NAME,
  MSG_STORAGE_UNAVAILABLE,
  MSG_WRITE_FAILED,
  createConversationStorage
} from "./src/lib/services/conversation-storage.ts";
import { STORE_KEY } from "./src/lib/utils/state.ts";
import { fakeIndexedDB } from "./test-fake-indexeddb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
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

function fakeLocalStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    failWrites: false,
    getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      if (this.failWrites) throw new Error("localStorage plein");
      items.set(key, value);
    }
  };
}

function setup({ local = {}, idb } = {}) {
  const indexedDB = idb ?? fakeIndexedDB();
  const localStorage = fakeLocalStorage(local);
  const warnings = [];
  let clock = 1_000_000;
  const storage = createConversationStorage({ indexedDB, localStorage, now: () => clock, warn: message => warnings.push(message) });
  return { indexedDB, localStorage, warnings, storage, advance: ms => (clock += ms) };
}

const conv = (id, extra = {}) => ({ id, title: `Discussion ${id}`, messages: [{ role: "user", content: `salut ${id}` }], updatedAt: 1, ...extra });
const stored = (conversations, extra = {}) => JSON.stringify({ session: "secret", deviceId: "dev", theme: "dark", conversations, ...extra });

await test("première ouverture : base créée, discussions de localStorage copiées puis localStorage vidé", async () => {
  const { indexedDB, localStorage, storage } = setup({ local: { [STORE_KEY]: stored([conv("a"), conv("b")]) } });
  const loaded = await storage.load();
  assert.equal(loaded.persistent, true);
  assert.deepEqual(loaded.conversations.map(c => c.id), ["a", "b"]);
  assert.deepEqual(indexedDB.state.opens, [{ name: DB_NAME, version: 1 }]);
  assert.deepEqual(indexedDB.state.data.get("conversations").map(c => c.id), ["a", "b"]);
  const after = JSON.parse(localStorage.getItem(STORE_KEY));
  assert.deepEqual(after.conversations, []);
  assert.equal(after.session, undefined, "le jeton ne doit jamais rester dans localStorage");
  assert.equal(after.deviceId, "dev");
  assert.equal(after.theme, "dark");
});

await test("IndexedDB déjà rempli : il prime sur localStorage", async () => {
  const idb = fakeIndexedDB();
  const first = setup({ idb, local: { [STORE_KEY]: stored([conv("vieux")]) } });
  await first.storage.load();
  first.storage.save([conv("recent")]);
  await first.storage.flush();
  const second = setup({ idb, local: { [STORE_KEY]: stored([conv("copie-obsolete")]) } });
  const loaded = await second.storage.load();
  assert.deepEqual(loaded.conversations.map(c => c.id), ["recent"]);
  assert.deepEqual(JSON.parse(second.localStorage.getItem(STORE_KEY)).conversations, []);
});

await test("le repli écrit pendant une panne est réconcilié au retour d’IndexedDB", async () => {
  const { indexedDB, localStorage, storage } = setup();
  await storage.load();
  storage.save([conv("existante", { updatedAt: 2 })]);
  await storage.flush();
  storage.close();
  indexedDB.state.fail.open = true;
  const fallback = createConversationStorage({ indexedDB, localStorage, warn() {} });
  await fallback.load();
  fallback.save([conv("existante", { updatedAt: 3 }), conv("nouvelle")]);
  indexedDB.state.fail.open = false;
  const loaded = await storage.load();
  assert.deepEqual(loaded.conversations.map(row => [row.id, row.updatedAt]), [["existante", 3], ["nouvelle", 1]]);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORE_KEY)).conversations, []);
});

await test("aucune discussion nulle part : liste vide, base initialisée avec []", async () => {
  const { indexedDB, storage } = setup();
  const loaded = await storage.load();
  assert.deepEqual(loaded, { conversations: [], persistent: true });
  assert.deepEqual(indexedDB.state.data.get("conversations"), []);
});

await test("ouverture refusée : discussions et localStorage conservés tels quels, un seul avertissement", async () => {
  const idb = fakeIndexedDB();
  idb.state.fail.open = true;
  const raw = stored([conv("a")]);
  const { localStorage, warnings, storage, advance } = setup({ idb, local: { [STORE_KEY]: raw } });
  const loaded = await storage.load();
  assert.equal(loaded.persistent, false);
  assert.deepEqual(loaded.conversations.map(c => c.id), ["a"]);
  assert.equal(localStorage.getItem(STORE_KEY), raw, "localStorage ne doit pas être modifié");
  assert.deepEqual(warnings, [MSG_STORAGE_UNAVAILABLE]);
  await storage.load();
  assert.equal(warnings.length, 1, "avertissement limité à un toutes les 30 s");
  advance(30_001);
  await storage.load();
  assert.equal(warnings.length, 2);
});

await test("copie vers IndexedDB refusée : localStorage garde les discussions (aucune perte)", async () => {
  const idb = fakeIndexedDB();
  idb.state.fail.put = 1;
  const raw = stored([conv("a")]);
  const { localStorage, storage, warnings } = setup({ idb, local: { [STORE_KEY]: raw } });
  const loaded = await storage.load();
  assert.equal(loaded.persistent, false);
  assert.deepEqual(loaded.conversations.map(c => c.id), ["a"]);
  assert.equal(localStorage.getItem(STORE_KEY), raw);
  assert.equal(idb.state.closed, 1, "la base ouverte doit être fermée");
  assert.equal(warnings.length, 1);
});

await test("lecture refusée : repli sur localStorage et base fermée", async () => {
  const idb = fakeIndexedDB();
  idb.state.fail.get = true;
  const { storage } = setup({ idb, local: { [STORE_KEY]: stored([conv("a")]) } });
  const loaded = await storage.load();
  assert.equal(loaded.persistent, false);
  assert.equal(idb.state.closed, 1);
});

await test("IndexedDB absent : repli sur localStorage", async () => {
  const localStorage = fakeLocalStorage({ [STORE_KEY]: stored([conv("a")]) });
  const warnings = [];
  const storage = createConversationStorage({ indexedDB: undefined, localStorage, warn: m => warnings.push(m) });
  const loaded = await storage.load();
  assert.equal(loaded.persistent, false);
  assert.deepEqual(loaded.conversations.map(c => c.id), ["a"]);
  assert.equal(warnings.length, 1);
});

await test("repli : save() écrit les discussions dans localStorage, sans jeton, réglages conservés", async () => {
  const idb = fakeIndexedDB();
  idb.state.fail.open = true;
  const { localStorage, storage } = setup({ idb, local: { [STORE_KEY]: stored([conv("a")]) } });
  await storage.load();
  storage.save([conv("a"), conv("b")]);
  const after = JSON.parse(localStorage.getItem(STORE_KEY));
  assert.deepEqual(after.conversations.map(c => c.id), ["a", "b"]);
  assert.equal(after.session, undefined);
  assert.equal(after.theme, "dark");
});

await test("repli : localStorage plein = avertissement, pas d'exception", async () => {
  const idb = fakeIndexedDB();
  idb.state.fail.open = true;
  const { localStorage, storage, warnings, advance } = setup({ idb });
  await storage.load();
  advance(60_000);
  localStorage.failWrites = true;
  storage.save([conv("a")]);
  assert.equal(warnings.length, 2);
});

await test("nettoyage de localStorage impossible : les discussions restent servies depuis IndexedDB", async () => {
  const { localStorage, indexedDB, storage } = setup({ local: { [STORE_KEY]: stored([conv("a")]) } });
  localStorage.failWrites = true;
  const loaded = await storage.load();
  assert.equal(loaded.persistent, true);
  assert.deepEqual(indexedDB.state.data.get("conversations").map(c => c.id), ["a"]);
});

await test("save() : l'instantané est pris tout de suite, une modification ultérieure n'est pas enregistrée", async () => {
  const { indexedDB, storage } = setup();
  await storage.load();
  indexedDB.state.delay = 5;
  const list = [conv("a")];
  storage.save(list);
  list[0].title = "modifié après coup";
  list.push(conv("intrus"));
  await storage.flush();
  const written = indexedDB.state.data.get("conversations");
  assert.equal(written.length, 1);
  assert.equal(written[0].title, "Discussion a");
});

await test("écritures rafales : sérialisées, la dernière gagne, états intermédiaires fusionnés", async () => {
  const { indexedDB, storage } = setup();
  await storage.load();
  indexedDB.state.log.length = 0;
  indexedDB.state.delay = 5;
  storage.save([conv("1")]);
  storage.save([conv("1"), conv("2")]);
  storage.save([conv("1"), conv("2"), conv("3")]);
  await storage.flush();
  const puts = indexedDB.state.log.filter(entry => entry.op === "put");
  assert.equal(puts.length, 2, "première écriture + dernier état seulement");
  assert.deepEqual(puts[0].value.map(c => c.id), ["1"]);
  assert.deepEqual(indexedDB.state.data.get("conversations").map(c => c.id), ["1", "2", "3"]);
});

await test("échec d'écriture : avertissement, puis les enregistrements suivants fonctionnent", async () => {
  const { indexedDB, storage, warnings, advance } = setup();
  await storage.load();
  indexedDB.state.fail.put = 1;
  storage.save([conv("perdu")]);
  await storage.flush();
  assert.deepEqual(warnings, [MSG_WRITE_FAILED]);
  advance(31_000);
  storage.save([conv("ok")]);
  await storage.flush();
  assert.deepEqual(indexedDB.state.data.get("conversations").map(c => c.id), ["ok"]);
  assert.equal(warnings.length, 1);
});

await test("flush() sans écriture en cours se résout immédiatement ; close() ferme la base", async () => {
  const { indexedDB, storage } = setup();
  await storage.load();
  await storage.flush();
  storage.close();
  assert.equal(indexedDB.state.closed, 1);
});

await test("contre-épreuve : l'ancien core.js relit ce que le TypeScript a écrit (même base, même clé)", async () => {
  const { indexedDB, storage } = setup({ local: { [STORE_KEY]: stored([conv("a")]) } });
  await storage.load();
  storage.save([conv("a"), conv("ecrit-par-ts", { pinned: true, chatId: "srv-1" })]);
  await storage.flush();

  const local = fakeLocalStorage();
  const context = vm.createContext({
    window: { crypto: { randomUUID: () => "device" } },
    crypto: { randomUUID: () => "device" },
    document: { getElementById: () => null },
    indexedDB,
    localStorage: local,
    console, Date, JSON, Promise, queueMicrotask
  });
  vm.runInContext(fs.readFileSync(path.join(here, "public/legacy/js/core.js"), "utf8"), context);
  await vm.runInContext("initializeConversationStorage()", context);
  const ids = vm.runInContext("store.conversations.map(c => c.id)", context);
  assert.deepEqual([...ids], ["a", "ecrit-par-ts"]);
  assert.equal(vm.runInContext("store.conversations[1].chatId", context), "srv-1");
});

console.log(`Stockage des discussions (TypeScript) : ${count} vérifications réussies.`);
