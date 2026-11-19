// Tests du service « conversations verrouillées » côté Svelte : confidentialité, PIN à 4 chiffres, flux. Node pur.
import assert from "node:assert/strict";

const lc = await import("./src/lib/services/locked-chats.ts");
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

function fakeApi(initial = {}) {
  const s = { hasPin: false, accessOpen: false, lockedIds: [], loaded: false, ...initial };
  const calls = [];
  const rec = (name, fn) => async (...args) => { calls.push([name, ...args]); return fn ? fn(...args) : undefined; };
  const api = {
    calls, s,
    state: () => ({ ...s, lockedIds: [...s.lockedIds] }),
    getStatus: rec("getStatus", () => api.state()),
    openAccess: rec("openAccess", async pin => { if (api.failOpen) throw Object.assign(new Error("nope"), { status: 401 }); s.accessOpen = true; s.loaded = true; return api.state(); }),
    closeAccess: rec("closeAccess", async () => { s.accessOpen = false; return api.state(); }),
    list: rec("list", async () => { s.loaded = true; return []; }),
    lockChat: rec("lockChat", async id => { s.lockedIds.push(id); return true; }),
    unlockChat: rec("unlockChat", async id => { s.lockedIds = s.lockedIds.filter(x => x !== id); return true; }),
    createPin: rec("createPin", async pin => { s.hasPin = true; s.accessOpen = !api.noTokenOnCreate; return api.state(); }),
    changePin: rec("changePin", async () => api.state()),
    isChatLocked: id => s.lockedIds.includes(id)
  };
  return api;
}

function fakeUi(script = []) {
  const ui = {
    toasts: [], panel: false, status: "", prompts: [], submitErrors: [], confirms: [], confirmAnswer: true, cancelled: 0,
    askPin: async options => {
      ui.prompts.push(options.title);
      const step = script.shift() ?? { cancel: true };
      if (step.cancel) return false;
      try { await options.submit(step.pin); return true; }
      catch (error) { ui.submitErrors.push(String(error.message)); return false; }
    },
    cancelPin: () => { ui.cancelled += 1; },
    confirm: async message => { ui.confirms.push(message); return ui.confirmAnswer; },
    toast: (text, isError = false) => ui.toasts.push({ text, isError }),
    setPanel: open => { ui.panel = open; },
    panelOpen: () => ui.panel,
    setStatus: text => { ui.status = text; }
  };
  return ui;
}

function make({ api = fakeApi(), ui = fakeUi(), session = true, conversations = [], busy = false } = {}) {
  const ctx = { api, ui, session: () => session, conversations: () => conversations, chatBusy: () => busy };
  return { api, ui, controller: lc.createLockedController(ctx) };
}

await test("PIN : exactement 4 chiffres, nettoyage de la saisie", () => {
  assert.equal(lc.isValidPin("1234"), true);
  for (const bad of ["123", "12345", "12a4", "", " 1234", "１２３４"]) assert.equal(lc.isValidPin(bad), false, bad);
  assert.equal(lc.sanitizePin("12a3-456"), "1234");
  assert.equal(lc.sanitizePin("abc"), "");
});

await test("pinFailureMessage : 401/403 = code incorrect, sinon le message", () => {
  assert.equal(lc.pinFailureMessage(Object.assign(new Error("x"), { status: 401 })), "Code PIN incorrect.");
  assert.equal(lc.pinFailureMessage(Object.assign(new Error("x"), { status: 403 })), "Code PIN incorrect.");
  assert.equal(lc.pinFailureMessage(new Error("Réseau coupé")), "Réseau coupé");
  assert.equal(lc.pinFailureMessage(undefined), "Erreur inconnue");
});

await test("confidentialité : lignes et compteur vides tant que l'accès est fermé", () => {
  const convs = [{ id: "a", chatId: "c1", title: "Secret", updatedAt: 1, serverLocked: true }];
  const closed = { hasPin: true, accessOpen: false, lockedIds: ["c1"], loaded: true };
  assert.deepEqual(lc.lockedRows(convs, closed, null), []);
  assert.equal(lc.lockedBadge(closed), 0);
});

await test("lockedRows : accès ouvert → triées par date, titre de repli, courante marquée", () => {
  const convs = [
    { id: "a", chatId: "c1", title: "Ancienne", updatedAt: 1 },
    { id: "b", chatId: "c2", title: "", updatedAt: 9 },
    { id: "c", chatId: "c3", title: "Non verrouillée", updatedAt: 5 },
    { id: "d", title: "Sans chatId", updatedAt: 7 }
  ];
  const open = { hasPin: true, accessOpen: true, lockedIds: ["c1", "c2"], loaded: true };
  const rows = lc.lockedRows(convs, open, "a");
  assert.deepEqual(rows.map(r => r.id), ["b", "a"]);
  assert.equal(rows[0].title, "Sans titre");
  assert.equal(rows[1].current, true);
  assert.equal(rows[0].current, false);
  assert.equal(lc.lockedBadge(open), 2);
});

await test("lockedStatusText : états du panneau", () => {
  const open = { hasPin: true, accessOpen: true, lockedIds: [], loaded: true };
  assert.equal(lc.lockedStatusText(open, 0, false), "Aucune conversation verrouillée.");
  assert.equal(lc.lockedStatusText(open, 2, false), "");
  assert.equal(lc.lockedStatusText({ ...open, loaded: false }, 0, true), "Chargement…");
  assert.equal(lc.lockedStatusText({ ...open, loaded: false }, 0, false), "Liste indisponible.");
});

await test("pinHint : texte des réglages du code PIN", () => {
  assert.equal(lc.pinHint(false, { hasPin: null, accessOpen: false, lockedIds: [], loaded: false }), "Connecte-toi pour gérer le code PIN.");
  assert.equal(lc.pinHint(true, { hasPin: null, accessOpen: false, lockedIds: [], loaded: false }), "État du code PIN non chargé.");
  assert.equal(lc.pinHint(true, { hasPin: true, accessOpen: false, lockedIds: [], loaded: false }), "Un code PIN protège tes conversations verrouillées.");
  assert.equal(lc.pinHint(true, { hasPin: false, accessOpen: false, lockedIds: [], loaded: false }), "Aucun code PIN défini.");
});

await test("toggleAccess sans session : message d'erreur, aucune requête", async () => {
  const { api, ui, controller } = make({ session: false });
  await controller.toggleAccess();
  assert.equal(api.calls.length, 0);
  assert.equal(ui.toasts.length, 1);
  assert.equal(ui.toasts[0].isError, true);
  assert.match(ui.toasts[0].text, /Conversations verrouillées indisponibles/);
});

await test("toggleAccess avec code PIN : saisie → openAccess → panneau ouvert", async () => {
  const api = fakeApi({ hasPin: true });
  const ui = fakeUi([{ pin: "4321" }]);
  const { controller } = make({ api, ui });
  await controller.toggleAccess();
  assert.deepEqual(api.calls.map(c => c[0]), ["getStatus", "openAccess"]);
  assert.deepEqual(api.calls[1], ["openAccess", "4321"]);
  assert.equal(ui.panel, true);
});

await test("toggleAccess : mauvais code → erreur remontée au dialogue, panneau fermé", async () => {
  const api = fakeApi({ hasPin: true });
  api.failOpen = true;
  const ui = fakeUi([{ pin: "0000" }]);
  const { controller } = make({ api, ui });
  await controller.toggleAccess();
  assert.equal(ui.panel, false);
  assert.equal(ui.submitErrors.length, 1);
  assert.equal(lc.pinFailureMessage(Object.assign(new Error("nope"), { status: 401 })), "Code PIN incorrect.");
});

await test("toggleAccess sans code PIN : création (2 saisies), puis ouverture si besoin", async () => {
  const api = fakeApi({ hasPin: false });
  api.noTokenOnCreate = true;
  const ui = fakeUi([{ pin: "1111" }, { pin: "1111" }, { pin: "1111" }]);
  const { controller } = make({ api, ui });
  await controller.toggleAccess();
  const names = api.calls.map(c => c[0]);
  assert.deepEqual(names, ["getStatus", "createPin", "openAccess"]);
  assert.deepEqual(api.calls[1], ["createPin", "1111"]);
  assert.ok(ui.toasts.some(t => t.text === "Code PIN créé."));
  assert.equal(ui.panel, true);
});

await test("création du code : deux saisies différentes → rien n'est envoyé", async () => {
  const api = fakeApi({ hasPin: false });
  const ui = fakeUi([{ pin: "1111" }, { pin: "2222" }]);
  const { controller } = make({ api, ui });
  await controller.toggleAccess();
  assert.ok(!api.calls.some(c => c[0] === "createPin"));
  assert.deepEqual(ui.submitErrors, ["Les deux codes ne correspondent pas."]);
});

await test("toggleAccess avec accès déjà ouvert : simple bascule du panneau (comme l'ancienne interface)", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true });
  const { ui, controller } = make({ api });
  await controller.toggleAccess();
  assert.equal(ui.panel, true);
  await controller.toggleAccess();
  assert.equal(ui.panel, false);
  assert.equal(api.calls.length, 0);
});

await test("toggleAccess : le serveur dit « ouvert » alors que l'état local est fermé → panneau + rechargement", async () => {
  const api = fakeApi({ hasPin: true });
  api.getStatus = async () => { api.calls.push(["getStatus"]); api.s.accessOpen = true; return api.state(); };
  const { ui, controller } = make({ api });
  await controller.toggleAccess();
  assert.equal(ui.panel, true);
  assert.deepEqual(api.calls.map(c => c[0]), ["getStatus", "list"]);
});

await test("closeAccessNow : ferme l'accès, masque le panneau, prévient", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true });
  const { ui, controller } = make({ api });
  ui.panel = true;
  await controller.closeAccessNow();
  assert.deepEqual(api.calls.map(c => c[0]), ["closeAccess"]);
  assert.equal(ui.panel, false);
  assert.ok(ui.toasts.some(t => t.text === "Conversations verrouillées masquées."));
});

const saved = { id: "L1", chatId: "chat-1", title: "Maths" };

await test("toggleConversationLock : refus si non enregistrée ou réponse en cours", async () => {
  let r = make({ conversations: [{ id: "L1", title: "x" }] });
  await r.controller.toggleConversationLock("L1");
  assert.equal(r.ui.toasts[0].text, "Cette conversation n’est pas encore enregistrée sur le serveur.");
  r = make({ conversations: [saved], busy: true });
  await r.controller.toggleConversationLock("L1");
  assert.equal(r.ui.toasts[0].text, "Termine ou annule la réponse en cours d’abord.");
  r = make({ conversations: [{ ...saved, pendingResponse: true }] });
  await r.controller.toggleConversationLock("L1");
  assert.equal(r.ui.toasts[0].text, "Termine ou annule la réponse en cours d’abord.");
  assert.equal(r.api.calls.length, 0);
});

await test("toggleConversationLock : verrouille (accès ouvert)", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true });
  const { ui, controller } = make({ api, conversations: [saved] });
  await controller.toggleConversationLock("L1");
  assert.deepEqual(api.calls.at(-1), ["lockChat", "chat-1"]);
  assert.ok(ui.toasts.some(t => t.text === "Conversation verrouillée."));
});

await test("toggleConversationLock : accès fermé → demande le code, annulation = aucun verrouillage", async () => {
  const api = fakeApi({ hasPin: true });
  const ui = fakeUi([{ cancel: true }]);
  const { controller } = make({ api, ui, conversations: [saved] });
  await controller.toggleConversationLock("L1");
  assert.ok(!api.calls.some(c => c[0] === "lockChat"));
});

await test("toggleConversationLock : verrouillée → confirmation puis déverrouillage ; refus de confirmer = rien", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true, lockedIds: ["chat-1"] });
  const ui = fakeUi();
  ui.confirmAnswer = false;
  const { controller } = make({ api, ui, conversations: [saved] });
  await controller.toggleConversationLock("L1");
  assert.ok(!api.calls.some(c => c[0] === "unlockChat"));
  assert.match(ui.confirms[0], /Déverrouiller définitivement « Maths »/);
  ui.confirmAnswer = true;
  await controller.toggleConversationLock("L1");
  assert.deepEqual(api.calls.at(-1), ["unlockChat", "chat-1"]);
  assert.ok(ui.toasts.some(t => t.text === "Conversation déverrouillée."));
});

await test("toggleConversationLock : erreur serveur → toast d'erreur", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true });
  api.lockChat = async () => { throw new Error("500"); };
  const { ui, controller } = make({ api, conversations: [saved] });
  await controller.toggleConversationLock("L1");
  assert.deepEqual(ui.toasts.at(-1), { text: "Opération impossible : 500", isError: true });
});

await test("unlockFromPanel : confirmation puis déverrouillage ; échec → statut", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true, lockedIds: ["chat-1"] });
  const { ui, controller } = make({ api, conversations: [saved] });
  await controller.unlockFromPanel("chat-1");
  assert.deepEqual(api.calls.at(-1), ["unlockChat", "chat-1"]);
  const failing = fakeApi({ hasPin: true, accessOpen: true, lockedIds: ["chat-1"] });
  failing.unlockChat = async () => { throw new Error("boom"); };
  const r = make({ api: failing, conversations: [saved] });
  await r.controller.unlockFromPanel("chat-1");
  assert.equal(r.ui.status, "Déverrouillage impossible : boom");
});

await test("changePinFlow : code actuel, nouveau code ×2 → changePin ; rien ne subsiste", async () => {
  const api = fakeApi({ hasPin: true });
  const ui = fakeUi([{ pin: "1234" }, { pin: "5678" }, { pin: "5678" }]);
  const { controller } = make({ api, ui });
  await controller.changePinFlow();
  assert.deepEqual(api.calls.at(-1), ["changePin", "1234", "5678"]);
  assert.ok(ui.toasts.some(t => t.text === "Code PIN modifié."));
});

await test("une seule opération à la fois (garde d'occupation)", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true });
  let release;
  api.closeAccess = () => new Promise(resolve => { release = () => resolve(api.state()); });
  const { controller } = make({ api });
  const first = controller.closeAccessNow();
  await controller.closeAccessNow();
  assert.equal(controller.isBusy(), true);
  release();
  await first;
  assert.equal(controller.isBusy(), false);
});

await test("onLogout : annule le dialogue, ferme le panneau et l'accès en silence", async () => {
  const api = fakeApi({ hasPin: true, accessOpen: true });
  const { ui, controller } = make({ api });
  ui.panel = true;
  await controller.onLogout();
  assert.equal(ui.cancelled, 1);
  assert.equal(ui.panel, false);
  assert.deepEqual(api.calls.at(-1), ["closeAccess", { silent: true }]);
});

await test("connectLockedChats : lit window.FranceStudentLockedChats, tolère l'absence", () => {
  assert.equal(lc.connectLockedChats(null), null);
  assert.equal(lc.connectLockedChats({}), null);
  const api = fakeApi();
  const connected = lc.connectLockedChats({ FranceStudentLockedChats: api });
  assert.ok(connected);
  const incomplete = lc.connectLockedChats({ FranceStudentLockedChats: { state() { return {}; } } });
  assert.equal(incomplete, null);
  const hostile = {};
  Object.defineProperty(hostile, "FranceStudentLockedChats", { get() { throw new Error("cross-origin"); } });
  assert.equal(lc.connectLockedChats(hostile), null);
});

console.log("exit " + (process.exitCode || 0) + " (" + count + " tests réussis)");
