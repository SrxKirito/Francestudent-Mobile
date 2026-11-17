import assert from "node:assert/strict";
import { installExportGuard, acquireWebLock } from "./export-guard.mjs";
import { createIosTemporaryFactory } from "./ios-sink.mjs";
class Database {
  constructor(name) { this.name = name; }
  transaction() { const listeners = {}; return { addEventListener(name, callback) { listeners[name] = callback; }, finish() { listeners.complete(); } }; }
}
class Storage { setItem(k, v) { this[k] = v; } removeItem(k) { delete this[k]; } clear() {} }
const memory = { conversations: ["avant"] }, storage = new Storage();
let globalLocks = 0;
const acquire = installExportGuard({ IDBDatabase: Database, Storage, acquireGlobal: async () => { globalLocks++; return async () => { globalLocks--; }; }, capture: () => JSON.stringify({ memory, local: storage["fs-chat-state"] }) });
const db = new Database("francestudent-previews"), tx = db.transaction("files", "readwrite");
let acquired = false; const pending = acquire().then(release => { acquired = true; return release; });
await Promise.resolve(); assert.equal(acquired, false); tx.finish(); const release = await pending;
assert.throws(() => db.transaction("files", "readwrite"), /suspendue/);
assert.throws(() => new Storage().setItem("fs-chat-state", "x"), /suspendue/);
await assert.rejects(release.assertValid(), /modification/); await release();
storage.setItem("fs-chat-state", "ok");
const second = await acquire(); memory.conversations.push("modifiée");
await assert.rejects(second.assertValid(), /modification/); await second();
const third = await acquire(); storage["fs-chat-state"] = "écriture directe";
await assert.rejects(third.assertValid(), /modification/); await third();
assert.equal(globalLocks, 0);
await assert.rejects(acquireWebLock(null), /indisponible/);
let endFirst; let queue = Promise.resolve();
const locks = { request(_name, _options, fn) { const request = queue.then(fn); queue = request; return request; } };
const firstLock = await acquireWebLock(locks);
let gotSecond = false;
const nextLock = acquireWebLock(locks).then(release => { gotSecond = true; endFirst = release; });
await Promise.resolve(); assert.equal(gotSecond, false);
await firstLock(); await nextLock; assert.equal(gotSecond, true); await endFirst();
const blocks = []; let completed = false;
const open = createIosTemporaryFactory({ async begin() { return { id: "test" }; }, async append({ data }) { blocks.push(Buffer.from(data, "base64")); }, async commit() { completed = true; return { name: "backup.fsbackup" }; }, async abort() {} });
const target = await open(); await target.sink.write(new Uint8Array(120_000).fill(7));
assert.deepEqual(blocks.map(block => block.length), [49152, 49152, 21696]);
assert.equal((await target.commit()).name, "backup.fsbackup"); assert.equal(completed, true);
await assert.rejects(target.sink.write(new Uint8Array([1])), /terminée/);
console.log("Export iOS : blocs bornés et invalidation du verrou vérifiés.");
