// Pont du chat (svelte-chat-engine.js) : exécuté dans un contexte `vm` avec de FAUSSES fonctions et variables de l'ancienne
// interface (même portée globale que les vrais scripts). Vérifie l'inertie avant `attach`, l'instantané du chat (sans
// données lourdes), les actions, le crochet de lecture du flux et la redirection des toasts. Ce n'est pas un test du
// vrai moteur historique : verify-shell-browser.mjs l'exerce dans Chrome.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

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

const LEGACY = `
var calls = [];
var elements = { prompt: { value: "" } };
var dialogOpen = false;
var settingsOpen = false;
let store = { agentId: 7, webSearch: false, webSearchMode: "auto", imageMode: false, powerpointMode: false, studyMode: "", imageModel: "gpt-image-2", conversations: [], session: { token: "secret" } };
let currentId = null;
let busy = false;
let stopRequested = false;
let activeConversation = null;
let pendingFiles = [];
const document = {
  getElementById: id => elements[id] || null,
  querySelector: selector => (selector === "dialog[open]" && dialogOpen ? {} : null),
  body: { classList: { contains: name => name === "settings-open" && settingsOpen } }
};
function currentConversation() { return store.conversations.find(c => c.id === currentId) || null; }
function $(id) { return elements[id]; }
function renderMessages() { calls.push("renderMessages"); }
function updateSendButton() { calls.push("updateSendButton"); }
function renderAttachments() { calls.push("renderAttachments"); }
function renderToggles() { calls.push("renderToggles"); }
function renderModels() { calls.push("renderModels"); }
function saveStore() { calls.push("saveStore"); }
function resizePrompt() { calls.push("resizePrompt"); }
function stopGeneration() { calls.push("stopGeneration"); }
function showToast(text, isError) { calls.push(["showToast", text, isError === true]); }
function restoreFailedPrompt(conversation, index) { calls.push(["restoreFailedPrompt", index]); elements.prompt.value = "ancien message"; }
function editSentMessage(conversation, index) { calls.push(["editSentMessage", index]); elements.prompt.value = "message modifié"; }
function removeAttachment(id) { calls.push(["removeAttachment", id]); pendingFiles = pendingFiles.filter(file => file.id !== id); }
async function addFiles(list) { calls.push(["addFiles", Array.from(list).map(file => file.name)]); }
async function regenerate(index) { calls.push(["regenerate", index]); }
async function sendMessage() {
  calls.push("sendMessage");
  if (currentConversation()?.pendingResponse) return;
  if (busy) return;
  if (!elements.prompt.value.trim() && !pendingFiles.length) return;
  elements.prompt.value = "";
  pendingFiles = [];
}
function generatedImageKey(image) { return image.id ? image.chatId + "/" + image.messageId + "/" + image.id : image.url || ""; }
async function resolveGeneratedImage(image) { calls.push(["resolveGeneratedImage", image.id || image.url]); return "data:image/png;base64,AAAA"; }
async function downloadGeneratedImage(src) { calls.push(["downloadGeneratedImage", src]); }
async function previewAttachment(file) { calls.push(["previewAttachment", file.name]); }
function beginTauriUpload(entry) { calls.push(["beginTauriUpload", entry.id]); }
var observers = [];
class MutationObserver {
  constructor(callback) { this.callback = callback; this.connected = false; this.options = null; observers.push(this); }
  observe(target, options) { this.connected = true; this.options = options; }
  disconnect() { this.connected = false; }
}
async function settingsApi(path, init) { calls.push(["settingsApi", path, init.method, init.body]); return { isUpvoted: JSON.parse(init.body).isUpvoted }; }
`;

function load() {
  const context = vm.createContext({ console });
  context.window = context;
  vm.runInContext(LEGACY, context);
  const before = {};
  for (const name of ["renderMessages", "updateSendButton", "renderAttachments", "renderToggles", "renderModels", "saveStore", "showToast", "restoreFailedPrompt", "editSentMessage"]) before[name] = context[name];
  const source = fs.readFileSync(path.join(here, "svelte-chat-engine.js"), "utf8");
  vm.runInContext(source, context);
  // Les tableaux créés dans le contexte `vm` ont un autre prototype : on les ramène dans ce royaume pour deepStrictEqual.
  const run = code => {
    const out = vm.runInContext(code, context);
    return out && typeof out === "object" ? JSON.parse(JSON.stringify(out)) : out;
  };
  return { context, before, run, chat: context.__fsChat };
}

function conversation(extra = {}) {
  return { id: "c1", chatId: "chat-1", title: "Maths", agentId: 7, agentName: "GPT", agentProvider: "OpenAI", messages: [], ...extra };
}

function fakeHost(log = []) {
  return { log, changed: () => log.push("changed"), toast: (text, isError) => log.push(["toast", text, isError]) };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

await test("avant attach : rien n'est modifié, le crochet de flux n'existe pas", () => {
  const { context, before, chat } = load();
  assert.ok(chat, "window.__fsChat doit exister");
  for (const name of Object.keys(before)) assert.equal(context[name], before[name], name + " ne doit pas être remplacée");
  assert.equal(context.__fsStreamReader, undefined);
});

await test("instantané : messages sans données lourdes, sans jeton de session", () => {
  const { run, chat } = load();
  run(`store.conversations.push(${JSON.stringify(conversation({
    messages: [
      { role: "user", content: "Bonjour", prompt: "CONSIGNE LONGUE", attachments: [{ id: "f1", name: "cours.pdf", kind: "file", mime: "application/pdf", size: 10, data: "BASE64ENORME", previewId: "p" }] },
      { role: "assistant", content: "Salut", serverMessageId: "m1", feedback: "up", sources: [{ url: "https://a.fr/x", title: "A", host: "a.fr" }], images: [{ id: "i1", messageId: "m1", chatId: "chat-1" }, { data: "data:image/png;base64,GROS" }, { url: "https://cdn.fr/i.png" }] },
      { role: "error", content: "HTTP 500" }
    ]
  }))}); currentId = "c1";`);
  const json = chat.state();
  assert.equal(typeof json, "string");
  assert.doesNotMatch(json, /BASE64ENORME|GROS|secret|CONSIGNE LONGUE/);
  const state = JSON.parse(json);
  assert.equal(state.id, "c1");
  assert.equal(state.chatId, "chat-1");
  assert.equal(state.title, "Maths");
  assert.equal(state.busy, false);
  assert.equal(state.messages.length, 3);
  assert.deepEqual(state.messages[0], { index: 0, role: "user", content: "Bonjour", attachments: [{ name: "cours.pdf", kind: "file", mime: "application/pdf" }] });
  const answer = state.messages[1];
  assert.equal(answer.serverMessageId, "m1");
  assert.equal(answer.feedback, "up");
  assert.deepEqual(answer.sources, [{ url: "https://a.fr/x", title: "A", host: "a.fr" }]);
  assert.deepEqual(answer.images.map(image => image.index), [0, 1, 2]);
  assert.equal(answer.images[1].inline, true);
  assert.equal(answer.images[2].url, "https://cdn.fr/i.png");
  assert.equal(state.messages[2].role, "error");
});

await test("instantané : composeur, brouillon, surcouche de l'ancienne interface", () => {
  const { run, chat } = load();
  run(`pendingFiles = [{ id: "f1", name: "photo.jpg", kind: "image", mime: "image/jpeg", size: 5, data: "data:image/jpeg;base64,PHOTO" }, { id: "f2", name: "note.txt", kind: "text", data: "texte" }]; store.webSearch = true; store.studyMode = "quiz"; elements.prompt.value = "brouillon";`);
  let state = JSON.parse(chat.state());
  assert.equal(state.id, null);
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.composer.attachments, [{ id: "f1", name: "photo.jpg", kind: "image" }, { id: "f2", name: "note.txt", kind: "text" }]);
  assert.equal(state.composer.webSearch, true);
  assert.equal(state.composer.studyMode, "quiz");
  assert.equal(state.composer.agentId, 7);
  assert.equal(state.draft.text, "brouillon");
  assert.equal(state.legacyOverlay, false);
  run("dialogOpen = true");
  assert.equal(JSON.parse(chat.state()).legacyOverlay, true);
  run("dialogOpen = false; settingsOpen = true");
  assert.equal(JSON.parse(chat.state()).legacyOverlay, true);
  assert.doesNotMatch(chat.state(), /PHOTO/);
});

await test("pièces jointes en cours d'envoi : état et progression transmis sans données lourdes ; reprise seulement après un échec", () => {
  const { run, chat } = load();
  run(`pendingFiles = [
    { id: "a", name: "a.pdf", kind: "file", data: "LOURD", uploadState: "uploading", uploadProgress: 0.25 },
    { id: "b", name: "b.txt", kind: "file", uploadState: "error" },
    { id: "c", name: "c.png", kind: "image", uploadState: "done", uploadProgress: 1 },
    { id: "d", name: "d.txt", kind: "text" },
    { id: "e", name: "e.pdf", kind: "file", uploadState: "queued" }
  ];`);
  const attachments = JSON.parse(chat.state()).composer.attachments;
  assert.deepEqual(attachments, [
    { id: "a", name: "a.pdf", kind: "file", upload: "uploading", progress: 0.25 },
    { id: "b", name: "b.txt", kind: "file", upload: "error" },
    { id: "c", name: "c.png", kind: "image" },
    { id: "d", name: "d.txt", kind: "text" },
    { id: "e", name: "e.pdf", kind: "file", upload: "queued" }
  ]);
  assert.doesNotMatch(chat.state(), /LOURD/);
  chat.retryUpload("a");
  chat.retryUpload("c");
  chat.retryUpload("inconnu");
  assert.deepEqual(run("calls").filter(Array.isArray), [], "seul un échec peut être relancé");
  chat.retryUpload("b");
  assert.deepEqual(run("calls").filter(Array.isArray), [["beginTauriUpload", "b"]]);
});

await test("surcouche legacy : l'ouverture des réglages ou d'un dialogue notifie l'hôte (observation du DOM), detach arrête l'observation", async () => {
  const { run, chat } = load();
  const log = [];
  chat.attach(fakeHost(log));
  await tick();
  log.length = 0;
  assert.equal(run("observers.length"), 1, "un seul observateur");
  assert.equal(run("observers[0].connected"), true);
  assert.deepEqual(run("observers[0].options.attributeFilter"), ["class", "open"]);
  run("observers[0].callback()");
  await tick();
  assert.deepEqual(log, [], "aucun changement d'état : pas de notification");
  run("settingsOpen = true; observers[0].callback()");
  await tick();
  assert.deepEqual(log, ["changed"]);
  assert.equal(JSON.parse(chat.state()).legacyOverlay, true);
  run("observers[0].callback()");
  await tick();
  assert.deepEqual(log, ["changed"], "même état : pas de doublon");
  run("settingsOpen = false; dialogOpen = true; observers[0].callback()");
  await tick();
  assert.deepEqual(log, ["changed"], "réglages fermés mais dialogue ouvert : la surcouche reste masquée, rien à notifier");
  run("dialogOpen = false; observers[0].callback()");
  await tick();
  assert.deepEqual(log, ["changed", "changed"]);
  chat.detach();
  assert.equal(run("observers[0].connected"), false);
});

await test("réponse en attente (reprise) et génération en cours sont signalées", () => {
  const { run, chat } = load();
  run(`store.conversations.push(${JSON.stringify(conversation({ pendingResponse: { text: "q", output: "début" } }))}); currentId = "c1"; busy = true;`);
  const state = JSON.parse(chat.state());
  assert.equal(state.pending, true);
  assert.equal(state.busy, true);
});

await test("attach : notifications regroupées, detach restaure les fonctions d'origine", async () => {
  const { context, before, run, chat } = load();
  const host = fakeHost();
  chat.attach(host);
  await tick();
  assert.deepEqual(host.log, ["changed"], "une notification initiale");
  host.log.length = 0;
  context.renderMessages();
  context.updateSendButton();
  context.saveStore();
  await tick();
  assert.deepEqual(host.log, ["changed"], "trois appels = une seule notification");
  assert.ok(run("calls").includes("renderMessages"), "la fonction d'origine est toujours appelée");
  chat.detach();
  for (const name of ["renderMessages", "updateSendButton", "renderAttachments", "renderToggles", "renderModels", "saveStore", "showToast", "restoreFailedPrompt", "editSentMessage"]) {
    assert.equal(context[name], before[name], name + " doit être restaurée");
  }
  host.log.length = 0;
  context.renderMessages();
  await tick();
  assert.deepEqual(host.log, []);
});

await test("send : écrit le texte, lance l'envoi sans l'attendre, indique si le message a été pris", async () => {
  const { run, chat } = load();
  assert.equal(chat.send("Bonjour"), true);
  assert.deepEqual(run("calls"), ["sendMessage"]);
  assert.equal(run("elements.prompt.value"), "");
  assert.equal(chat.send("   "), false, "message vide");
  run("busy = true");
  assert.equal(chat.send("encore"), false, "génération en cours : refusé");
  run("busy = false; store.conversations.push(" + JSON.stringify(conversation({ pendingResponse: { text: "q" } })) + "); currentId = 'c1'");
  assert.equal(chat.send("encore"), false, "réponse en attente : refusé");
  run("currentId = null; pendingFiles = [{ id: 'f', name: 'a.pdf', kind: 'file' }]");
  assert.equal(chat.send(""), true, "pièce jointe seule : accepté");
});

await test("send : une erreur de l'envoi historique n'est pas une exception non rattrapée", async () => {
  const { context, chat } = load();
  context.sendMessage = async () => { throw new Error("boum"); };
  const messages = [];
  context.console = { error: (...args) => messages.push(args.join(" ")), log() {}, warn() {} };
  assert.doesNotThrow(() => chat.send("x"));
  await tick();
  assert.ok(messages.some(text => /boum/.test(text)));
});

await test("actions : arrêt, régénération, pièces jointes, modification, vote", async () => {
  const { run, chat } = load();
  run(`store.conversations.push(${JSON.stringify(conversation({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b", serverMessageId: "m9" }, { role: "error", content: "e" }] }))}); currentId = "c1";`);
  chat.stop();
  chat.regenerate(1);
  chat.removeAttachment("f1");
  chat.addFiles([{ name: "x.png" }, { name: "y.pdf" }]);
  chat.editSent(0);
  chat.editFailed(2);
  const calls = run("calls");
  assert.ok(calls.includes("stopGeneration"));
  assert.deepEqual(calls.filter(Array.isArray).map(call => call[0]), ["regenerate", "removeAttachment", "addFiles", "editSentMessage", "restoreFailedPrompt"]);
  await chat.vote(1, false);
  const vote = run("calls").find(call => call[0] === "settingsApi");
  assert.deepEqual(vote, ["settingsApi", "/messages/m9", "PATCH", '{"isUpvoted":false}']);
  assert.equal(run("store.conversations[0].messages[1].feedback"), "down");
  assert.ok(run("calls").includes("saveStore"));
  run("calls.length = 0");
  chat.removeAttachment("../x");
  assert.deepEqual(run("calls"), [["removeAttachment", "../x"]], "l'identifiant est transmis tel quel, sans interprétation");
});

await test("vote : refusé sans identifiant serveur (message explicatif), et vote inchangé ignoré", async () => {
  const { run, chat } = load();
  run(`store.conversations.push(${JSON.stringify(conversation({ messages: [{ role: "assistant", content: "b" }, { role: "assistant", content: "c", serverMessageId: "m2", feedback: "up" }] }))}); currentId = "c1";`);
  await chat.vote(0, true);
  assert.deepEqual(run("calls").filter(call => call[0] === "showToast")[0].slice(0, 2), ["showToast", "Vote indisponible : recharge cette conversation pour récupérer le message."]);
  run("calls.length = 0");
  await chat.vote(1, true);
  assert.deepEqual(run("calls"), [], "même vote : aucun appel serveur");
});

await test("options du composeur : règles de l'ancienne interface (image/étude coupent PowerPoint, recherche web verrouillée)", () => {
  const { run, chat } = load();
  run("store.powerpointMode = true");
  chat.setOption("imageMode", true);
  assert.equal(run("store.imageMode"), true);
  assert.equal(run("store.powerpointMode"), false);
  run("store.powerpointMode = true");
  chat.setOption("studyMode", "cartes");
  assert.equal(run("store.studyMode"), "cartes");
  assert.equal(run("store.powerpointMode"), false);
  chat.setOption("studyMode", "n'importe quoi");
  assert.equal(run("store.studyMode"), "cartes", "mode d'étude inconnu refusé");
  chat.setOption("studyMode", "");
  assert.equal(run("store.studyMode"), "");
  run('store.webSearchMode = "disabled"');
  chat.setOption("webSearch", true);
  assert.equal(run("store.webSearch"), false, "recherche web désactivée dans les réglages");
  chat.setOption("inconnue", true);
  assert.equal(run("store.inconnue"), undefined);
  assert.ok(run("calls").includes("saveStore") && run("calls").includes("renderToggles"));
});

await test("modèle : refuse un modèle inconnu ou indisponible, sinon enregistre et recharge la liste", () => {
  const { run, chat } = load();
  run("var agents = [{ id: 1, available: true }, { id: 2, available: false }]; function agentById(id) { return agents.find(a => a.id === id) || null; }");
  chat.setAgent(2);
  chat.setAgent(99);
  assert.equal(run("store.agentId"), 7);
  chat.setAgent(1);
  assert.equal(run("store.agentId"), 1);
  assert.ok(run("calls").includes("saveStore") && run("calls").includes("renderModels"));
});

await test("images et aperçus : passent par les fonctions historiques", async () => {
  const { run, chat } = load();
  run(`store.conversations.push(${JSON.stringify(conversation({ messages: [{ role: "assistant", content: "", images: [{ id: "i1", messageId: "m1", chatId: "chat-1" }] }] }))}); currentId = "c1"; pendingFiles = [{ id: "f1", name: "p.jpg", kind: "image", data: "data:image/jpeg;base64,ZZ" }];`);
  assert.equal(await chat.image(0, 0), "data:image/png;base64,AAAA");
  assert.equal(await chat.image(0, 5), null);
  assert.equal(await chat.image(9, 0), null);
  assert.equal(await chat.resolveImage(JSON.stringify({ id: "i2", messageId: "m", chatId: "c" })), "data:image/png;base64,AAAA");
  assert.equal(chat.attachmentPreview("f1"), "data:image/jpeg;base64,ZZ");
  assert.equal(chat.attachmentPreview("absent"), "");
  await chat.downloadImage("data:image/png;base64,AAAA");
  chat.preview(JSON.stringify({ name: "cours.pdf", kind: "file" }));
  assert.ok(run("calls").some(call => call[0] === "downloadGeneratedImage"));
  assert.ok(run("calls").some(call => call[0] === "previewAttachment" && call[1] === "cours.pdf"));
});

await test("brouillon : la modification d'un message envoyé incrémente le numéro de brouillon", async () => {
  const { run, chat } = load();
  chat.attach(fakeHost());
  run(`store.conversations.push(${JSON.stringify(conversation({ messages: [{ role: "user", content: "a" }] }))}); currentId = "c1";`);
  const first = JSON.parse(chat.state()).draft;
  chat.editSent(0);
  const second = JSON.parse(chat.state()).draft;
  assert.equal(second.text, "message modifié");
  assert.ok(second.seq > first.seq);
  chat.detach();
});

await test("crochet de lecture du flux : seulement si l'hôte le fournit, retiré au detach", async () => {
  const { context, chat } = load();
  chat.attach(fakeHost());
  assert.equal(context.__fsStreamReader, undefined, "pas de crochet sans readStream");
  chat.detach();
  const received = [];
  const host = { ...fakeHost(), readStream: async options => { received.push(options); return "texte"; } };
  chat.attach(host);
  assert.equal(typeof context.__fsStreamReader, "function");
  const result = await context.__fsStreamReader({ marque: 1 });
  assert.equal(result, "texte");
  assert.deepEqual(received, [{ marque: 1 }]);
  chat.detach();
  assert.equal(context.__fsStreamReader, undefined);
});

await test("toasts : envoyés à la coque, sauf si une fenêtre de l'ancienne interface est ouverte", async () => {
  const { context, run, chat } = load();
  const host = fakeHost();
  chat.attach(host);
  host.log.length = 0;
  context.showToast("Bonjour", false);
  context.showToast("Oups", true);
  assert.deepEqual(host.log.filter(entry => Array.isArray(entry)), [["toast", "Bonjour", false], ["toast", "Oups", true]]);
  assert.equal(run("calls.filter(call => Array.isArray(call) && call[0] === 'showToast').length"), 0, "l'ancien toast, invisible, n'est pas affiché");
  host.log.length = 0;
  run("dialogOpen = true");
  context.showToast("Dans la fenêtre", false);
  assert.deepEqual(host.log.filter(entry => Array.isArray(entry)), []);
  assert.equal(run("calls.filter(call => Array.isArray(call) && call[0] === 'showToast').length"), 1, "fenêtre ouverte : l'ancien toast reste");
  chat.detach();
});

// ---------- import de conversations (même contrat que conversation-import.js) ----------
const SHARE = "123e4567-e89b-42d3-a456-426614174000";
const CHAT_ID = "223e4567-e89b-42d3-a456-426614174111";
const IMPORT_LEGACY = `
var agents = [
  { id: 1, model: "gpt-a", available: true, provider: "OpenAI" },
  { id: 2, model: "gpt-b", available: false },
  { id: 3, model: "  ", available: true },
  { id: 4, model: "claude-x", available: true, provider: "Anthropic" }
];
function agentLabel(agent) { return "Modèle " + agent.id; }
var madeIds = 0;
function makeId() { madeIds += 1; return "local-" + madeIds; }
var synced = 0;
function syncConversationsFromServer() { synced += 1; return Promise.resolve(); }
function renderHistory() { calls.push("renderHistory"); }
var hiddenIds = [];
function lockedChatIsHidden(conversation) { return hiddenIds.includes(conversation.id); }
var apiReply = null;
var apiRequests = [];
async function apiFetch(path, init) {
  apiRequests.push({ path, method: init.method, body: init.body });
  return apiReply;
}
function reply(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }
`;

await test("import : modèles utilisables seulement (disponibles, modèle non vide), modèle courant", () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  run("store.agentId = 4");
  const info = JSON.parse(chat.importModels());
  assert.deepEqual(info.models, [
    { id: 1, label: "Modèle 1 · OpenAI", model: "gpt-a" },
    { id: 4, label: "Modèle 4 · Anthropic", model: "claude-x" }
  ]);
  assert.equal(info.currentId, 4);
});

await test("import : conversation déjà importée retrouvée, verrouillée masquée jamais révélée", () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  run(`store.conversations.push({ id: "x1", chatId: "${CHAT_ID}", importedFrom: { shareId: "${SHARE}", sourceConversationId: "zzz" } }, { id: "x2", serverArchived: true, importedFrom: { sourceConversationId: "aaaa" } });`);
  assert.deepEqual(JSON.parse(chat.importFindExisting(SHARE)), { id: "x1", serverArchived: false });
  assert.deepEqual(JSON.parse(chat.importFindExisting("aaaa")), { id: "x2", serverArchived: true });
  assert.equal(chat.importFindExisting("inconnu"), "null");
  run('hiddenIds = ["x1"]');
  assert.equal(chat.importFindExisting(SHARE), "null");
});

await test("import : POST unique {link, model}, conversation enregistrée, historique rafraîchi", async () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  run(`apiReply = reply(200, { chatId: "${CHAT_ID}", title: "  Titre importé  ", source: "openai", sourceConversationId: "${SHARE.toUpperCase()}", importedMessagesCount: 3 });`);
  const out = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://chatgpt.com/share/" + SHARE, shareId: SHARE, agentId: 4 })));
  assert.equal(out.ok, true);
  assert.equal(out.count, 3);
  const requests = run("apiRequests");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/conversation-imports/openai");
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[0].body), { link: "https://chatgpt.com/share/" + SHARE, model: "claude-x" });
  const saved = run("store.conversations[store.conversations.length - 1]");
  assert.equal(saved.chatId, CHAT_ID);
  assert.equal(saved.title, "Titre importé");
  assert.equal(saved.agentId, 4);
  assert.equal(saved.needsLoad, true);
  assert.equal(saved.importedFrom.shareId, SHARE);
  assert.equal(saved.importedFrom.sourceConversationId, SHARE);
  assert.equal(out.id, saved.id);
  assert.ok(run("calls").includes("saveStore"));
  assert.ok(run("calls").includes("renderHistory"));
});

await test("import : modèle inconnu → aucune requête ; erreur HTTP → statut et détail, rien d'enregistré, pas de nouvel essai", async () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  const unknown = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://x/share/" + SHARE, shareId: SHARE, agentId: 2 })));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.noModel, true);
  assert.equal(run("apiRequests.length"), 0);
  run('apiReply = reply(422, { detail: "  lien refusé  " });');
  const failed = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://x/share/" + SHARE, shareId: SHARE, agentId: 1 })));
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 422);
  assert.equal(failed.detail, "lien refusé");
  assert.equal(run("apiRequests.length"), 1);
  assert.equal(run("store.conversations.length"), 0);
});

await test("import : réponse inattendue → signalée, synchronisation de l'historique lancée", async () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  run('apiReply = reply(200, { chatId: "pas-un-uuid" });');
  const out = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://x/share/" + SHARE, shareId: SHARE, agentId: 1 })));
  assert.equal(out.ok, false);
  assert.equal(out.unexpected, true);
  assert.equal(run("synced"), 1);
  assert.equal(run("store.conversations.length"), 0);
});

await test("import : erreur réseau → message, session changée pendant l'import → abandon silencieux", async () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  run('apiFetch = async () => { throw new Error("réseau coupé"); };');
  const net = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://x/share/" + SHARE, shareId: SHARE, agentId: 1 })));
  assert.equal(net.ok, false);
  assert.equal(net.message, "réseau coupé");
  run(`apiFetch = async () => { store.session = { token: "autre" }; return reply(200, { chatId: "${CHAT_ID}" }); };`);
  const aborted = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://x/share/" + SHARE, shareId: SHARE, agentId: 1 })));
  assert.equal(aborted.ok, false);
  assert.equal(aborted.aborted, true);
  assert.equal(run("store.conversations.length"), 0);
});

await test("import : sans session → refus sans requête", async () => {
  const { run, chat } = load();
  run(IMPORT_LEGACY);
  run("store.session = null");
  const out = JSON.parse(await chat.importRun(JSON.stringify({ link: "https://x/share/" + SHARE, shareId: SHARE, agentId: 1 })));
  assert.equal(out.ok, false);
  assert.equal(out.noSession, true);
  assert.equal(run("apiRequests.length"), 0);
});

// ---------- conversations verrouillables (confidentialité des chats verrouillés) ----------
const LOCK_LEGACY = `
var hiddenIds = [];
var lockedOpen = false;
function lockedChatIsHidden(conversation) { return hiddenIds.includes(conversation.id); }
window.FranceStudentLockedChats = { state: () => ({ accessOpen: lockedOpen, hasPin: true, lockedIds: [], loaded: true }) };
store.conversations.push(
  { id: "a", chatId: "ca", title: "Visible", updatedAt: 5, pendingResponse: true, messages: [{ content: "secret" }] },
  { id: "b", chatId: "cb", title: "Cachée", updatedAt: 9 }
);
hiddenIds = ["b"];
`;

await test("verrouillées : accès fermé → seules les conversations visibles, aucune donnée de message", () => {
  const { run, chat } = load();
  run(LOCK_LEGACY);
  const list = JSON.parse(chat.lockableConversations());
  assert.deepEqual(list, [{ id: "a", chatId: "ca", title: "Visible", updatedAt: 5, pendingResponse: true }]);
  assert.ok(!JSON.stringify(list).includes("Cachée"), "le titre d'une conversation masquée ne sort jamais");
  assert.ok(!JSON.stringify(list).includes("secret"));
});

await test("verrouillées : accès ouvert → les conversations masquées deviennent visibles pour le panneau", () => {
  const { run, chat } = load();
  run(LOCK_LEGACY);
  run("lockedOpen = true");
  const list = JSON.parse(chat.lockableConversations());
  assert.deepEqual(list.map(item => item.id), ["a", "b"]);
});

await test("verrouillées : API absente → liste filtrée selon lockedChatIsHidden seul, sans exception", () => {
  const { run, chat } = load();
  run(LOCK_LEGACY);
  run("delete window.FranceStudentLockedChats");
  assert.deepEqual(JSON.parse(chat.lockableConversations()).map(item => item.id), ["a"]);
});

// ---------- partages d'une conversation (/chats/{id}/shares) ----------
const SHARES_LEGACY = `
var hiddenIds = [];
var shareCalls = [];
var shareReply = () => [];
function lockedChatIsHidden(conversation) { return hiddenIds.includes(conversation.id); }
store.profile = { id: 12, email: "Moi@Ecole.fr", secret: "nope" };
store.conversations.push({ id: "a", chatId: "chat a/1", title: "Visible" }, { id: "b", chatId: "cb", title: "Cachée" }, { id: "n", title: "Locale" });
hiddenIds = ["b"];
settingsApi = async (path, init) => { shareCalls.push({ path, init }); return shareReply(init); };
`;

await test("partages : cible = chatId + identité du profil, jamais de jeton ; locale, inconnue ou masquée → null", () => {
  const { run, chat } = load();
  run(SHARES_LEGACY);
  const target = JSON.parse(chat.sharesTarget("a"));
  assert.deepEqual(target, { chatId: "chat a/1", me: { id: 12, email: "Moi@Ecole.fr" } });
  assert.ok(!JSON.stringify(target).includes("secret"));
  assert.equal(chat.sharesTarget("n"), "null");
  assert.equal(chat.sharesTarget("inconnue"), "null");
  assert.equal(chat.sharesTarget("b"), "null");
});

await test("partages : GET sans options, chemin encodé, données renvoyées telles quelles", async () => {
  const { run, chat } = load();
  run(SHARES_LEGACY);
  run('shareReply = () => [{ userId: 12, userEmail: "moi@ecole.fr", owner: true, permission: "Write" }];');
  const out = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "a", method: "GET" })));
  assert.equal(out.ok, true);
  assert.equal(out.data[0].owner, true);
  const calls = run("shareCalls");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/chats/chat%20a%2F1/shares");
  assert.equal(calls[0].init, undefined);
});

await test("partages : POST/PATCH/DELETE transmettent méthode et corps tels quels, une seule requête chacun", async () => {
  const { run, chat } = load();
  run(SHARES_LEGACY);
  run("shareReply = () => null;");
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const body = { userEmail: "a@b.fr", permission: "View" };
    const out = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "a", method, body })));
    assert.equal(out.ok, true, method);
  }
  const calls = run("shareCalls");
  assert.deepEqual(calls.map(call => call.init.method), ["POST", "PATCH", "DELETE"]);
  assert.deepEqual(JSON.parse(calls[0].init.body), { userEmail: "a@b.fr", permission: "View" });
});

await test("partages : méthode inconnue, conversation non partageable ou sans session → aucune requête", async () => {
  const { run, chat } = load();
  run(SHARES_LEGACY);
  const bad = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "a", method: "PUT", body: {} })));
  assert.equal(bad.ok, false);
  const hidden = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "b", method: "GET" })));
  assert.equal(hidden.ok, false);
  assert.equal(hidden.notSynced, true);
  const invalid = JSON.parse(await chat.sharesCall("pas du json"));
  assert.equal(invalid.ok, false);
  run("store.session = null");
  const none = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "a", method: "GET" })));
  assert.equal(none.noSession, true);
  assert.equal(run("shareCalls.length"), 0);
});

await test("partages : erreur serveur → statut et message du serveur ; changement de session pendant l'appel → abandon", async () => {
  const { run, chat } = load();
  run(SHARES_LEGACY);
  run('shareReply = () => { const error = new Error("Accès refusé"); error.status = 403; throw error; };');
  const failed = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "a", method: "DELETE", body: { userId: 3 } })));
  assert.deepEqual(failed, { ok: false, status: 403, message: "Accès refusé" });
  run('shareReply = () => { store.session = { token: "autre" }; return []; };');
  const aborted = JSON.parse(await chat.sharesCall(JSON.stringify({ localId: "a", method: "GET" })));
  assert.equal(aborted.ok, false);
  assert.equal(aborted.aborted, true);
});

console.log(`test-svelte-chat-engine : ${count} tests réussis`);
