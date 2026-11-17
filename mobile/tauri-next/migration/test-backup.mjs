import assert from "node:assert/strict";
import { exportBackup, inspectBackup, restoreBackup } from "./backup.mjs";

const password = "phrase de migration secrète";
const original = new File([new Uint8Array(180_000).map((_, i) => i % 251)], "notes.pdf", { type: "application/pdf", lastModified: 123456 });
const records = [
  { kind: "state", key: "state", value: { rawState: { theme: "dark" }, secureSession: "token-secret-ne-pas-divulguer" } },
  { kind: "conversation", key: "chat-1", value: { id: "chat-1", messages: [{ content: "😀".repeat(18_000) }] } },
  { kind: "file", key: "file-1", value: { id: "file-1", name: "notes.pdf", saved: true }, blob: original },
  { kind: "library", key: "library-1", value: { id: "library-1", previewId: "file-1" } }
];
const chunks = [];
const exported = await exportBackup({ password, records, sink: { async write(bytes) { chunks.push(bytes.slice()); } } });
assert.equal(exported.records, 4);
const file = new Blob(chunks, { type: "application/x-francestudent-backup" });
assert.ok(!(await file.text()).includes("token-secret-ne-pas-divulguer"));

function adapter(initial = new Map()) {
  const entries = initial;
  const compare = async (a, b) => JSON.stringify(a.value) === JSON.stringify(b.value)
    && (a.kind !== "file" || (a.blob.type === b.blob.type && a.blob.size === b.blob.size && Buffer.compare(Buffer.from(await a.blob.arrayBuffer()), Buffer.from(await b.blob.arrayBuffer())) === 0));
  return {
    entries,
    async inspect(item) { const old = entries.get(item.kind + ":" + item.key); return !old ? "missing" : await compare(old, item) ? "same" : "conflict"; },
    async insertIfMissing(item) { const old = entries.get(item.kind + ":" + item.key); if (!old) { entries.set(item.kind + ":" + item.key, item); return "inserted"; } return await compare(old, item) ? "same" : "conflict"; }
  };
}

const dest = adapter();
const inspected = await inspectBackup({ file, password, destination: dest });
assert.equal(inspected.records, 4);
assert.equal(dest.entries.size, 0, "inspection never writes");
assert.equal((await restoreBackup({ file, password, destination: dest })).restored, true);
const restoredFile = dest.entries.get("file:file-1").blob;
assert.equal(restoredFile.name, "notes.pdf");
assert.equal(restoredFile.type, "application/pdf");
assert.equal(restoredFile.lastModified, 123456);
assert.equal(restoredFile.size, original.size);
assert.equal(dest.entries.get("conversation:chat-1").value.messages[0].content, records[1].value.messages[0].content);
assert.equal((await restoreBackup({ file, password, destination: dest })).restored, true, "restore is idempotent");

const conflict = adapter(new Map([["conversation:chat-1", { ...records[1], value: { id: "chat-1", messages: [{ content: "données existantes" }] } }]]));
const conflictResult = await restoreBackup({ file, password, destination: conflict });
assert.equal(conflictResult.restored, false);
assert.deepEqual(conflictResult.conflicts, [{ kind: "conversation", key: "chat-1" }]);
assert.equal(conflict.entries.size, 1, "preflight conflict never partially writes");

let inspections = 0;
const noWrites = { async inspect() { inspections++; return "missing"; }, async insertIfMissing() { throw Error("must not write"); } };
await assert.rejects(inspectBackup({ file, password: "phrase incorrecte mais longue", destination: noWrites }), /incorrecte|endommagée/);
assert.equal(inspections, 0);
await assert.rejects(inspectBackup({ file: file.slice(0, file.size - 10), password, destination: noWrites }), /interrompue|incomplète/);
assert.equal(inspections, 0);

const tampered = await file.text();
const lines = tampered.split("\n");
const frame = JSON.parse(lines[1]);
frame.data = (frame.data[0] === "A" ? "B" : "A") + frame.data.slice(1);
lines[1] = JSON.stringify(frame);
await assert.rejects(inspectBackup({ file: new Blob([lines.join("\n")]), password, destination: noWrites }), /incorrecte|endommagée/);
assert.equal(inspections, 0);
console.log("Sauvegarde chiffrée : export, reprise, conflits et corruption vérifiés.");
