import assert from "node:assert/strict";
import { createCapacitorExporter } from "./capacitor-host.mjs";

let active = 0, resumed = 0, committed = 0;
const plugin = { async begin() { return { id: "test" }; }, async append() {}, async commit() { committed++; return { name: "test.fsbackup" }; }, async abort() {} };
const options = {
  plugin,
  async verifySingleWebView() { return true; },
  async suspend() { active++; return async () => { active--; resumed++; }; },
  async drain() { assert.equal(active, 1); },
  async acquireGuard() { const release = async () => {}; release.assertValid = async () => {}; return release; },
  readState: () => "{}",
  readConversations: () => [],
  async openPreviewDatabase() { return { objectStoreNames: { contains: () => false }, transaction() {} }; }
};
assert.throws(() => createCapacitorExporter({ plugin }), /Prérequis/);
assert.equal((await createCapacitorExporter(options)("une phrase longue de test")).name, "test.fsbackup");
assert.equal(committed, 1); assert.equal(active, 0); assert.equal(resumed, 1);
await assert.rejects(createCapacitorExporter({ ...options, verifySingleWebView: async () => false })("une phrase longue de test"), /WebView/);
assert.equal(committed, 1); assert.equal(active, 0);
await assert.rejects(createCapacitorExporter({ ...options, drain: async () => { throw Error("encore occupé"); } })("une phrase longue de test"), /encore occupé/);
assert.equal(active, 0); assert.equal(resumed, 2);
console.log("Hôte Capacitor : préconditions, suspension et reprise vérifiées.");
