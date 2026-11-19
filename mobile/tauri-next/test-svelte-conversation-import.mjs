// Tests du service d'import de conversations (même contrat que conversation-import.js). Node pur, aucun navigateur.
import assert from "node:assert/strict";

const importer = await import("./src/lib/services/conversation-import.ts");
let count = 0;
async function test(name, fn) {
  try {
    await fn();
    count += 1;
    console.log("ok - " + name);
  } catch (error) {
    console.error("NOK - " + name);
    console.error(error);
    process.exitCode = 1;
  }
}

const SHARE = "123e4567-e89b-42d3-a456-426614174000";

await test("parseShareLink : https, /share/{uuid}, sans identifiants ; identifiant en minuscules", () => {
  const ok = importer.parseShareLink("  https://chatgpt.com/share/" + SHARE.toUpperCase() + "  ");
  assert.deepEqual(ok, { link: "https://chatgpt.com/share/" + SHARE.toUpperCase(), shareId: SHARE });
  assert.deepEqual(importer.parseShareLink("https://chatgpt.com/share/" + SHARE + "/")?.shareId, SHARE);
  for (const bad of [
    "", "   ", undefined, null, "chatgpt.com/share/" + SHARE,
    "http://chatgpt.com/share/" + SHARE,
    "https://user:pw@chatgpt.com/share/" + SHARE,
    "https://chatgpt.com/share/pas-un-uuid",
    "https://chatgpt.com/c/" + SHARE,
    "https://chatgpt.com/share/" + SHARE + "/extra",
    "javascript:alert(1)"
  ]) assert.equal(importer.parseShareLink(bad), null, String(bad));
});

await test("describeFailure : un message par statut, détail entre parenthèses", () => {
  const d = importer.describeFailure;
  assert.equal(d({ status: 400, detail: "lien" }), "Le serveur a refusé ce lien ou ce modèle (lien). Vérifie que le lien est un lien de partage public ChatGPT.");
  assert.equal(d({ status: 422 }), "Le serveur a refusé ce lien ou ce modèle. Vérifie que le lien est un lien de partage public ChatGPT.");
  assert.equal(d({ status: 401 }), "Session expirée. Reconnecte-toi puis réessaie.");
  assert.equal(d({ status: 403, detail: "quota" }), "Import non autorisé pour ce compte (quota).");
  assert.equal(d({ status: 404 }), "Conversation introuvable. Vérifie que le lien de partage est public.");
  assert.equal(d({ status: 429, message: "Trop de demandes" }), "Trop de demandes");
  assert.equal(d({ status: 429 }), "Import impossible (HTTP 429).");
  assert.equal(d({ status: 503 }), "Le serveur est momentanément indisponible. Vérifie ton historique avant de réessayer : l’import a peut-être abouti.");
  assert.equal(d({ status: 418, detail: "théière" }), "Import impossible (HTTP 418) (théière).");
  assert.equal(d({ unexpected: true, message: "Réponse inattendue" }), "Réponse inattendue");
  assert.equal(d({ message: "réseau coupé" }), "Connexion impossible : réseau coupé. Vérifie ton historique avant de réessayer : l’import a peut-être abouti.");
  assert.equal(d({}), "Connexion impossible : erreur inconnue. Vérifie ton historique avant de réessayer : l’import a peut-être abouti.");
});

await test("importedToast : singulier, pluriel, nombre inconnu", () => {
  assert.equal(importer.importedToast(null), "Conversation importée.");
  assert.equal(importer.importedToast(1), "Conversation importée (1 message).");
  assert.equal(importer.importedToast(3), "Conversation importée (3 messages).");
  assert.equal(importer.importedToast(0), "Conversation importée (0 message).");
});

// ---------- contrôleur ----------
function setup(overrides = {}) {
  const log = [];
  const status = [];
  const api = {
    models: () => ({ models: [{ id: 1, label: "A", model: "a" }, { id: 4, label: "B", model: "b" }], currentId: 4 }),
    findExisting: () => null,
    runs: [],
    run: async request => { api.runs.push(request); return { ok: true, id: "c1", count: 2 }; },
    ...overrides.api
  };
  const state = { loggedIn: true, busy: false, ...overrides.state };
  const controller = importer.createImportController({
    api,
    loggedIn: () => state.loggedIn,
    chatBusy: () => state.busy,
    ui: {
      setStatus: (text, isError) => status.push([text, isError]),
      toast: (text, isError) => log.push(["toast", text, isError === true]),
      closeDialog: () => log.push(["close"]),
      openConversation: async id => { log.push(["open", id]); },
      setImporting: on => log.push(["importing", on])
    }
  });
  return { controller, api, log, status, state };
}
const LINK = "https://chatgpt.com/share/" + SHARE;

await test("open : sans session → toast d'erreur ; sans modèle → statut ; sinon liste et modèle courant", () => {
  let s = setup({ state: { loggedIn: false } });
  assert.equal(s.controller.open(), null);
  assert.deepEqual(s.log, [["toast", "Connecte-toi pour importer une conversation.", true]]);
  s = setup({ api: { models: () => ({ models: [], currentId: null }) } });
  const empty = s.controller.open();
  assert.deepEqual(empty.models, []);
  assert.deepEqual(s.status.at(-1), ["Aucun modèle disponible pour l’import pour le moment.", true]);
  s = setup();
  const info = s.controller.open();
  assert.equal(info.models.length, 2);
  assert.equal(info.selectedId, 4);
  assert.deepEqual(s.status, []);
});

await test("open : modèle courant absent de la liste → premier modèle", () => {
  const s = setup({ api: { models: () => ({ models: [{ id: 1, label: "A", model: "a" }], currentId: 9 }) } });
  assert.equal(s.controller.open().selectedId, 1);
});

await test("submit : validations (session, lien, modèle) sans aucune requête", async () => {
  let s = setup({ state: { loggedIn: false } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.deepEqual(s.status.at(-1), ["Connecte-toi pour importer une conversation.", true]);
  s = setup(); s.controller.open();
  await s.controller.submit({ link: "pas un lien", agentId: 1 });
  assert.deepEqual(s.status.at(-1), ["Saisis un lien public ChatGPT de la forme https://…/share/{identifiant}.", true]);
  await s.controller.submit({ link: LINK, agentId: 99 });
  assert.deepEqual(s.status.at(-1), ["Choisis un modèle disponible.", true]);
  assert.equal(s.api.runs.length, 0);
});

await test("submit : succès → une seule requête, dialogue fermé, toast avec compte, conversation ouverte", async () => {
  const s = setup(); s.controller.open();
  await s.controller.submit({ link: "  " + LINK + " ", agentId: 4 });
  assert.equal(s.api.runs.length, 1);
  assert.deepEqual(s.api.runs[0], { link: LINK, shareId: SHARE, agentId: 4 });
  assert.deepEqual(s.status[0], ["Import en cours…", false]);
  assert.deepEqual(s.log, [
    ["importing", true], ["importing", false], ["close"],
    ["toast", "Conversation importée (2 messages).", false], ["open", "c1"]
  ]);
  assert.equal(s.controller.importing(), false);
});

await test("submit : réponse en cours → conversation non ouverte, message d'attente", async () => {
  const s = setup({ state: { busy: true } }); s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.ok(!s.log.some(entry => entry[0] === "open"));
  assert.deepEqual(s.log.at(-1), ["toast", "Conversation importée. Ouvre-la depuis l’historique quand la réponse en cours sera terminée.", false]);
});

await test("submit : déjà importée → ouverture de l'existante sans requête ; archivée → statut, dialogue ouvert", async () => {
  let s = setup({ api: { findExisting: () => ({ id: "x1", serverArchived: false }) } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.equal(s.api.runs.length, 0);
  assert.deepEqual(s.log, [["close"], ["toast", "Cette conversation a déjà été importée : ouverture de la conversation existante.", false], ["open", "x1"]]);
  s = setup({ api: { findExisting: () => ({ id: "x2", serverArchived: true }) } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.equal(s.api.runs.length, 0);
  assert.deepEqual(s.status.at(-1), ["Cette conversation a déjà été importée, mais elle est archivée. Restaure-la depuis les conversations archivées.", true]);
  assert.ok(!s.log.some(entry => entry[0] === "close"));
});

await test("submit : échec → message décrit dans le dialogue, jamais de nouvel essai, dialogue ouvert", async () => {
  const s = setup({ api: { run: async () => ({ ok: false, status: 404, detail: "x" }) } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.deepEqual(s.status.at(-1), ["Conversation introuvable (x). Vérifie que le lien de partage est public.", true]);
  assert.deepEqual(s.log, [["importing", true], ["importing", false]]);
  assert.equal(s.controller.importing(), false);
});

await test("submit : sans session côté moteur / modèle refusé → messages dédiés", async () => {
  let s = setup({ api: { run: async () => ({ ok: false, noSession: true }) } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.deepEqual(s.status.at(-1), ["Connecte-toi pour importer une conversation.", true]);
  s = setup({ api: { run: async () => ({ ok: false, noModel: true }) } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.deepEqual(s.status.at(-1), ["Choisis un modèle disponible.", true]);
});

await test("submit : une seule soumission à la fois", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup({ api: { run: async request => { s.api.runs.push(request); await gate; return { ok: true, id: "c1", count: null }; } } });
  s.controller.open();
  const first = s.controller.submit({ link: LINK, agentId: 1 });
  assert.equal(s.controller.importing(), true);
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.equal(s.api.runs.length, 1);
  release();
  await first;
  assert.equal(s.api.runs.length, 1);
  assert.equal(s.controller.importing(), false);
});

await test("close : refusée pendant l'import, acceptée sinon", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup({ api: { run: async () => { await gate; return { ok: false, status: 500 }; } } });
  s.controller.open();
  const pending = s.controller.submit({ link: LINK, agentId: 1 });
  assert.equal(s.controller.close(), false);
  assert.ok(!s.log.some(entry => entry[0] === "close"));
  release();
  await pending;
  assert.equal(s.controller.close(), true);
  assert.deepEqual(s.log.at(-1), ["close"]);
});

await test("déconnexion : ferme le dialogue ; un résultat tardif ne touche plus le dialogue", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup({ api: { run: async () => { await gate; return { ok: false, status: 500 }; } } });
  s.controller.open();
  const pending = s.controller.submit({ link: LINK, agentId: 1 });
  s.controller.onLogout();
  assert.deepEqual(s.log.at(-1), ["close"]);
  const before = s.status.length;
  release();
  await pending;
  assert.equal(s.status.length, before, "aucun message affiché dans un dialogue fermé");
});

await test("abandon (session changée) : aucun message, aucun toast, aucune ouverture", async () => {
  const s = setup({ api: { run: async () => ({ ok: false, aborted: true }) } });
  s.controller.open();
  await s.controller.submit({ link: LINK, agentId: 1 });
  assert.deepEqual(s.status.map(entry => entry[0]), ["Import en cours…"]);
  assert.deepEqual(s.log, [["importing", true], ["importing", false]]);
});

console.log(`test-svelte-conversation-import : ${count} tests réussis`);
