"use strict";
const assert = require("node:assert/strict");

async function main() {
  const { saveWithDialog, saveResponseWithDialog } = await import("./src/save-file.js");
  const output = [];
  let closed = false;
  const destination = await saveWithDialog(async options => { assert.equal(options.defaultPath, "test.txt"); return "chosen"; }, async (path, options) => {
    assert.equal(path, "chosen"); assert.equal(options.truncate, true);
    return { async write(chunk) { const n = Math.min(2, chunk.length); output.push(...chunk.slice(0, n)); return n; }, async close() { closed = true; } };
  }, "folder/test.txt", new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(destination, "chosen");
  assert.deepEqual(output, [1, 2, 3, 4, 5]);
  assert.equal(closed, true);
  const streamed = [];
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); } }));
  await saveResponseWithDialog(async () => "chosen", async () => ({ async write(data) { streamed.push(...data); return data.length; }, async close() {} }), "archive.json", response);
  assert.deepEqual(streamed, [1, 2, 3, 4]);
  let cancelled = false;
  const unfinished = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(saveResponseWithDialog(async () => null, async () => { throw Error("ne doit pas ouvrir"); }, "archive.json", unfinished), /annulé/);
  assert.equal(cancelled, true);
  await assert.rejects(saveWithDialog(async () => null, async () => { throw Error("ne doit pas ouvrir"); }, "x", new Uint8Array()), /annulé/);
  closed = false;
  await assert.rejects(saveWithDialog(async () => "chosen", async () => ({ async write() { return 0; }, async close() { closed = true; } }), "x", new Uint8Array([1])), /interrompue/);
  assert.equal(closed, true);
}
main().then(() => console.log("Enregistrement : blocs et annulation vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
