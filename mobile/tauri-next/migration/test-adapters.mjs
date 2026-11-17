import assert from "node:assert/strict";
import { capacitorRecords } from "./source.mjs";
import { createTauriDestination } from "./destination.mjs";
import { exportBackup, restoreBackup } from "./backup.mjs";

globalThis.IDBKeyRange = { lowerBound: key => ({ after: key }) };
function database(initial) {
  const stores = Object.fromEntries(Object.entries(initial).map(([name, values]) => [name, new Map(values)]));
  return {
    stores, objectStoreNames: { contains: name => name in stores },
    transaction(name) {
      const map = stores[name];
      const tx = { objectStore() { return {
        get(key) { const request = {}; queueMicrotask(() => { request.result = map.get(key); request.onsuccess?.(); tx.oncomplete?.(); }); return request; },
        put(value, key) { map.set(key ?? value.id, value); },
        openCursor(range) { const request = {}; queueMicrotask(() => { const key = [...map.keys()].sort().find(k => !range || k > range.after); request.result = key === undefined ? null : { key, value: map.get(key) }; request.onsuccess?.(); tx.oncomplete?.(); }); return request; }
      }; }, abort() { tx.onabort?.(); } };
      return tx;
    }
  };
}
function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_, next) => { value = next; }, current: () => value };
}

const photo = new File(["photo-payload"], "photo.png", { type: "image/png", lastModified: 123 });
const previewSource = database({ files: [["preview-1", { id: "preview-1", blob: photo, name: "photo.png", saved: true }]], library: [["item-1", { id: "item-1", name: "photo.png", previewId: "preview-1" }]] });
const chat = { id: "chat-1", messages: [{ role: "user", content: "message hors ligne" }] };
const rawState = JSON.stringify({ session: "ancienne-session", theme: "dark", conversations: [chat], specialPreference: 42 });
const encrypted = [];
await exportBackup({ password: "une phrase longue pour sauvegarde", records: capacitorRecords({ rawState, conversations: [chat], previewDb: previewSource }), sink: { async write(chunk) { encrypted.push(chunk.slice()); } } });
const archive = new Blob(encrypted);
const conversationDb = database({ state: [] });
const previewDb = database({ files: [], library: [] });
const local = storage();
let secret = null;
const vault = { async read() { return secret; }, async write(value) { secret = value; } };
const destination = createTauriDestination({ storage: local, conversationDb, previewDb, vault });
assert.equal((await restoreBackup({ file: archive, password: "une phrase longue pour sauvegarde", destination })).restored, true);
assert.equal(secret, "ancienne-session");
assert.equal(JSON.parse(local.current()).session, undefined);
assert.equal(JSON.parse(local.current()).conversations, undefined);
assert.equal(JSON.parse(local.current()).specialPreference, 42);
assert.deepEqual(conversationDb.stores.state.get("conversations"), [chat]);
assert.equal(await previewDb.stores.files.get("preview-1").blob.text(), "photo-payload");
assert.equal(previewDb.stores.files.get("preview-1").blob.name, "photo.png");
assert.equal(previewDb.stores.library.get("item-1").previewId, "preview-1");
assert.equal((await restoreBackup({ file: archive, password: "une phrase longue pour sauvegarde", destination })).restored, true);

const conflictDb = database({ state: [["conversations", [{ ...chat, messages: [{ content: "autre" }] }]]] });
const conflictPreviews = database({ files: [], library: [] });
const conflictStorage = storage();
const conflict = createTauriDestination({ storage: conflictStorage, conversationDb: conflictDb, previewDb: conflictPreviews, vault: { async read() { return null; }, async write() { throw Error("must not write"); } } });
const result = await restoreBackup({ file: archive, password: "une phrase longue pour sauvegarde", destination: conflict });
assert.equal(result.restored, false);
assert.equal(conflictStorage.current(), null);
assert.equal(conflictPreviews.stores.files.size, 0);
assert.equal(conflictDb.stores.state.get("conversations")[0].messages[0].content, "autre");

await assert.rejects(async () => {
  for await (const _ of capacitorRecords({ rawState: JSON.stringify({ conversations: [{ ...chat, messages: [] }] }), conversations: [chat], previewDb: previewSource })) { /* validate merge */ }
}, /versions différentes/);
console.log("Adaptateurs : conversations, aperçus, bibliothèque, coffre et conflits vérifiés.");
