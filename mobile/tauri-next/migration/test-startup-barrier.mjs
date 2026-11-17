import assert from "node:assert/strict";
import { capacitorRecords } from "./source.mjs";
import { exportBackup } from "./backup.mjs";
import { createStartupImportBarrier } from "./startup-import-barrier.mjs";
import { createTauriImportHost } from "./tauri-import-host.mjs";

globalThis.IDBKeyRange = { lowerBound: key => ({ after: key }) };
function database(initial, events) {
  const stores = Object.fromEntries(Object.entries(initial).map(([name, values]) => [name, new Map(values)]));
  return {
    stores, objectStoreNames: { contains: name => name in stores },
    transaction(name) {
      const map = stores[name];
      const tx = { objectStore() { return {
 get(key) { const request = {}; queueMicrotask(() => { request.result = map.get(key); request.onsuccess?.(); tx.oncomplete?.(); }); return request; },
        put(value, key) { events?.push("db-write"); map.set(key ?? value.id, value); },
        openCursor(range) { const request = {}; queueMicrotask(() => { const key = [...map.keys()].sort().find(k => !range || k > range.after); request.result = key === undefined ? null : { key, value: map.get(key) }; request.onsuccess?.(); tx.oncomplete?.(); }); return request; }
      }; }, abort() { tx.onabort?.(); } };
      return tx;
    }
  };
}

const PASSWORD = "une phrase longue pour sauvegarde";
const chat = { id: "chat-1", messages: [{ role: "user", content: "message hors ligne" }] };
const rawState = JSON.stringify({ session: "ancienne-session", theme: "dark", conversations: [chat] });
const chunks = [];
await exportBackup({ password: PASSWORD, records: capacitorRecords({ rawState, conversations: [chat], previewDb: database({ files: [], library: [] }) }), sink: { async write(chunk) { chunks.push(chunk.slice()); } } });
const archive = new Blob(chunks);

function harness({ conversations = [], failVault = false, failMark = false } = {}) {
  const events = [];
  let stored = null;
  let secret = null;
  const conversationDb = database({ state: conversations }, events);
  const previewDb = database({ files: [], library: [] }, events);
  const storage = { getItem: () => stored, setItem: (_, value) => { events.push("storage-write"); stored = value; } };
  const vault = {
    async read() { return secret; },
    async write(value) { events.push("vault-write"); if (failVault) throw new Error("coffre indisponible"); secret = value; }
  };
  const acquire = createStartupImportBarrier({
    async assertMigrationStartup() {},
    async nativeLease() {
      events.push("lease");
      return {
        async assertValid() {},
        async markWritesPossible() { events.push("mark"); if (failMark) throw new Error("marqueur natif refusé"); },
        async release() { events.push("release"); }
      };
    },
    async openDestination() { return { storage, conversationDb, previewDb, vault, async close() { events.push("close"); } }; },
    async restart() { events.push("restart"); }
  });
  return { events, host: createTauriImportHost({ acquireImportBarrier: acquire }), state: () => ({ stored, secret, conversationDb }) };
}

// 1. Vérification : aucune écriture, aucune demande de redémarrage, verrou libéré.
{
  const { events, host, state } = harness();
  const result = await host.inspect(archive, PASSWORD);
  assert.deepEqual(result.conflicts, []);
  assert.ok(!events.includes("mark") && !events.includes("restart") && events.includes("release"));
  assert.equal(state().stored, null);
  // Le verrou est réutilisable après une simple vérification.
  await host.inspect(archive, PASSWORD);
}

// 2. Import : la notification native précède toute écriture, puis redémarrage exigé avec le rapport.
{
  const { events, host, state } = harness();
  const error = await host.restore(archive, PASSWORD).then(() => null, e => e);
  assert.ok(error?.restartRequired, "un redémarrage doit être exigé");
  assert.equal(error.result?.restored, true);
  assert.equal(error.operationError, undefined);
  const mark = events.indexOf("mark");
  const firstWrite = events.findIndex(e => e.endsWith("-write"));
  assert.ok(mark >= 0 && firstWrite > mark, `mark (${mark}) doit précéder la première écriture (${firstWrite})`);
  assert.ok(events.indexOf("close") < events.indexOf("restart"));
  assert.ok(!events.includes("release"), "le verrou natif est conservé jusqu'au redémarrage");
  assert.equal(state().secret, "ancienne-session");
  assert.equal(state().conversationDb.stores.state.get("conversations")[0].id, "chat-1");
  // Plus aucune opération tant que le processus n'a pas redémarré.
  await assert.rejects(host.inspect(archive, PASSWORD), /redémarrage/i);
}

// 3. Conflit : aucune écriture, aucune notification d'écriture, verrou libéré.
{
  const { events, host, state } = harness({ conversations: [["conversations", [{ ...chat, messages: [{ content: "autre" }] }]]] });
  const result = await host.restore(archive, PASSWORD);
  assert.equal(result.restored, false);
  assert.ok(!events.includes("mark") && !events.includes("restart") && events.includes("release"));
  assert.equal(state().stored, null);
}

// 4. Notification native refusée : aucune écriture n'a lieu, mais on exige quand même un redémarrage (fail-closed).
{
  const { events, host, state } = harness({ failMark: true });
  const error = await host.restore(archive, PASSWORD).then(() => null, e => e);
  assert.ok(error?.restartRequired);
  assert.match(error.operationError?.message, /marqueur natif refusé/);
  assert.ok(!events.some(e => e.endsWith("-write")));
  assert.equal(state().stored, null);
}

// 5. Échec en cours d'import : l'erreur d'origine est conservée et le redémarrage reste exigé.
{
  const { host } = harness({ failVault: true });
  const error = await host.restore(archive, PASSWORD).then(() => null, e => e);
  assert.ok(error?.restartRequired);
  assert.match(error.operationError?.message, /coffre indisponible/);
  assert.equal(error.result, undefined);
}

console.log("Barrière d'import : notification avant écriture, conflits, échec partiel et redémarrage vérifiés.");
