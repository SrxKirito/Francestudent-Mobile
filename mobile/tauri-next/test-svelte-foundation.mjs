// Tests des fondations Svelte (état persistant, nettoyage de session, jeton d'accès).
// Les modules .ts sont chargés tels quels par Node (suppression des types native).
import assert from "node:assert/strict";
import { parseStoredState, serializeState, patchStoredState, STORE_KEY, DEFAULT_AGENT_ID } from "./src/lib/utils/state.ts";
import { errorMessage } from "./src/lib/utils/errors.ts";
import { applyTheme, themeAttribute } from "./src/lib/utils/theme.ts";
import { cleanSession } from "./src/lib/utils/session.ts";
import { createTokenProvider, AuthError, TOKEN_MARGIN_MS } from "./src/lib/services/auth.ts";

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

const makeId = () => "device-test";

// --- parseStoredState ---------------------------------------------------------
await test("clé de stockage et agent par défaut conservés", () => {
  assert.equal(STORE_KEY, "fs-chat-state");
  assert.equal(DEFAULT_AGENT_ID, -1002);
});

await test("valeurs par défaut quand rien n'est stocké", () => {
  const state = parseStoredState(null, makeId);
  assert.equal(state.session, "");
  assert.equal(state.deviceId, "device-test");
  assert.equal(state.agentId, -1002);
  assert.equal(state.defaultAgentId, null);
  assert.equal(state.webSearch, false);
  assert.equal(state.webSearchMode, "open");
  assert.equal(state.libraryColumns, 3);
  assert.equal(state.imageTool, true);
  assert.equal(state.studyMode, "");
  assert.equal(state.imageModel, "gpt-image-2.5-flare");
  assert.equal(state.theme, "system");
  assert.equal(state.profile, null);
  assert.equal(state.avatar, "");
  assert.deepEqual(state.conversations, []);
  assert.equal(state.powerpointMode, false);
});

await test("JSON corrompu ou non objet retombe sur les défauts", () => {
  for (const raw of ["{pas du json", "null", "42", '"texte"', ""]) {
    const state = parseStoredState(raw, makeId);
    assert.equal(state.agentId, -1002, raw);
    assert.equal(state.deviceId, "device-test", raw);
  }
});

await test("valeurs invalides rejetées, valeurs valides conservées", () => {
  const state = parseStoredState(
    JSON.stringify({
      session: 12,
      deviceId: "",
      agentId: "abc",
      webSearchMode: "hack",
      libraryColumns: 9,
      studyMode: "inconnu",
      imageModel: "autre",
      theme: "neon",
      avatar: "http://exemple.fr/a.png",
      profile: "texte",
      conversations: "pas un tableau"
    }),
    makeId
  );
  assert.equal(state.session, "");
  assert.equal(state.deviceId, "device-test");
  assert.equal(state.agentId, -1002);
  assert.equal(state.webSearchMode, "open");
  assert.equal(state.libraryColumns, 3);
  assert.equal(state.studyMode, "");
  assert.equal(state.imageModel, "gpt-image-2.5-flare");
  assert.equal(state.theme, "system");
  assert.equal(state.avatar, "");
  assert.equal(state.profile, null);
  assert.deepEqual(state.conversations, []);

  const valid = parseStoredState(
    JSON.stringify({
      session: "abc",
      deviceId: "mon-appareil",
      agentId: 7,
      webSearch: true,
      webSearchMode: "filtered",
      libraryColumns: 4,
      studyMode: "quiz",
      imageModel: "gpt-image-2",
      theme: "dark",
      avatar: "data:image/png;base64,AAAA",
      profile: { name: "Léa" },
      imageTool: false,
      conversations: [{ id: "c1" }]
    }),
    makeId
  );
  assert.equal(valid.session, "abc");
  assert.equal(valid.deviceId, "mon-appareil");
  assert.equal(valid.agentId, 7);
  assert.equal(valid.webSearch, true);
  assert.equal(valid.webSearchMode, "filtered");
  assert.equal(valid.libraryColumns, 4);
  assert.equal(valid.studyMode, "quiz");
  assert.equal(valid.imageModel, "gpt-image-2");
  assert.equal(valid.theme, "dark");
  assert.equal(valid.avatar, "data:image/png;base64,AAAA");
  assert.deepEqual(valid.profile, { name: "Léa" });
  assert.equal(valid.imageTool, false);
  assert.deepEqual(valid.conversations, [{ id: "c1" }]);
});

await test("les cinq modèles d'image du moteur historique sont relus tels quels", () => {
  const models = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"];
  for (const imageModel of models) {
    assert.equal(parseStoredState(JSON.stringify({ imageModel }), makeId).imageModel, imageModel, imageModel);
  }
  assert.equal(parseStoredState(JSON.stringify({ imageModel: "gpt-image-3" }), makeId).imageModel, "gpt-image-2.5-flare");
});

await test("defaultAgentId sert d'agentId quand agentId manque", () => {
  const state = parseStoredState(JSON.stringify({ defaultAgentId: 55 }), makeId);
  assert.equal(state.defaultAgentId, 55);
  assert.equal(state.agentId, 55);
  const both = parseStoredState(JSON.stringify({ defaultAgentId: 55, agentId: 8 }), makeId);
  assert.equal(both.agentId, 8);
});

await test("le mode PowerPoint n'est jamais restauré", () => {
  assert.equal(parseStoredState(JSON.stringify({ powerpointMode: true }), makeId).powerpointMode, false);
});

// --- serializeState -----------------------------------------------------------
await test("serializeState vide les conversations quand IndexedDB les porte", () => {
  const state = parseStoredState(JSON.stringify({ conversations: [{ id: "c1" }] }), makeId);
  assert.deepEqual(JSON.parse(serializeState(state, true)).conversations, []);
  assert.deepEqual(JSON.parse(serializeState(state, false)).conversations, [{ id: "c1" }]);
  assert.deepEqual(state.conversations, [{ id: "c1" }], "l'état d'origine n'est pas modifié");
});

await test("aller-retour parse(serialize(état)) stable", () => {
  const first = parseStoredState(JSON.stringify({ theme: "light", libraryColumns: 2, agentId: 3 }), makeId);
  const second = parseStoredState(serializeState(first, false), makeId);
  assert.deepEqual(second, first);
});

await test("serializeState n'écrit jamais le cookie de session", () => {
  const state = parseStoredState(JSON.stringify({ session: "cookie-secret", theme: "dark" }), makeId);
  assert.equal(state.session, "cookie-secret");
  for (const inIndexedDb of [true, false]) {
    const raw = serializeState(state, inIndexedDb);
    assert.ok(!raw.includes("cookie-secret"), "le cookie fuit dans le JSON");
    assert.ok(!("session" in JSON.parse(raw)));
    assert.equal(JSON.parse(raw).theme, "dark");
  }
});

// --- patchStoredState ---------------------------------------------------------
await test("patchStoredState conserve clés inconnues et conversations", () => {
  const raw = JSON.stringify({ theme: "light", futur: { a: 1 }, conversations: [{ id: "c1" }, { id: "c2" }] });
  const next = JSON.parse(patchStoredState(raw, { deviceId: "d1", webSearchMode: "filtered" }));
  assert.deepEqual(next.futur, { a: 1 });
  assert.deepEqual(next.conversations, [{ id: "c1" }, { id: "c2" }]);
  assert.equal(next.theme, "light");
  assert.equal(next.deviceId, "d1");
  assert.equal(next.webSearchMode, "filtered");
});

await test("patchStoredState retire la copie en clair de la session", () => {
  const next = JSON.parse(patchStoredState(JSON.stringify({ session: "cookie-secret", theme: "dark" }), { deviceId: "d1" }));
  assert.ok(!("session" in next));
  assert.equal(next.theme, "dark");
});

await test("patchStoredState ne crée pas de conversations absentes", () => {
  const next = JSON.parse(patchStoredState(null, { deviceId: "d1" }));
  assert.ok(!("conversations" in next), "écrire conversations: [] casserait la migration vers IndexedDB");
  assert.deepEqual(next, { deviceId: "d1" });
});

await test("patchStoredState : JSON corrompu, tableau ou nul → objet neuf", () => {
  for (const raw of ["{pas du json", "[1,2]", "null", "42", ""]) {
    assert.deepEqual(JSON.parse(patchStoredState(raw, { deviceId: "d1" })), { deviceId: "d1" }, raw);
  }
});

await test("patchStoredState peut remettre profile à null", () => {
  const next = JSON.parse(patchStoredState(JSON.stringify({ profile: { name: "A" } }), { profile: null }));
  assert.equal(next.profile, null);
});

// --- errorMessage / thème -----------------------------------------------------
await test("errorMessage lit la chaîne Rust ou le message d'une Error", () => {
  assert.equal(errorMessage("HTTP 500"), "HTTP 500");
  assert.equal(errorMessage(new Error("boum")), "boum");
  assert.equal(errorMessage({ message: "objet" }), "objet");
  assert.equal(errorMessage(null), "null");
  assert.equal(errorMessage(new Error("")), "Error");
});

await test("thème : « système » retire data-theme, clair/sombre le posent", () => {
  assert.equal(themeAttribute("light"), "light");
  assert.equal(themeAttribute("dark"), "dark");
  for (const value of ["system", "", undefined, null, "auto", 3]) assert.equal(themeAttribute(value), null, String(value));
  const attrs = new Map();
  const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k) };
  applyTheme("dark", root);
  assert.equal(attrs.get("data-theme"), "dark");
  applyTheme("system", root);
  assert.equal(attrs.has("data-theme"), false);
});

// --- cleanSession -------------------------------------------------------------
await test("cleanSession retire guillemets et préfixe du cookie", () => {
  assert.equal(cleanSession('"next-auth.session-token=abc"'), "abc");
  assert.equal(cleanSession("  __Secure-next-auth.session-token=xyz  "), "xyz");
  assert.equal(cleanSession("'valeur'"), "valeur");
  assert.equal(cleanSession("brut"), "brut");
  assert.equal(cleanSession(null), "");
  assert.equal(cleanSession(undefined), "");
});

// --- createTokenProvider ------------------------------------------------------
function provider({ session = "cookie", exchange, clock } = {}) {
  let time = clock ?? 1_000_000;
  const calls = [];
  const api = createTokenProvider({
    exchange: async (s, d) => {
      calls.push([s, d]);
      return exchange(calls.length);
    },
    getSession: () => session,
    getDeviceId: () => "dev",
    now: () => time
  });
  return { api, calls, advance: ms => { time += ms; } };
}

await test("jeton mis en cache jusqu'à la marge de 60 s", async () => {
  const { api, calls, advance } = provider({ exchange: n => ({ accessToken: `t${n}`, expiresIn: 300 }) });
  assert.equal(await api.getAccessToken(), "t1");
  assert.equal(await api.getAccessToken(), "t1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["cookie", "dev"]);
  advance(300_000 - TOKEN_MARGIN_MS - 1000);
  assert.equal(await api.getAccessToken(), "t1");
  advance(2000);
  assert.equal(await api.getAccessToken(), "t2");
  assert.equal(calls.length, 2);
});

await test("force et invalidate déclenchent un nouvel échange", async () => {
  const { api, calls } = provider({ exchange: n => ({ accessToken: `t${n}`, expiresIn: 300 }) });
  await api.getAccessToken();
  assert.equal(await api.getAccessToken(true), "t2");
  api.invalidate();
  assert.equal(await api.getAccessToken(), "t3");
  assert.equal(calls.length, 3);
});

await test("expiresAt en secondes prime sur expiresIn", async () => {
  const { api, calls } = provider({
    clock: 1_000_000,
    exchange: n => ({ accessToken: `t${n}`, expiresAt: 1_000 + 1000, expiresIn: 1 })
  });
  // expiresAt = 2000 s = 2 000 000 ms ; il reste 1 000 000 ms, bien au-delà de la marge
  assert.equal(await api.getAccessToken(), "t1");
  assert.equal(await api.getAccessToken(), "t1");
  assert.equal(calls.length, 1);
});

await test("durée par défaut de 300 s sans expiration fournie", async () => {
  const { api, calls, advance } = provider({ exchange: n => ({ accessToken: `t${n}` }) });
  await api.getAccessToken();
  advance(239_000);
  await api.getAccessToken();
  assert.equal(calls.length, 1);
  advance(2000);
  await api.getAccessToken();
  assert.equal(calls.length, 2);
});

await test("absence de session → AuthError sans appel réseau", async () => {
  const { api, calls } = provider({ session: "", exchange: () => ({ accessToken: "x" }) });
  await assert.rejects(api.getAccessToken(), error => error instanceof AuthError && error.auth === true);
  assert.equal(calls.length, 0);
});

await test("HTTP 401 et 403 → AuthError", async () => {
  for (const status of [401, 403]) {
    const { api } = provider({ exchange: () => { throw new Error(`HTTP ${status}`); } });
    await assert.rejects(api.getAccessToken(), error => error instanceof AuthError && /reconnecte-toi/.test(error.message));
  }
});

await test("autre erreur → message de connexion impossible, pas AuthError", async () => {
  const { api } = provider({ exchange: () => { throw new Error("HTTP 500"); } });
  await assert.rejects(api.getAccessToken(), error => !(error instanceof AuthError) && /Connexion au serveur impossible/.test(error.message) && /HTTP 500/.test(error.message));
  const text = provider({ exchange: () => { throw "réseau coupé"; } });
  await assert.rejects(text.api.getAccessToken(), /réseau coupé/);
});

await test("HTTP 4011 n'est pas pris pour une 401", async () => {
  const { api } = provider({ exchange: () => { throw new Error("HTTP 4011"); } });
  await assert.rejects(api.getAccessToken(), error => !(error instanceof AuthError));
});

await test("jeton absent ou vide → AuthError", async () => {
  for (const reply of [{}, { accessToken: "" }, { accessToken: 5 }, null]) {
    const { api } = provider({ exchange: () => reply });
    await assert.rejects(api.getAccessToken(), error => error instanceof AuthError, JSON.stringify(reply));
  }
});

console.log(`test-svelte-foundation : ${count} tests réussis`);
