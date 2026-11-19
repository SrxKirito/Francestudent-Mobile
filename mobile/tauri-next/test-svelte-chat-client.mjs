// Test du client TypeScript du pont du chat (src/lib/services/chat-engine.ts) avec un FAUX pont d'iframe.
import assert from "node:assert/strict";
import { connectChatEngine, parseChatState, EMPTY_CHAT_STATE } from "./src/lib/services/chat-engine.ts";

let count = 0;
async function test(name, fn) {
  try { await fn(); count += 1; } catch (error) { console.error(`ÉCHEC : ${name}`); throw error; }
}

function rawBridge(overrides = {}) {
  const calls = [];
  const record = name => (...args) => { calls.push([name, ...args]); return undefined; };
  const raw = {
    calls,
    attach: record("attach"), detach: record("detach"),
    state: () => JSON.stringify({ ready: true, id: "c1", messages: [] }),
    send: text => { calls.push(["send", text]); return true; },
    stop: record("stop"), regenerate: record("regenerate"), removeAttachment: record("removeAttachment"),
    addFiles: record("addFiles"), editSent: record("editSent"), editFailed: record("editFailed"),
    vote: async (...args) => { calls.push(["vote", ...args]); },
    setOption: record("setOption"), setAgent: record("setAgent"),
    image: async (...args) => { calls.push(["image", ...args]); return "data:image/png;base64,AA"; },
    resolveImage: async json => { calls.push(["resolveImage", json]); return null; },
    attachmentPreview: id => (id === "f1" ? "data:image/png;base64,BB" : ""),
    downloadImage: async src => { calls.push(["downloadImage", src]); },
    preview: record("preview"),
    importModels: () => JSON.stringify({ models: [{ id: 1, label: "A", model: "a" }, { id: "x" }, null], currentId: 1 }),
    importFindExisting: shareId => (shareId === "known" ? JSON.stringify({ id: "x1", serverArchived: true }) : "null"),
    importRun: async json => { calls.push(["importRun", json]); return JSON.stringify({ ok: true, id: "c9", count: 4 }); },
    lockableConversations: () => JSON.stringify([{ id: "a", chatId: "ca", title: "T", updatedAt: 3, pendingResponse: true }, { id: "b" }, 7]),
    sharesTarget: id => (id === "a" ? JSON.stringify({ chatId: "ca", me: { id: 12, email: "m@e.fr" } }) : "null"),
    sharesCall: async json => { calls.push(["sharesCall", json]); return JSON.stringify({ ok: true, data: [{ userId: 1 }] }); },
    ...overrides
  };
  return raw;
}

await test("pont absent, incomplet ou inaccessible : null", () => {
  assert.equal(connectChatEngine(null), null);
  assert.equal(connectChatEngine({}), null);
  assert.equal(connectChatEngine({ __fsChat: { attach() {}, detach() {} } }), null, "méthodes manquantes");
  const locked = {};
  Object.defineProperty(locked, "__fsChat", { get() { throw new Error("autre origine"); } });
  assert.equal(connectChatEngine(locked), null);
});

await test("les actions sont transmises au pont, les objets passent en JSON", async () => {
  const raw = rawBridge();
  const chat = connectChatEngine({ __fsChat: raw });
  assert.ok(chat);
  assert.equal(chat.send("Salut"), true);
  chat.stop(); chat.regenerate(2); chat.removeAttachment("f1"); chat.editSent(0); chat.editFailed(3);
  chat.setOption("webSearch", true); chat.setAgent(5);
  await chat.vote(1, true);
  assert.equal(await chat.image(0, 1), "data:image/png;base64,AA");
  await chat.resolveImage({ id: "i", messageId: "m", chatId: "c" });
  chat.preview({ messageIndex: 0, attachmentIndex: 1 });
  await chat.downloadImage("data:x");
  assert.equal(chat.attachmentPreview("f1"), "data:image/png;base64,BB");
  assert.deepEqual(raw.calls.find(call => call[0] === "resolveImage"), ["resolveImage", '{"id":"i","messageId":"m","chatId":"c"}']);
  assert.deepEqual(raw.calls.find(call => call[0] === "preview"), ["preview", '{"messageIndex":0,"attachmentIndex":1}']);
  assert.deepEqual(raw.calls.find(call => call[0] === "setOption"), ["setOption", "webSearch", true]);
});

await test("addFiles transmet les fichiers sans les modifier", () => {
  const raw = rawBridge();
  const chat = connectChatEngine({ __fsChat: raw });
  const file = { name: "a.png" };
  chat.addFiles([file]);
  assert.equal(raw.calls.find(call => call[0] === "addFiles")[1][0], file);
});

await test("attach : l'hôte reçoit changed/toast/readStream tels quels", () => {
  const raw = rawBridge();
  const chat = connectChatEngine({ __fsChat: raw });
  const host = { changed() {}, toast() {} };
  chat.attach(host);
  assert.equal(raw.calls[0][1], host);
  chat.detach();
  assert.equal(raw.calls[1][0], "detach");
});

await test("pièces jointes en cours d'envoi : état et progression conservés, valeurs inconnues écartées ; retryUpload est facultatif", () => {
  const state = parseChatState(JSON.stringify({ composer: { attachments: [
    { id: "a", name: "a.pdf", kind: "file", upload: "uploading", progress: 0.5 },
    { id: "b", name: "b.png", kind: "image", upload: "queued" },
    { id: "c", name: "c.txt", kind: "file", upload: "error" },
    { id: "d", name: "d.txt", kind: "file", upload: "done", progress: 1 },
    { id: "e", name: "e.txt", kind: "file", upload: "bizarre", progress: "x" },
    { id: "f", name: "f.pdf", kind: "file", upload: "uploading", progress: 7 },
    { id: "g", name: "g.pdf", kind: "file", upload: "uploading" }
  ] } }));
  assert.deepEqual(state.composer.attachments, [
    { id: "a", name: "a.pdf", kind: "file", upload: "uploading", progress: 0.5 },
    { id: "b", name: "b.png", kind: "image", upload: "queued" },
    { id: "c", name: "c.txt", kind: "file", upload: "error" },
    { id: "d", name: "d.txt", kind: "file" },
    { id: "e", name: "e.txt", kind: "file" },
    { id: "f", name: "f.pdf", kind: "file", upload: "uploading", progress: 1 },
    { id: "g", name: "g.pdf", kind: "file", upload: "uploading", progress: 0 }
  ]);
  const raw = rawBridge({ retryUpload: id => { raw.calls.push(["retryUpload", id]); } });
  connectChatEngine({ __fsChat: raw }).retryUpload("c");
  assert.deepEqual(raw.calls.find(call => call[0] === "retryUpload"), ["retryUpload", "c"]);
  const older = connectChatEngine({ __fsChat: rawBridge() });
  assert.ok(older, "un pont sans retryUpload reste utilisable");
  assert.doesNotThrow(() => older.retryUpload("c"));
});

await test("parseChatState : valeurs par défaut sûres, types vérifiés, liens non http(s) écartés des sources", () => {
  const state = parseChatState(JSON.stringify({
    ready: true, id: "c1", chatId: "ch", title: "T", busy: true, pending: true, legacyOverlay: true,
    messages: [
      { index: 0, role: "user", content: "a", attachments: [{ name: "x.pdf", kind: "file", mime: "application/pdf" }] },
      { index: 1, role: "assistant", content: "b", serverMessageId: "m", feedback: "up",
        sources: [{ url: "https://a.fr", title: "A", host: "a.fr" }, { url: "javascript:alert(1)", title: "X", host: "x" }, { nope: 1 }],
        images: [{ index: 0, id: "i", messageId: "m", chatId: "c", inline: false }, { index: 1, inline: true }] },
      { index: 2, role: "bizarre", content: 5 },
      null
    ],
    composer: { agentId: 3, webSearch: true, studyMode: "quiz", attachments: [{ id: "f", name: "p.jpg", kind: "image" }, { id: 4 }] },
    draft: { seq: 2, text: "brouillon" }
  }));
  assert.equal(state.busy, true);
  assert.equal(state.pending, true);
  assert.equal(state.legacyOverlay, true);
  assert.equal(state.messages.length, 3, "le message nul est ignoré");
  assert.equal(state.messages[2].role, "assistant", "rôle inconnu : repli sûr");
  assert.equal(state.messages[2].content, "");
  assert.deepEqual(state.messages[1].sources, [{ url: "https://a.fr", title: "A", host: "a.fr" }]);
  assert.equal(state.messages[1].images.length, 2);
  assert.equal(state.messages[1].feedback, "up");
  assert.equal(state.messages[0].attachments[0].name, "x.pdf");
  assert.deepEqual(state.composer.attachments, [{ id: "f", name: "p.jpg", kind: "image" }]);
  assert.equal(state.composer.studyMode, "quiz");
  assert.equal(state.composer.imageMode, false);
  assert.equal(state.draft.text, "brouillon");
});

await test("parseChatState : JSON invalide ou de mauvaise forme = état vide, sans exception", () => {
  assert.deepEqual(parseChatState("pas du json"), EMPTY_CHAT_STATE);
  assert.deepEqual(parseChatState("[]"), EMPTY_CHAT_STATE);
  assert.equal(EMPTY_CHAT_STATE.ready, false);
});

await test("state() du client passe par parseChatState", () => {
  const chat = connectChatEngine({ __fsChat: rawBridge() });
  assert.equal(chat.state().id, "c1");
  const broken = connectChatEngine({ __fsChat: rawBridge({ state: () => "{" }) });
  assert.equal(broken.state().ready, false);
});

await test("import : modèles validés, conversation existante, exécution en JSON, réponse invalide = échec lisible", async () => {
  const raw = rawBridge();
  const chat = connectChatEngine({ __fsChat: raw });
  assert.deepEqual(chat.importApi.models(), { models: [{ id: 1, label: "A", model: "a" }], currentId: 1 });
  assert.deepEqual(chat.importApi.findExisting("known"), { id: "x1", serverArchived: true });
  assert.equal(chat.importApi.findExisting("autre"), null);
  const out = await chat.importApi.run({ link: "https://x/share/y", shareId: "y", agentId: 1 });
  assert.deepEqual(out, { ok: true, id: "c9", count: 4 });
  assert.deepEqual(raw.calls.find(call => call[0] === "importRun"), ["importRun", '{"link":"https://x/share/y","shareId":"y","agentId":1}']);
  const broken = connectChatEngine({ __fsChat: rawBridge({ importRun: async () => "pas du json", importModels: () => "{" }) });
  const failed = await broken.importApi.run({ link: "l", shareId: "s", agentId: 1 });
  assert.equal(failed.ok, false);
  assert.ok(failed.message && failed.message.length > 0);
  assert.deepEqual(broken.importApi.models(), { models: [], currentId: null });
});

await test("lockableConversations : entrées invalides écartées, champs typés", () => {
  const chat = connectChatEngine({ __fsChat: rawBridge() });
  assert.deepEqual(chat.lockableConversations(), [
    { id: "a", chatId: "ca", title: "T", updatedAt: 3, pendingResponse: true },
    { id: "b", chatId: undefined, title: "", updatedAt: 0, pendingResponse: false }
  ]);
  const broken = connectChatEngine({ __fsChat: rawBridge({ lockableConversations: () => "x" }) });
  assert.deepEqual(broken.lockableConversations(), []);
});

await test("partages : cible validée, appel transmis en JSON, réponse illisible ou exception = échec lisible", async () => {
  const raw = rawBridge();
  const chat = connectChatEngine({ __fsChat: raw });
  assert.deepEqual(chat.sharesApi.target("a"), { chatId: "ca", me: { id: 12, email: "m@e.fr" } });
  assert.equal(chat.sharesApi.target("zz"), null);
  const out = await chat.sharesApi.call({ localId: "a", method: "GET" });
  assert.deepEqual(out, { ok: true, data: [{ userId: 1 }] });
  assert.deepEqual(raw.calls.find(call => call[0] === "sharesCall"), ["sharesCall", '{"localId":"a","method":"GET"}']);
  const odd = connectChatEngine({ __fsChat: rawBridge({ sharesTarget: () => JSON.stringify({ chatId: "c", me: { id: "x", email: 4 } }) }) });
  assert.deepEqual(odd.sharesApi.target("a"), { chatId: "c", me: { id: null, email: "" } });
  const broken = connectChatEngine({ __fsChat: rawBridge({ sharesTarget: () => "{", sharesCall: async () => "pas du json" }) });
  assert.equal(broken.sharesApi.target("a"), null);
  const failed = await broken.sharesApi.call({ localId: "a", method: "GET" });
  assert.equal(failed.ok, false);
  assert.ok(failed.message && failed.message.length > 0);
  const thrown = connectChatEngine({ __fsChat: rawBridge({ sharesCall: async () => { throw new Error("boum"); } }) });
  assert.deepEqual(await thrown.sharesApi.call({ localId: "a", method: "GET" }), { ok: false, message: "boum" });
  const status = connectChatEngine({ __fsChat: rawBridge({ sharesCall: async () => JSON.stringify({ ok: false, status: 403, message: "Refusé", noSession: true }) }) });
  assert.deepEqual(await status.sharesApi.call({ localId: "a", method: "GET" }), { ok: false, status: 403, message: "Refusé", noSession: true });
});

console.log(`test-svelte-chat-client : ${count} tests réussis`);
