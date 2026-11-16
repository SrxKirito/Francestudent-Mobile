"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

async function main() {
  let durable;
  let local = JSON.stringify({ session: "session-a", deviceId: "device", conversations: [{ id: "offline", messages: [{ role: "user", content: "conservé" }] }] });
  const database = {
    close() {},
    transaction() {
      const tx = { objectStore() { return {
        get() { const request = { result: durable }; queueMicrotask(() => tx.oncomplete()); return request; },
        put(value) { const request = { result: "conversations" }; queueMicrotask(() => { durable = value; tx.oncomplete(); }); return request; }
      }; } };
      return tx;
    }
  };
  const context = vm.createContext({
    window: { crypto: { randomUUID: () => "device" } }, crypto: { randomUUID: () => "device" },
    document: { getElementById: () => null },
    indexedDB: { open() { const request = { result: database }; queueMicrotask(() => request.onsuccess()); return request; } },
    localStorage: { getItem: () => local, setItem(key, value) { local = value; } },
    console, Date, JSON, Promise, queueMicrotask
  });
  const source = fs.readFileSync(path.join(__dirname, "public/legacy/js/core.js"), "utf8");
  vm.runInContext(source, context);
  await vm.runInContext("initializeConversationStorage()", context);
  assert.equal(durable[0].messages[0].content, "conservé");
  assert.equal(JSON.parse(local).session, undefined);
  assert.equal(JSON.parse(local).conversations.length, 0);
  vm.runInContext('store.conversations.push({ id: "nouveau", messages: [] }); saveStore()', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(durable.length, 2);
  assert.equal(JSON.parse(local).session, undefined);
  assert.equal(JSON.parse(local).conversations.length, 0);
}
main().then(() => console.log("Discussions : écriture IndexedDB et retrait du secret vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
