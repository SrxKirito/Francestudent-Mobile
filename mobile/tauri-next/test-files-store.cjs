"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "files-store.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => assert.deepEqual(plain(actual), expected, message);
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const load = (extra = {}) => {
  const context = vm.createContext({ console: { error() {} }, ...extra });
  vm.runInContext(script, context);
  return context.tauriFilesStore;
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const ids = store => store.files().map(file => file.id);

function makeEnv() {
  const env = {
    session: "s1", calls: [], clock: 1000, deleteResult: true, usedBytes: 10,
    pages: {
      "/filesv2?limit=2": { data: [{ id: "a", filename: "cours.pdf", bytes: 5 }, { id: "b", filename: "cours.pdf", bytes: 7 }], has_more: true, last_id: "b" },
      "/filesv2?limit=2&after=b": { data: [{ id: "c", filename: "notes.txt", bytes: 1 }], has_more: false, last_id: "c" }
    }
  };
  env.api = async (apiPath, options) => {
    const method = options?.method || "GET";
    env.calls.push(method + " " + apiPath);
    if (apiPath === "/filesv2/usage") return { usedBytes: env.usedBytes, maxBytes: 100 };
    if (method === "DELETE") return { deleted: env.deleteResult };
    if (env.pages[apiPath]) return env.pages[apiPath];
    throw new Error("Requête inattendue : " + method + " " + apiPath);
  };
  env.make = (overrides = {}) => load().create({ api: (p, o) => env.api(p, o), getSession: () => env.session, pageSize: 2, now: () => env.clock, ...overrides });
  return env;
}

async function testPaginationAndIdentity() {
  const env = makeEnv();
  const store = env.make();
  assert.equal(store.isLoaded(), false);
  eq(await store.loadMore(), { ok: true, added: 2 });
  eq(ids(store), ["a", "b"], "deux fichiers de même nom restent distincts (clé = id serveur)");
  assert.equal(store.hasMore(), true);
  eq(await store.loadMore(), { ok: true, added: 1 });
  eq(ids(store), ["a", "b", "c"]);
  assert.equal(store.hasMore(), false);
  const callsBefore = env.calls.length;
  eq(await store.loadMore(), { ok: true, added: 0 });
  assert.equal(env.calls.length, callsBefore, "plus de page : aucun appel réseau");
  assert.equal(store.get("b").bytes, 7);
  assert.equal(store.get("zzz"), null);
  assert.throws(() => { store.get("a").bytes = 1; }, TypeError, "les objets exposés sont figés");

  // Entrées sans id ignorées ; une page déjà connue ne duplique rien.
  const env2 = makeEnv();
  env2.pages["/filesv2?limit=2"] = { data: [{ filename: "sans-id" }, null, { id: "", filename: "vide" }, { id: "x" }, { id: "x" }], has_more: false };
  const s2 = env2.make();
  await s2.loadMore();
  eq(ids(s2), ["x"]);
}

async function testErrors() {
  const env = makeEnv();
  env.pages["/filesv2?limit=2"] = { data: [], has_more: true };
  let store = env.make();
  await assert.rejects(store.loadMore(), /Curseur de pagination indisponible\./);
  assert.equal(store.isLoaded(), false);

  env.pages["/filesv2?limit=2"] = { data: [{ id: "a" }], has_more: true, last_id: "" };
  await assert.rejects(env.make().loadMore(), /Curseur de pagination indisponible\./);
  env.pages["/filesv2?limit=2"] = { nope: true };
  await assert.rejects(env.make().loadMore(), /Liste de fichiers non reconnue\./);

  // Échec puis nouvelle tentative : même curseur, rien de perdu.
  const env2 = makeEnv(); let failOnce = true; const base = env2.api;
  env2.api = async (p, o) => { if (p === "/filesv2?limit=2&after=b" && failOnce) { failOnce = false; throw new Error("réseau"); } return base(p, o); };
  store = env2.make();
  await store.loadMore();
  await assert.rejects(store.loadMore(), /réseau/);
  eq(ids(store), ["a", "b"]);
  assert.equal(store.hasMore(), true);
  await store.loadMore();
  eq(ids(store), ["a", "b", "c"]);

  // Sans session : erreur claire, aucun appel.
  const env3 = makeEnv(); env3.session = "";
  store = env3.make();
  for (const call of [() => store.loadMore(), () => store.reload(), () => store.fetchUsage(), () => store.remove("a"), () => store.ensureLoaded()]) {
    await assert.rejects(call(), /Connecte-toi/);
  }
  assert.equal(env3.calls.length, 0);
  assert.equal(store.noteUploaded({ id: "a" }), false);
  await assert.rejects(env.make().remove(""), /Identifiant de fichier invalide/);
  assert.throws(() => load().create({}), /api et getSession/);
}

async function testInflightAndStaleResponses() {
  const env = makeEnv();
  const gate = deferred(); const base = env.api; let pageRequests = 0;
  env.api = (p, o) => { if (p === "/filesv2?limit=2") { pageRequests++; return gate.promise; } return base(p, o); };
  const store = env.make();
  const p1 = store.loadMore(), p2 = store.loadMore();
  gate.resolve(env.pages["/filesv2?limit=2"]);
  await Promise.all([p1, p2]);
  assert.equal(pageRequests, 1, "deux appels simultanés partagent la même requête");
  eq(ids(store), ["a", "b"]);

  // Un rechargement rend caduque une pagination en vol.
  const env2 = makeEnv(); const lateMore = deferred(); const base2 = env2.api;
  env2.api = (p, o) => p === "/filesv2?limit=2&after=b" ? lateMore.promise : base2(p, o);
  const s2 = env2.make();
  await s2.loadMore();
  const pendingMore = s2.loadMore();
  env2.pages["/filesv2?limit=2"] = { data: [{ id: "n1" }], has_more: false, last_id: "n1" };
  eq(await s2.reload(), { ok: true, added: 1 });
  lateMore.resolve(env2.pages["/filesv2?limit=2&after=b"]);
  eq(await pendingMore, { stale: true });
  eq(ids(s2), ["n1"], "la page tardive n'écrase pas le rechargement");

  // Changement de session pendant un chargement : le résultat est ignoré et le cache repart de zéro.
  const env3 = makeEnv(); const slow = deferred(); const base3 = env3.api;
  env3.api = (p, o) => p === "/filesv2?limit=2" ? slow.promise : base3(p, o);
  const s3 = env3.make();
  const pending = s3.loadMore();
  env3.session = "s2";
  slow.resolve(env3.pages["/filesv2?limit=2"]);
  eq(await pending, { stale: true });
  eq(ids(s3), []);
  assert.equal(s3.isLoaded(), false);
  assert.equal(s3.usage(), null);
}

async function testReloadAndFreshness() {
  const env = makeEnv();
  const store = env.make({ listTtlMs: 1000 });
  assert.equal(store.isStale(), true, "rien chargé : périmé");
  assert.equal((await store.ensureLoaded()).added, 2);
  assert.equal(store.isStale(), false);
  const calls = env.calls.length;
  eq(await store.ensureLoaded(), { ok: true, added: 0, cached: true });
  assert.equal(env.calls.length, calls, "données fraîches : pas de requête");
  env.clock += 1001;
  assert.equal(store.isStale(), true);
  await store.ensureLoaded();
  assert.equal(env.calls.length, calls + 1);

  // L'ancienne liste reste disponible pendant le rechargement, puis est remplacée.
  await store.loadMore();
  eq(ids(store), ["a", "b", "c"]);
  const gate = deferred(); const base = env.api; let reloads = 0;
  env.api = (p, o) => { if (p === "/filesv2?limit=2") { reloads++; return gate.promise; } return base(p, o); };
  const reloading = store.reload(), again = store.reload();
  eq(ids(store), ["a", "b", "c"]);
  gate.resolve({ data: [{ id: "z" }], has_more: false, last_id: "z" });
  await Promise.all([reloading, again]);
  assert.equal(reloads, 1, "rechargements simultanés partagés");
  eq(ids(store), ["z"]);

  // Charger plus ne fait pas passer une liste périmée pour fraîche.
  const env2 = makeEnv(); const s2 = env2.make();
  await s2.loadMore();
  s2.invalidate();
  assert.equal(s2.isStale(), true);
  await s2.loadMore();
  assert.equal(s2.isStale(), true);
}

async function testUsage() {
  const env = makeEnv();
  const store = env.make({ usageTtlMs: 1000 });
  const count = () => env.calls.filter(entry => entry === "GET /filesv2/usage").length;
  const first = await store.fetchUsage();
  eq({ ...first }, { usedBytes: 10, maxBytes: 100 });
  assert.equal(store.usage().usedBytes, 10);
  await store.fetchUsage();
  assert.equal(count(), 1, "cache court");
  env.clock += 1001;
  await store.fetchUsage();
  assert.equal(count(), 2, "cache expiré");
  env.usedBytes = 20;
  assert.equal((await store.fetchUsage({ force: true })).usedBytes, 20);
  assert.equal(count(), 3);

  // Requêtes simultanées non forcées partagées ; forcée : la plus récente gagne.
  const env2 = makeEnv(); const pending = []; const base = env2.api;
  env2.api = (p, o) => p === "/filesv2/usage" ? new Promise(resolve => pending.push(resolve)) : base(p, o);
  const s2 = env2.make();
  const a = s2.fetchUsage(), b = s2.fetchUsage();
  assert.equal(pending.length, 1, "requêtes simultanées partagées");
  pending[0]({ usedBytes: 1, maxBytes: 2 }); await Promise.all([a, b]);
  const old = s2.fetchUsage({ force: true }), recent = s2.fetchUsage({ force: true });
  assert.equal(pending.length, 3, "une relecture forcée ne réutilise pas la requête en vol");
  pending[2]({ usedBytes: 5, maxBytes: 9 }); await recent;
  pending[1]({ usedBytes: 3, maxBytes: 9 }); await old;
  assert.equal(s2.usage().usedBytes, 5, "une réponse plus ancienne n'écrase pas la plus récente");

  // Réponses invalides.
  for (const bad of [null, {}, { usedBytes: -1, maxBytes: 5 }, { usedBytes: "1", maxBytes: 5 }, { usedBytes: 1 }, { usedBytes: NaN, maxBytes: 2 }]) {
    const e = makeEnv(); e.api = async () => bad;
    await assert.rejects(e.make().fetchUsage(), /Quota de stockage non reconnu\./);
  }
}

async function testRemove() {
  const env = makeEnv();
  const store = env.make();
  await store.loadMore(); await store.fetchUsage();
  const events = []; store.subscribe(event => events.push(event.type));

  env.deleteResult = false;
  await assert.rejects(store.remove("a"), /Suppression non confirmée par le serveur\./);
  eq(ids(store), ["a", "b"], "non confirmé : le fichier reste");

  env.deleteResult = true; env.usedBytes = 4;
  const [r1, r2] = await Promise.all([store.remove("a"), store.remove("a")]);
  eq({ ...r1 }, { deleted: true }); eq({ ...r2 }, { deleted: true });
  assert.equal(env.calls.filter(call => call === "DELETE /filesv2/a").length, 2, "1 refus + 1 suppression : la double demande est partagée");
  eq(ids(store), ["b"]);
  assert.equal(store.usage().usedBytes, 4, "le quota est relu après suppression");
  assert.ok(events.includes("files") && events.includes("usage"));

  // Identifiant encodé ; erreur réseau : le fichier reste.
  env.api = async (p, o) => { if (o?.method === "DELETE") throw new Error("hors ligne"); return makeEnv().api(p, o); };
  await assert.rejects(store.remove("b"), /hors ligne/);
  eq(ids(store), ["b"]);
  const seen = []; env.api = async (p, o) => { seen.push(p); return o?.method === "DELETE" ? { deleted: true } : { usedBytes: 1, maxBytes: 2 }; };
  await store.remove("a/../b?x");
  assert.equal(seen[0], "/filesv2/" + encodeURIComponent("a/../b?x"));

  // Échec du quota après suppression : la suppression reste acquise.
  const env2 = makeEnv(); const s2 = env2.make(); await s2.loadMore();
  const base = env2.api; env2.api = async (p, o) => { if (p === "/filesv2/usage") throw new Error("quota KO"); return base(p, o); };
  await s2.remove("a");
  eq(ids(s2), ["b"]);

  // Suppression terminée après un changement de session : rien n'est modifié dans la nouvelle.
  const env3 = makeEnv(); const gate = deferred(); const b3 = env3.api;
  env3.api = (p, o) => o?.method === "DELETE" ? gate.promise : b3(p, o);
  const s3 = env3.make(); await s3.loadMore();
  const removing = s3.remove("a");
  env3.session = "s2"; env3.pages["/filesv2?limit=2"] = { data: [{ id: "a", filename: "autre compte" }], has_more: false, last_id: "a" };
  await s3.loadMore();
  gate.resolve({ deleted: true }); await removing;
  eq(ids(s3), ["a"], "le fichier du nouveau compte n'est pas retiré");
}

async function testUploadsAndForeground() {
  const env = makeEnv();
  const store = env.make();
  const events = []; const off = store.subscribe(event => events.push(event.type));
  assert.equal(store.noteUploaded({ id: "up0" }), true);
  eq(ids(store), [], "liste non chargée : l'envoi y figurera au premier chargement");
  await store.loadMore();
  assert.equal(store.noteUploaded({ id: "up1", filename: "nouveau.pdf", bytes: 3 }), true);
  eq(ids(store), ["up1", "a", "b"]);
  assert.equal(store.noteUploaded({ id: "a", filename: "cours.pdf", bytes: 99 }), true);
  eq(ids(store), ["a", "up1", "b"], "un identifiant déjà connu est remplacé, pas dupliqué");
  assert.equal(store.get("a").bytes, 99);
  assert.equal(store.isStale(), false);
  assert.equal(store.noteUploaded({ filename: "sans id" }), false);
  assert.equal(store.isStale(), true, "réponse sans identifiant : la liste est marquée périmée");
  off();
  const count = events.length; store.invalidate();
  assert.equal(events.length, count, "désinscrit : plus d'événement");

  // Retour au premier plan.
  const handlers = {}; const doc = { visibilityState: "hidden", addEventListener: (n, h) => { handlers[n] = h; }, removeEventListener: n => { delete handlers[n]; } };
  const s2 = env.make(); await s2.loadMore();
  const detach = s2.watchForeground(doc);
  handlers.visibilitychange(); assert.equal(s2.isStale(), false, "masqué : rien ne change");
  doc.visibilityState = "visible"; handlers.visibilitychange(); assert.equal(s2.isStale(), true);
  detach(); assert.equal(handlers.visibilitychange, undefined);
  assert.equal(typeof s2.watchForeground(null), "function");

  // Un écouteur qui plante ne bloque pas les autres.
  const s3 = env.make(); const seen = [];
  s3.subscribe(() => { throw new Error("boom"); }); s3.subscribe(event => seen.push(event.type));
  await s3.loadMore();
  eq(seen, ["files"]);
  assert.throws(() => s3.subscribe(null), /Un écouteur est requis/);
}

async function testSessionResetAndShared() {
  const env = makeEnv();
  const store = env.make();
  const events = []; store.subscribe(event => events.push(event.type));
  await store.loadMore(); await store.fetchUsage();
  env.session = "s2";
  eq(ids(store), [], "le cache d'un autre compte n'est jamais exposé");
  assert.equal(store.usage(), null);
  assert.ok(events.includes("reset"));
  env.session = "s1"; await tick();
  eq(ids(store), [], "revenir à l'ancienne session ne ressuscite pas l'ancien cache");

  const api = load();
  const one = api.getShared({ api: async () => ({}), getSession: () => "x" });
  assert.equal(api.getShared({ api: async () => { throw new Error("autre"); }, getSession: () => "y" }), one, "instance unique");
  assert.equal(api.peekShared(), one);
  assert.equal(load().peekShared(), null);
}

function testArrange() {
  const api = load();
  const kinds = { "a.PNG": "image", "b.heic": "image", "c.svg": "image", "d.pdf": "document", "e.DOCX": "document", "f.pptx": "presentation", "g.py": "code", "h.json": "code", "i.zip": "other", "sans-extension": "other" };
  for (const [name, kind] of Object.entries(kinds)) assert.equal(api.fileKind(name), kind, name);
  assert.equal(api.fileKind(undefined), "other");
  assert.equal(api.fileKind(42), "other");

  const files = [
    { id: "1", filename: "Résumé cours.pdf", bytes: 500, created_at: 1700000100 },
    { id: "2", filename: "photo.png", bytes: 90, created_at: 1700000300 },
    { id: "3", filename: "script.py", bytes: 90, created_at: 1700000200 },
    { id: "4", filename: "inconnu.bin" },
    { id: "5", filename: "Cours 10.docx", bytes: 7000, created_at: 1700000000 },
    { id: "6", filename: "cours 2.docx", bytes: 12, created_at: 1700000400 }
  ];
  const snapshot = JSON.stringify(files);
  const order = options => api.arrange(files, options).map(file => file.id);

  eq(order(), ["6", "2", "3", "1", "5", "4"], "tri par défaut : plus récents d'abord, date absente en dernier");
  eq(order({ sort: "date-asc" }), ["5", "1", "3", "2", "6", "4"], "date croissante, valeur absente toujours en dernier");
  eq(order({ sort: "size-desc" }), ["5", "1", "2", "3", "6", "4"], "taille décroissante, ex æquo dans l'ordre d'origine");
  eq(order({ sort: "size-asc" }), ["6", "2", "3", "1", "5", "4"], "taille croissante, ex æquo stables");
  const byName = api.arrange(files, { sort: "name-asc" }).map(file => file.filename);
  assert.ok(byName.indexOf("cours 2.docx") < byName.indexOf("Cours 10.docx"), "tri naturel : 2 avant 10, sans tenir compte de la casse");
  eq(api.arrange(files, { sort: "name-desc" }).map(file => file.id), [...byName].reverse().map(name => files.find(file => file.filename === name).id));
  eq(order({ sort: "inconnu" }), plain(order()), "tri inconnu : repli sur la date");

  eq(order({ query: "RESUME" }), ["1"], "recherche sans accents ni casse");
  eq(order({ query: "  cours " }), ["6", "1", "5"], "espaces ignorés autour de la requête");
  eq(order({ query: "zzz" }), []);
  eq(order({ kind: "document" }), ["6", "1", "5"]);
  eq(order({ kind: "image" }), ["2"]);
  eq(order({ kind: "other" }), ["4"]);
  eq(order({ kind: "document", query: "10", sort: "size-asc" }), ["5"], "filtres combinés");
  eq(order({ kind: "*" }), plain(order()));
  assert.equal(JSON.stringify(files), snapshot, "arrange ne modifie jamais la liste d'origine");
  assert.notEqual(api.arrange(files), files, "une nouvelle liste est renvoyée");
}

(async () => {
  testArrange();
  await testPaginationAndIdentity();
  await testErrors();
  await testInflightAndStaleResponses();
  await testReloadAndFreshness();
  await testUsage();
  await testRemove();
  await testUploadsAndForeground();
  await testSessionResetAndShared();
  console.log("Couche de données fichiers : identité par id, pagination, requêtes partagées, réponses périmées, quota, suppression confirmée, session et premier plan vérifiés.");
})().catch(error => { console.error(error); process.exitCode = 1; });
