// Tests du cycle de vie de la session (démarrage, connexion, déconnexion) sur de faux Keychain / localStorage.
import assert from "node:assert/strict";
import { createSessionFlow } from "./src/lib/services/session-flow.ts";
import { STORE_KEY } from "./src/lib/utils/state.ts";

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

/** Faux Keychain : `fail` fait échouer une opération, `corruptWrite` altère la prochaine écriture seulement. */
function fakeSecure(initial = null) {
  const secure = {
    value: initial,
    fail: { read: false, write: false, delete: false },
    corruptWrite: false,
    writes: [],
    async read() {
      if (secure.fail.read) throw "Keychain illisible";
      return secure.value;
    },
    async write(value) {
      if (secure.fail.write) throw "Keychain plein";
      secure.writes.push(value);
      secure.value = secure.corruptWrite ? "autre-valeur" : value;
      secure.corruptWrite = false;
    },
    async delete() {
      if (secure.fail.delete) throw "Keychain verrouillé";
      secure.value = null;
    }
  };
  return secure;
}

/** Faux localStorage qui garde l'historique de toutes les valeurs écrites. */
function fakeStorage(initial) {
  const map = new Map(initial === undefined ? [] : [[STORE_KEY, initial]]);
  const history = [];
  return {
    history,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      if (storage.full) throw new Error("QuotaExceededError");
      history.push(value);
      map.set(key, value);
    },
    get stored() {
      return map.get(STORE_KEY);
    }
  };
}
let storage;

function setup({ stored, session = null, exchange, loginWithPassword } = {}) {
  storage = fakeStorage(stored === undefined ? undefined : JSON.stringify(stored));
  const secure = fakeSecure(session);
  const exchanges = [];
  const warnings = [];
  const flow = createSessionFlow({
    secure,
    exchange: exchange ?? (async (cookie, deviceId) => {
      exchanges.push({ cookie, deviceId });
      return { accessToken: "jeton-" + cookie, expiresIn: 600 };
    }),
    loginWithPassword: loginWithPassword ?? (async () => "cookie-mot-de-passe"),
    storage,
    storeKey: STORE_KEY,
    makeId: () => "appareil-neuf",
    warn: message => warnings.push(message)
  });
  return { flow, secure, exchanges, warnings, saved: () => JSON.parse(storage.stored) };
}

await test("la session vérifiée conserve un cloisonnement stable sans profil et le change au changement de compte", async () => {
  const { flow, saved } = setup({ session: "cookie-un" });
  assert.equal(await flow.tokens.localScope(), "");
  assert.equal((await flow.start()).screen, "app");
  const original = await flow.tokens.localScope();
  assert.match(original, /^session:[0-9a-f]{64}$/);
  assert.equal(await flow.tokens.localScope(), original);
  assert.doesNotMatch(JSON.stringify(saved()), /cookie-un|session:[0-9a-f]{64}/);
  await flow.loginWithCookie("cookie-deux");
  assert.notEqual(await flow.tokens.localScope(), original);
  await flow.logout();
  assert.equal(await flow.tokens.localScope(), "");
});

const failing = message => async () => { throw new Error(message); };

// --- démarrage -----------------------------------------------------------------
await test("sans session : écran de connexion, aucun échange, identifiant d'appareil fixé", async () => {
  const { flow, exchanges, saved } = setup();
  assert.deepEqual(await flow.start(), { screen: "login", message: "" });
  assert.equal(exchanges.length, 0);
  assert.equal(saved().deviceId, "appareil-neuf");
});

await test("session dans le Keychain : écran principal après un seul échange", async () => {
  const { flow, exchanges } = setup({ stored: { deviceId: "tel-1" }, session: "cookie-ok" });
  assert.deepEqual(await flow.start(), { screen: "app", message: "" });
  assert.deepEqual(exchanges, [{ cookie: "cookie-ok", deviceId: "tel-1" }]);
  assert.equal(await flow.tokens.getAccessToken(), "jeton-cookie-ok", "jeton réutilisé sans nouvel échange");
  assert.equal(exchanges.length, 1);
});

await test("démarrage : le démarrage ne touche ni aux conversations ni aux clés inconnues", async () => {
  const { flow, saved } = setup({ stored: { theme: "dark", futur: [1], conversations: [{ id: "c1" }] }, session: "cookie-ok" });
  await flow.start();
  assert.equal(saved().theme, "dark");
  assert.deepEqual(saved().futur, [1]);
  assert.deepEqual(saved().conversations, [{ id: "c1" }]);
});

await test("démarrage sans réglages : n'invente pas de conversations vides", async () => {
  const { flow, saved } = setup();
  await flow.start();
  assert.ok(!("conversations" in saved()));
});

await test("session en clair dans localStorage : migrée vers le Keychain puis retirée du stockage", async () => {
  const { flow, secure, saved } = setup({ stored: { session: "cookie-clair", theme: "light", conversations: [{ id: "c1" }] } });
  assert.deepEqual(await flow.start(), { screen: "app", message: "" });
  assert.equal(secure.value, "cookie-clair");
  assert.ok(!("session" in saved()));
  assert.equal(saved().theme, "light");
  assert.deepEqual(saved().conversations, [{ id: "c1" }]);
});

await test("même session en clair et dans le Keychain : copie en clair retirée", async () => {
  const { flow, secure, saved } = setup({ stored: { session: "cookie-ok" }, session: "cookie-ok" });
  assert.equal((await flow.start()).screen, "app");
  assert.equal(secure.value, "cookie-ok");
  assert.ok(!("session" in saved()));
});

await test("deux sessions différentes : on n'écrase rien, données conservées", async () => {
  const { flow, secure, saved, exchanges } = setup({ stored: { session: "ancienne" }, session: "nouvelle" });
  const result = await flow.start();
  assert.equal(result.screen, "login");
  assert.match(result.message, /^Stockage sécurisé indisponible : Deux sessions locales différentes/);
  assert.equal(secure.value, "nouvelle");
  assert.equal(secure.writes.length, 0);
  assert.equal(saved().session, "ancienne", "la copie en clair est gardée pour ne rien perdre");
  assert.equal(exchanges.length, 0);
});

await test("Keychain illisible : connexion refusée avec le motif, aucun échange", async () => {
  const { flow, secure, exchanges } = setup({ stored: {}, session: "cookie-ok" });
  secure.fail.read = true;
  assert.deepEqual(await flow.start(), { screen: "login", message: "Stockage sécurisé indisponible : Keychain illisible" });
  assert.equal(exchanges.length, 0);
  await assert.rejects(flow.loginWithCookie("autre"), /Stockage sécurisé indisponible/, "aucune connexion tant que le Keychain est HS");
  assert.equal(exchanges.length, 0);
});

await test("migration impossible (écriture Keychain refusée) : la copie en clair est conservée", async () => {
  const { flow, secure, saved } = setup({ stored: { session: "cookie-clair" } });
  secure.fail.write = true;
  const result = await flow.start();
  assert.equal(result.screen, "login");
  assert.match(result.message, /Keychain plein/);
  assert.equal(saved().session, "cookie-clair");
});

await test("session expirée (401) : retour à la connexion avec le message", async () => {
  const { flow } = setup({ stored: {}, session: "perimee", exchange: failing("HTTP 401") });
  assert.deepEqual(await flow.start(), { screen: "login", message: "Session refusée ou expirée : reconnecte-toi." });
});

await test("jeton absent : retour à la connexion", async () => {
  const { flow } = setup({ stored: {}, session: "vide", exchange: async () => ({}) });
  const result = await flow.start();
  assert.equal(result.screen, "login");
  assert.match(result.message, /Aucun jeton reçu/);
});

await test("panne réseau au démarrage : on ouvre quand même l'application", async () => {
  const { flow } = setup({ stored: {}, session: "cookie-ok", exchange: failing("réseau coupé") });
  assert.deepEqual(await flow.start(), { screen: "app", message: "" });
});

await test("réglages impossibles à écrire (stockage plein) : avertissement, session toujours en sécurité", async () => {
  const { flow, secure, warnings } = setup({ stored: { session: "cookie-clair" } });
  storage.full = true;
  const result = await flow.start();
  assert.equal(result.screen, "app");
  assert.equal(secure.value, "cookie-clair");
  assert.equal(warnings.length, 1);
});

// --- connexion -----------------------------------------------------------------
await test("connexion par cookie : échange unique, Keychain écrit, défauts remis si la session change", async () => {
  const { flow, secure, saved, exchanges } = setup({ stored: { webSearchMode: "disabled", customInstructionsManaged: true, deviceId: "tel-1" } });
  await flow.start();
  assert.equal(await flow.loginWithCookie('"next-auth.session-token=abc"'), true);
  assert.deepEqual(exchanges, [{ cookie: "abc", deviceId: "tel-1" }]);
  assert.equal(secure.value, "abc");
  assert.equal(saved().webSearchMode, "open");
  assert.equal(saved().customInstructionsManaged, false);
  assert.equal(saved().fileInstrSynced, false);
  assert.equal(await flow.tokens.getAccessToken(), "jeton-abc");
  assert.equal(exchanges.length, 1, "le jeton obtenu pendant l'activation est réutilisé");
});

await test("reconnexion avec la même session : les réglages sont conservés", async () => {
  const { flow, saved } = setup({ stored: { webSearchMode: "filtered" }, session: "cookie-ok" });
  await flow.start();
  await flow.loginWithCookie("cookie-ok");
  assert.equal(saved().webSearchMode, "filtered");
});

await test("cookie vide une fois nettoyé : rien n'est tenté", async () => {
  const { flow, exchanges, secure } = setup();
  await flow.start();
  assert.equal(await flow.loginWithCookie('  ""  '), false);
  assert.equal(await flow.loginWithCookie(""), false);
  assert.equal(exchanges.length, 0);
  assert.equal(secure.writes.length, 0);
});

await test("connexion par mot de passe : le cookie obtenu est activé", async () => {
  const calls = [];
  const { flow, secure } = setup({ loginWithPassword: async (email, password) => { calls.push([email, password]); return "cookie-mdp"; } });
  await flow.start();
  await flow.loginWithPassword("a@b.fr", " mot de passe ");
  assert.deepEqual(calls, [["a@b.fr", " mot de passe "]]);
  assert.equal(secure.value, "cookie-mdp");
});

await test("échec du mot de passe : rien n'est écrit, l'erreur remonte telle quelle", async () => {
  const { flow, secure, exchanges } = setup({ loginWithPassword: failing("Identifiants incorrects") });
  await flow.start();
  await assert.rejects(flow.loginWithPassword("a@b.fr", "x"), /Identifiants incorrects/);
  assert.equal(secure.value, null);
  assert.equal(exchanges.length, 0);
});

await test("échec de l'échange : session et Keychain inchangés, jeton de l'ancienne session conservé", async () => {
  const exchanges = [];
  const { flow, secure } = setup({
    stored: {},
    session: "bonne",
    exchange: async cookie => {
      exchanges.push(cookie);
      if (cookie === "mauvaise") throw new Error("HTTP 403");
      return { accessToken: "jeton-" + cookie, expiresIn: 600 };
    }
  });
  await flow.start();
  await assert.rejects(flow.loginWithCookie("mauvaise"), /Session refusée ou expirée/);
  assert.equal(secure.value, "bonne");
  assert.equal(secure.writes.length, 0);
  assert.equal(await flow.tokens.getAccessToken(true), "jeton-bonne", "la session candidate n'a pas fuité");
});

await test("écriture Keychain refusée pendant la connexion : erreur, ancien cookie conservé", async () => {
  const { flow, secure, saved } = setup({ stored: { webSearchMode: "disabled" }, session: "bonne" });
  await flow.start();
  secure.fail.write = true;
  await assert.rejects(flow.loginWithCookie("nouvelle"), /Keychain plein/);
  assert.equal(secure.value, "bonne");
  assert.equal(saved().webSearchMode, "disabled", "les réglages ne sont pas remis à zéro sur un échec");
  assert.equal(await flow.tokens.getAccessToken(true), "jeton-bonne");
});

await test("relecture Keychain différente : restauration de l'ancien cookie et erreur", async () => {
  const { flow, secure } = setup({ stored: {}, session: "bonne" });
  await flow.start();
  secure.corruptWrite = true;
  await assert.rejects(flow.loginWithCookie("nouvelle"), /pas été confirmée/);
  secure.corruptWrite = false;
  assert.equal(secure.value, "bonne");
  assert.deepEqual(secure.writes, ["nouvelle", "bonne"]);
});

await test("la connexion exige un démarrage réussi du stockage sécurisé", async () => {
  const { flow, exchanges } = setup();
  await assert.rejects(flow.loginWithCookie("abc"), /Stockage sécurisé indisponible/);
  assert.equal(exchanges.length, 0);
});

// --- déconnexion ---------------------------------------------------------------
await test("déconnexion : Keychain vidé, profil et réglages liés remis à zéro, reste conservé", async () => {
  const { flow, secure, saved } = setup({
    stored: { profile: { nom: "A" }, webSearchMode: "disabled", customInstructionsManaged: true, theme: "dark", conversations: [{ id: "c1" }] },
    session: "cookie-ok"
  });
  await flow.start();
  await flow.logout();
  assert.equal(secure.value, null);
  assert.equal(saved().profile, null);
  assert.equal(saved().webSearchMode, "open");
  assert.equal(saved().customInstructionsManaged, false);
  assert.equal(saved().theme, "dark");
  assert.deepEqual(saved().conversations, [{ id: "c1" }]);
  await assert.rejects(flow.tokens.getAccessToken(true), error => error.auth === true, "plus de session après déconnexion");
});

await test("déconnexion impossible (Keychain verrouillé) : on reste connecté, rien n'est effacé", async () => {
  const { flow, secure, saved } = setup({ stored: { profile: { nom: "A" } }, session: "cookie-ok" });
  await flow.start();
  secure.fail.delete = true;
  await assert.rejects(flow.logout(), /^Error: Déconnexion impossible : Keychain verrouillé$/);
  assert.equal(secure.value, "cookie-ok");
  assert.deepEqual(saved().profile, { nom: "A" });
  assert.equal(await flow.tokens.getAccessToken(true), "jeton-cookie-ok");
});

// --- invariant -----------------------------------------------------------------
await test("le cookie n'est jamais écrit dans localStorage, quel que soit le parcours", async () => {
  const { flow } = setup({ stored: { session: "cookie-clair" } });
  await flow.start();
  await flow.loginWithCookie("cookie-secret-2");
  await flow.logout();
  for (const value of storage.history) {
    assert.ok(!value.includes("cookie-clair") && !value.includes("cookie-secret-2"), value);
  }
  assert.ok(storage.history.length >= 3);
});

console.log(`test-svelte-session : ${count} tests réussis`);
