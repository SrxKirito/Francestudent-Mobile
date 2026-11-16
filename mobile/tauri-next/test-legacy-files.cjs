"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  let resolveUpload;
  let sent = 0;
  const notices = [];
  const context = vm.createContext({
    pendingFiles: [], busy: false,
    document: { querySelectorAll: () => [] },
    $: () => ({ disabled: false }),
    renderAttachments() {}, removeAttachment(id) { context.pendingFiles = context.pendingFiles.filter(file => file.id !== id); },
    previewAttachment() {}, previewBlob() {}, updateSendButton() {},
    async sendMessage() { sent++; context.pendingFiles = []; },
    makeId: () => "file-1", getAccessToken: async () => "test-token",
    showToast: value => notices.push(value),
    tauriTransport: { upload: () => new Promise(resolve => { resolveUpload = resolve; }) },
    URL, AbortController, Array, Date, Math, String
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  const remote = context.tauriMessageFiles({ usedFilesV2Ids: ["file-v2-1", "file-v2-1"], usedFileIds: ["legacy-1"] });
  assert.equal(remote.length, 2);
  const merged = context.tauriMergeMessageFiles(remote, [{ remoteId: "file-v2-1", remoteKind: "file", name: "note.txt" }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, "note.txt");
  assert.equal(context.tauriFindLocalMessage({ serverMessageId: "m2", content: "x" }, [{ serverMessageId: "m1", content: "x" }, { serverMessageId: "m2", content: "y" }], 0).content, "y");
  assert.equal(context.tauriFindLocalMessage({ serverMessageId: "m3", content: "autre" }, [{ content: "ancien" }], 0), null);
  const file = new File(["contenu"], "note.txt", { type: "text/plain" });
  await context.addFiles([file]);
  await Promise.resolve();
  assert.equal(context.pendingFiles.length, 1);
  assert.equal(context.pendingFiles[0].uploadState, "uploading");
  await context.sendMessage();
  assert.equal(sent, 0);
  assert.ok(notices.some(text => text.includes("fin des envois")));
  resolveUpload({ id: "file-v2-1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.pendingFiles[0].remoteId, "file-v2-1");
  assert.equal(context.pendingFiles[0].remoteKind, "file");
  assert.equal(context.pendingFiles[0].uploadState, "done");
  assert.equal(context.pendingFiles[0].data, "");
  await context.sendMessage();
  assert.equal(sent, 1);
}
main().then(() => console.log("Pièces jointes : transfert et blocage de l’envoi vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
