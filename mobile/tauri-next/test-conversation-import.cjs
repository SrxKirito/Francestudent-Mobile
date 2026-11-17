"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const flush = async (count = 10) => { for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve)); };

function reply(status, data) {
  const text = data === undefined ? "" : JSON.stringify(data);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text || "null") };
}

// Minimal DOM: enough to run the real module (button, dialog, form, select).
class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {};
    this.value = ""; this.textContent = ""; this.className = ""; this.disabled = false; this.open = false;
    const classes = new Set();
    this.classList = { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) };
  }
  get options() { return this.children; }
  append(...nodes) {
    this.children.push(...nodes);
    if (this.tag === "select" && this.value === "" && this.children.length) this.value = this.children[0].value;
  }
  replaceChildren() { this.children = []; if (this.tag === "select") this.value = ""; }
  after(node) { this.sibling = node; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, event = {}) { const e = { preventDefault() { e.defaultPrevented = true; }, ...event }; for (const l of this.listeners[type] || []) l(e); return e; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/api-audit/openapi.json"), "utf8"));
  assert.ok(spec.paths["/conversation-imports/openai"]?.post, "Route absente de l'OpenAPI : POST /conversation-imports/openai");

  const shareId = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
  const shareLink = `https://chatgpt.com/share/${shareId}`;
  const importedChatId = "cccccccc-1111-2222-3333-dddddddddddd";

  const anchor = new Element("button");
  const logout = new Element("button");
  const body = new Element("body");
  const calls = [], toasts = [], opened = [];
  let syncCalls = 0, saveCalls = 0, renderCalls = 0, idSeq = 0;
  let handler = async () => reply(500);

  const ctx = vm.createContext({
    URL, JSON, Number, String, Array, Date,
    document: {
      readyState: "complete",
      body,
      createElement: tag => new Element(tag),
      getElementById: id => ({ "library-open": anchor, logout }[id] || null),
      addEventListener() {}
    },
    agents: [
      { id: 1, model: "gpt-a", available: true, provider: "OpenAI" },
      { id: 2, model: "gpt-b", available: false },
      { id: 3, model: "  ", available: true },
      { id: 4, model: "claude-x", available: true, provider: "Anthropic" }
    ],
    agentLabel: agent => "Modèle " + agent.id,
    store: { session: "session-1", agentId: 4, conversations: [] },
    makeId: () => "local-" + (++idSeq),
    busy: false,
    showToast: text => toasts.push(text),
    openConversation: async id => { opened.push(id); },
    apiFetch: async (route, options = {}) => { calls.push({ route, method: options.method, body: options.body ? JSON.parse(options.body) : undefined }); return handler(route, options); },
    saveStore: () => { saveCalls++; },
    renderHistory: () => { renderCalls++; },
    syncConversationsFromServer: async () => { syncCalls++; },
    closeSidebar() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "conversation-import.js"), "utf8"), ctx);

  const button = anchor.sibling;
  assert.ok(button, "le bouton d'import doit être ajouté après la bibliothèque");
  assert.equal(button.id, "conversation-import-open");
  const dialog = body.children[0];
  const form = dialog.children[0];
  const [, , linkLabel, modelLabel, status, actions] = form.children;
  const link = linkLabel.children[0], model = modelLabel.children[0];
  const [closeButton, submitButton] = actions.children;
  const submit = async value => { link.value = value; form.dispatch("submit"); await flush(); };
  const reset = () => { calls.length = 0; toasts.length = 0; opened.length = 0; };

  // Pas de session : le dialogue ne s'ouvre pas.
  ctx.store.session = null;
  button.dispatch("click");
  assert.equal(dialog.open, false);
  assert.equal(toasts.length, 1);
  ctx.store.session = "session-1";
  reset();

  // Ouverture : seuls les modèles disponibles avec un identifiant de modèle sont listés.
  button.dispatch("click");
  assert.equal(dialog.open, true);
  assert.equal(model.options.length, 2);
  assert.equal(model.value, "4", "le modèle courant est présélectionné");

  // Liens invalides : aucune requête.
  for (const bad of [
    "", "pas un lien", `http://chatgpt.com/share/${shareId}`, `https://chatgpt.com/c/${shareId}`,
    "https://chatgpt.com/share/pas-un-uuid", `https://user:secret@chatgpt.com/share/${shareId}`, `https://chatgpt.com/share/${shareId}/extra`
  ]) {
    await submit(bad);
    assert.equal(status.classList.contains("is-error"), true, `lien refusé : ${bad}`);
  }
  assert.equal(calls.length, 0, "un lien invalide ne doit pas atteindre le serveur");

  // Import réussi : un seul POST avec {link, model}, conversation locale créée puis ouverte.
  handler = async () => reply(200, { chatId: importedChatId, title: "Mon import", source: "openai", sourceConversationId: shareId, importedMessagesCount: 3 });
  await submit(`  ${shareLink}  `);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/conversation-imports/openai");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { link: shareLink, model: "claude-x" });
  assert.equal(ctx.store.conversations.length, 1);
  const imported = ctx.store.conversations[0];
  assert.equal(imported.chatId, importedChatId);
  assert.equal(imported.title, "Mon import");
  assert.equal(imported.needsLoad, true);
  assert.equal(imported.importedFrom.shareId, shareId);
  assert.deepEqual(opened, [imported.id]);
  assert.ok(toasts.some(text => text.includes("3 messages")));
  assert.equal(dialog.open, false, "le dialogue se ferme après l'import");
  assert.equal(link.value, "");
  assert.ok(saveCalls > 0 && renderCalls > 0);

  // Même lien : ouverture de l'existante, aucun nouveau POST.
  reset();
  button.dispatch("click");
  await submit(shareLink);
  assert.equal(calls.length, 0, "pas de doublon pour un lien déjà importé");
  assert.deepEqual(opened, [imported.id]);
  assert.equal(ctx.store.conversations.length, 1);

  // Existante archivée : message, pas de POST.
  reset();
  imported.serverArchived = true;
  button.dispatch("click");
  await submit(shareLink);
  assert.equal(calls.length, 0);
  assert.equal(status.classList.contains("is-error"), true);
  assert.match(status.textContent, /archiv/);
  assert.equal(dialog.open, true);
  delete imported.serverArchived;

  // Existante verrouillée et masquée : jamais réutilisée, nouvelle importation côté serveur.
  reset();
  ctx.lockedChatIsHidden = conversation => conversation.serverLocked === true;
  imported.serverLocked = true;
  handler = async () => reply(200, { chatId: "eeeeeeee-1111-2222-3333-ffffffffffff", title: "Autre", sourceConversationId: shareId });
  await submit(shareLink);
  assert.equal(calls.length, 1, "un chat verrouillé masqué n'est pas révélé ni réutilisé");
  assert.equal(opened.length, 1);
  assert.notEqual(opened[0], imported.id);
  delete ctx.lockedChatIsHidden;
  delete imported.serverLocked;
  ctx.store.conversations.length = 1;

  // Erreurs serveur : un seul appel, jamais de nouvel essai, message adapté, dialogue ouvert.
  const secondLink = "https://chatgpt.com/share/99999999-1111-2222-3333-444444444444";
  for (const [response, pattern] of [
    [reply(400, { message: "Lien non pris en charge" }), /refusé.*Lien non pris en charge/],
    [reply(401), /Session expirée/],
    [reply(403), /non autorisé/],
    [reply(404), /introuvable/],
    [reply(500), /peut-être abouti/],
    [reply(418), /HTTP 418/]
  ]) {
    reset();
    handler = async () => response;
    if (!dialog.open) button.dispatch("click");
    await submit(secondLink);
    assert.equal(calls.length, 1, "aucun nouvel essai automatique");
    assert.match(status.textContent, pattern);
    assert.equal(status.classList.contains("is-error"), true);
    assert.equal(submitButton.disabled, false, "le bouton redevient disponible après l'échec");
    assert.equal(ctx.store.conversations.length, 1, "aucune conversation locale créée en cas d'échec");
  }

  // 429 : le message d'attente du transport est affiché tel quel.
  reset();
  handler = async () => { const error = new Error("Trop de requêtes : réessaie dans 30 secondes."); error.status = 429; throw error; };
  await submit(secondLink);
  assert.match(status.textContent, /30 secondes/);
  assert.equal(calls.length, 1, "pas de nouvel essai après un 429");

  // Panne réseau : message de vérification de l'historique.
  reset();
  handler = async () => { throw new Error("réseau coupé"); };
  await submit(secondLink);
  assert.equal(calls.length, 1);
  assert.match(status.textContent, /Connexion impossible.*peut-être abouti/);

  // Réponse inattendue : resynchronisation de l'historique, pas de conversation inventée.
  reset();
  const syncBefore = syncCalls;
  handler = async () => reply(200, { title: "sans chatId" });
  await submit(secondLink);
  assert.equal(syncCalls, syncBefore + 1);
  assert.equal(ctx.store.conversations.length, 1);
  assert.match(status.textContent, /Réponse inattendue/);

  // Double soumission pendant un import en cours : un seul POST, commandes verrouillées.
  reset();
  let release;
  handler = () => new Promise(resolve => { release = () => resolve(reply(200, { chatId: importedChatId.replace(/^c/, "1"), title: "Lent", sourceConversationId: secondLink.split("/").pop() })); });
  link.value = secondLink;
  form.dispatch("submit");
  form.dispatch("submit");
  await flush();
  assert.equal(calls.length, 1, "un seul import à la fois");
  assert.equal(submitButton.disabled, true);
  assert.equal(closeButton.disabled, true);
  const cancel = dialog.dispatch("cancel");
  assert.equal(cancel.defaultPrevented, true, "le dialogue ne se ferme pas pendant l'import");
  release();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(ctx.store.conversations.length, 2);
  assert.equal(dialog.open, false);

  // Session changée pendant l'import : rien n'est enregistré dans l'autre compte.
  reset();
  const countBefore = ctx.store.conversations.length;
  button.dispatch("click");
  handler = () => new Promise(resolve => { release = () => resolve(reply(200, { chatId: "12121212-1111-2222-3333-444444444444", title: "Fantôme" })); });
  link.value = "https://chatgpt.com/share/55555555-1111-2222-3333-444444444444";
  form.dispatch("submit");
  await flush();
  ctx.store.session = "session-2";
  release();
  await flush();
  assert.equal(ctx.store.conversations.length, countBefore, "pas d'import enregistré dans une autre session");
  assert.equal(opened.length, 0);
  ctx.store.session = "session-1";
  if (dialog.open) closeButton.dispatch("click");

  // Réponse en cours (busy) : la conversation importée n'interrompt pas le flux.
  reset();
  ctx.busy = true;
  handler = async () => reply(200, { chatId: "13131313-1111-2222-3333-444444444444", title: "Pendant un flux", sourceConversationId: "77777777-1111-2222-3333-444444444444" });
  button.dispatch("click");
  await submit("https://chatgpt.com/share/77777777-1111-2222-3333-444444444444");
  assert.equal(opened.length, 0, "aucune ouverture pendant une réponse en cours");
  assert.ok(toasts.some(text => text.includes("réponse en cours")));
  ctx.busy = false;
}
main().then(() => console.log("Import ChatGPT : lien, contrat, doublons, erreurs, concurrence et session vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
