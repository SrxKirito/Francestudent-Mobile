// Tests du service de partage d'une conversation (même contrat que mobile/www/js/chat-shares.js). Node pur, aucun navigateur.
import assert from "node:assert/strict";

const shares = await import("./src/lib/services/chat-shares.ts");
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

const ME = { id: 12, email: "Moi@Ecole.fr" };
const OWNER = { userId: 12, userEmail: "moi@ecole.fr", owner: true, permission: "Write" };
const READER = { userId: 3, userEmail: "lea@ecole.fr", owner: false, permission: "View" };
const WRITER = { userId: null, userEmail: "tom@ecole.fr", owner: false, permission: "Write" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

await test("parseShareUsers : tableau obligatoire, entrées invalides ignorées, champs normalisés", () => {
  assert.equal(shares.parseShareUsers({ data: [] }), null);
  assert.equal(shares.parseShareUsers("oops"), null);
  assert.equal(shares.parseShareUsers(null), null);
  const users = shares.parseShareUsers([null, 4, "x", { userId: 5, userEmail: 9, owner: "oui", permission: "Admin" }, { userEmail: "a@b.fr", owner: true, permission: "View" }]);
  assert.deepEqual(users, [
    { userId: 5, userEmail: "", owner: false, permission: "" },
    { userId: null, userEmail: "a@b.fr", owner: true, permission: "View" }
  ]);
});

await test("shareTarget : l'identifiant numérique prime, puis l'e-mail, sinon rien", () => {
  assert.deepEqual(shares.shareTarget(READER), { userId: 3 });
  assert.deepEqual(shares.shareTarget(WRITER), { userEmail: "tom@ecole.fr" });
  assert.equal(shares.shareTarget({ userId: null, userEmail: "", owner: false, permission: "View" }), null);
});

await test("isShareOwner : propriétaire reconnu par identifiant ou par e-mail (insensible à la casse), jamais sans drapeau owner", () => {
  assert.equal(shares.isShareOwner([OWNER, READER], ME), true);
  assert.equal(shares.isShareOwner([{ ...OWNER, userId: null }], ME), true);
  assert.equal(shares.isShareOwner([{ ...OWNER, userId: 99, userEmail: "MOI@ECOLE.FR" }], { id: null, email: "moi@ecole.fr" }), true);
  assert.equal(shares.isShareOwner([{ ...OWNER, owner: false }, READER], ME), false);
  assert.equal(shares.isShareOwner([OWNER], { id: 5, email: "autre@x.fr" }), false);
  assert.equal(shares.isShareOwner([OWNER], { id: null, email: "" }), false);
  assert.equal(shares.isShareOwner([], ME), false);
});

await test("shareRows : libellés, boutons seulement pour le propriétaire sur les autres personnes identifiables", () => {
  const rows = shares.shareRows([OWNER, READER, WRITER, { userId: 8, userEmail: "", owner: false, permission: "" }, { userId: null, userEmail: "", owner: false, permission: "View" }], true);
  assert.equal(rows[0].label, "moi@ecole.fr · Propriétaire");
  assert.equal(rows[0].canChange, false);
  assert.equal(rows[0].canRemove, false);
  assert.equal(rows[1].label, "lea@ecole.fr · Lecture");
  assert.equal(rows[1].changeLabel, "Autoriser l’écriture");
  assert.equal(rows[1].nextPermission, "Write");
  assert.equal(rows[1].canChange, true);
  assert.equal(rows[1].canRemove, true);
  assert.equal(rows[2].label, "tom@ecole.fr · Écriture");
  assert.equal(rows[2].changeLabel, "Passer en lecture");
  assert.equal(rows[2].nextPermission, "View");
  assert.equal(rows[3].label, "Utilisateur 8 · Droits inconnus");
  assert.equal(rows[3].canChange, false, "droits inconnus : pas de bascule");
  assert.equal(rows[3].canRemove, true);
  assert.equal(rows[4].label, "Utilisateur · Lecture");
  assert.equal(rows[4].canRemove, false, "sans identifiant on ne peut rien retirer");
  const asReader = shares.shareRows([OWNER, READER], false);
  assert.ok(asReader.every(row => !row.canChange && !row.canRemove));
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length, "clés uniques");
});

// ---------- contrôleur ----------
function setup({ users = [OWNER, READER], reply, confirmAnswer = true, target = { chatId: "chat-1", me: ME } } = {}) {
  const log = { requests: [], views: [], toasts: [], confirms: [], closed: 0, opened: 0 };
  const queue = [];
  const api = {
    target: localId => (localId === "a" ? target : null),
    call: async request => {
      log.requests.push(request);
      if (queue.length) return queue.shift();
      if (reply) return reply(request);
      return { ok: true, data: request.method === "GET" ? users : null };
    }
  };
  const ui = {
    openDialog: () => { log.opened += 1; },
    setView: view => log.views.push(view),
    toast: text => log.toasts.push(text),
    confirm: async text => { log.confirms.push(text); return confirmAnswer; },
    closeDialog: () => { log.closed += 1; }
  };
  return { log, queue, controller: shares.createSharesController({ api, ui }) };
}
const lastView = log => log.views[log.views.length - 1];

await test("open : conversation non synchronisée → message, pas de dialogue, aucune requête", async () => {
  const { log, controller } = setup();
  assert.equal(await controller.open("inconnue"), false);
  assert.deepEqual(log.toasts, ["Cette conversation doit d’abord être synchronisée."]);
  assert.equal(log.requests.length, 0);
  assert.equal(log.views.length, 0);
  assert.equal(log.opened, 0, "le dialogue ne s'ouvre pas");
});

await test("open : annonce le chargement, GET unique, lignes et formulaire pour le propriétaire", async () => {
  const { log, controller } = setup();
  assert.equal(await controller.open("a"), true);
  assert.equal(log.views[0].status, "Chargement des accès…");
  assert.deepEqual(log.requests, [{ localId: "a", method: "GET" }]);
  const view = lastView(log);
  assert.equal(view.status, "");
  assert.equal(view.canInvite, true);
  assert.equal(view.rows.length, 2);
  assert.equal(view.busy, false);
  assert.equal(log.opened, 1, "dialogue ouvert avant la fin du chargement");
});

await test("open : non propriétaire → pas de formulaire ; liste vide → « Aucun accès affiché. »", async () => {
  const reader = setup({ users: [{ ...OWNER, userId: 77, userEmail: "autre@x.fr" }, READER] });
  await reader.controller.open("a");
  assert.equal(lastView(reader.log).canInvite, false);
  const empty = setup({ users: [] });
  await empty.controller.open("a");
  assert.equal(lastView(empty.log).status, "Aucun accès affiché.");
  assert.equal(lastView(empty.log).rows.length, 0);
});

await test("open : réponse inattendue ou erreur serveur → message d'erreur, aucune ligne, aucun formulaire", async () => {
  const odd = setup({ reply: async () => ({ ok: true, data: { data: [] } }) });
  await odd.controller.open("a");
  assert.equal(lastView(odd.log).status, "Chargement impossible : Réponse inattendue du serveur.");
  assert.equal(lastView(odd.log).canInvite, false);
  const down = setup({ reply: async () => ({ ok: false, status: 500, message: "Erreur 500" }) });
  await down.controller.open("a");
  assert.equal(lastView(down.log).status, "Chargement impossible : Erreur 500");
  assert.equal(lastView(down.log).rows.length, 0);
  const noMessage = setup({ reply: async () => ({ ok: false }) });
  await noMessage.controller.open("a");
  assert.equal(lastView(noMessage.log).status, "Chargement impossible : Erreur inconnue.");
});

await test("session expirée → message dédié ; abandon (aborted) → aucune mise à jour", async () => {
  const expired = setup({ reply: async () => ({ ok: false, noSession: true }) });
  await expired.controller.open("a");
  assert.equal(lastView(expired.log).status, "Chargement impossible : Session expirée. Reconnecte-toi puis réessaie.");
  const aborted = setup({ reply: async () => ({ ok: false, aborted: true }) });
  await aborted.controller.open("a");
  assert.equal(lastView(aborted.log).status, "Chargement des accès…", "rien après l'abandon");
});

await test("grant : e-mail rogné, POST {userEmail, permission}, puis relecture ; e-mail invalide → aucune requête", async () => {
  const { log, controller } = setup();
  await controller.open("a");
  log.requests.length = 0;
  await controller.grant("  nina@ecole.fr  ", "Write");
  assert.deepEqual(log.requests, [
    { localId: "a", method: "POST", body: { userEmail: "nina@ecole.fr", permission: "Write" } },
    { localId: "a", method: "GET" }
  ]);
  assert.equal(log.views.some(view => view.status === "Enregistrement…" && view.busy === true), true);
  assert.equal(lastView(log).busy, false);
  log.requests.length = 0;
  await controller.grant("pas-une-adresse", "View");
  await controller.grant("   ", "View");
  await controller.grant("a@b.fr", "Admin");
  assert.equal(log.requests.length, 0);
  assert.equal(lastView(log).status, "Permission inconnue.");
});

await test("grant : adresse invalide signalée ; erreur serveur → « Modification impossible : … » et formulaire conservé", async () => {
  const { log, controller } = setup();
  await controller.open("a");
  await controller.grant("pas-une-adresse", "View");
  assert.equal(lastView(log).status, "Adresse e-mail invalide.");
  const failing = setup({ reply: async request => (request.method === "GET" ? { ok: true, data: [OWNER] } : { ok: false, status: 404, message: "Utilisateur introuvable" }) });
  await failing.controller.open("a");
  await failing.controller.grant("x@y.fr", "View");
  assert.equal(lastView(failing.log).status, "Modification impossible : Utilisateur introuvable");
  assert.equal(lastView(failing.log).canInvite, true);
  assert.equal(lastView(failing.log).busy, false);
});

await test("changePermission : PATCH avec l'identifiant et la permission inverse, puis relecture", async () => {
  const { log, controller } = setup({ users: [OWNER, READER, WRITER] });
  await controller.open("a");
  log.requests.length = 0;
  await controller.changePermission(lastView(log).rows[1].key);
  assert.deepEqual(log.requests[0], { localId: "a", method: "PATCH", body: { userId: 3, permission: "Write" } });
  assert.equal(log.requests[1].method, "GET");
  log.requests.length = 0;
  await controller.changePermission(lastView(log).rows[2].key);
  assert.deepEqual(log.requests[0].body, { userEmail: "tom@ecole.fr", permission: "View" });
  log.requests.length = 0;
  await controller.changePermission(lastView(log).rows[0].key);
  await controller.changePermission("clé-inconnue");
  assert.equal(log.requests.length, 0, "le propriétaire et les clés inconnues ne déclenchent rien");
});

await test("remove : confirmation obligatoire ; refus → rien ; accord → DELETE de l'identifiant puis relecture", async () => {
  const refuse = setup({ confirmAnswer: false });
  await refuse.controller.open("a");
  refuse.log.requests.length = 0;
  await refuse.controller.remove(lastView(refuse.log).rows[1].key);
  assert.deepEqual(refuse.log.confirms, ["Retirer cet accès à la conversation ?"]);
  assert.equal(refuse.log.requests.length, 0);
  const accept = setup();
  await accept.controller.open("a");
  accept.log.requests.length = 0;
  await accept.controller.remove(lastView(accept.log).rows[1].key);
  assert.deepEqual(accept.log.requests, [{ localId: "a", method: "DELETE", body: { userId: 3 } }, { localId: "a", method: "GET" }]);
});

await test("un seul changement à la fois : une 2e action pendant l'enregistrement est ignorée", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { log, controller } = setup({
    reply: async request => {
      if (request.method === "GET") return { ok: true, data: [OWNER, READER] };
      await gate;
      return { ok: true, data: null };
    }
  });
  await controller.open("a");
  log.requests.length = 0;
  const first = controller.changePermission(lastView(log).rows[1].key);
  await tick();
  await controller.changePermission(lastView(log).rows[1].key);
  await controller.grant("x@y.fr", "View");
  assert.equal(log.requests.length, 1, "une seule requête en vol");
  release();
  await first;
  assert.equal(log.requests.length, 2);
});

await test("close / onLogout pendant un chargement : aucune mise à jour tardive, dialogue fermé à la déconnexion", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { log, controller } = setup({ reply: async () => { await gate; return { ok: true, data: [OWNER] }; } });
  const opening = controller.open("a");
  await tick();
  controller.close();
  const count = log.views.length;
  release();
  await opening;
  assert.equal(log.views.length, count, "pas de rendu après la fermeture");
  const second = setup();
  await second.controller.open("a");
  second.controller.onLogout();
  assert.equal(second.log.closed, 1);
  const idle = setup();
  idle.controller.onLogout();
  assert.equal(idle.log.closed, 0, "rien à fermer si aucun dialogue");
});

console.log(`test-svelte-chat-shares : ${count} tests réussis`);
