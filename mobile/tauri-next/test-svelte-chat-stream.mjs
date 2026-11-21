// Tests du service de streaming typé (src/lib/services/chat-stream.ts).
// Référence : le VRAI code de mobile/www/js/stream.js, exécuté dans un contexte vm (parseur SSE, messages d'erreur,
// collecte des sources et des images, et `streamChatRequest` complet avec un faux serveur). Aucun accès réseau.
// Limite : ceci valide la logique sous Node, pas le comportement dans une WebView iOS/Android.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  collectGeneratedImages,
  collectSourceUrls,
  collectUuidCandidates,
  createSseParser,
  describeShape,
  describeStreamError,
  friendlyError,
  generatedImageKey,
  processChatStream,
  resumeStreamPath
} from "./src/lib/services/chat-stream.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "www", "js", "stream.js"), "utf8");

function slice(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `tranche introuvable : ${from} … ${to}`);
  return source.slice(start, end);
}

const navigator = { onLine: true };
const context = vm.createContext({ navigator, URL, TextDecoder, window: {}, console });
vm.runInContext(slice("function createSseParser", "const TYPING_HTML"), context);
vm.runInContext(slice("function friendlyError", "function updateNetworkBanner"), context);
vm.runInContext(slice("function collectSourceUrls", "async function fetchGeneratedImage"), context);
vm.runInContext(slice("async function streamChatRequest", "async function cancelStream"), context);

/** Les valeurs venant du contexte vm ont d'autres prototypes : on compare des copies JSON. */
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

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

// ---------------------------------------------------------------------------------------------------------------------
// 1. Parseur SSE : mêmes événements que l'original, quel que soit le découpage en morceaux.
// ---------------------------------------------------------------------------------------------------------------------
const SSE_SAMPLES = {
  "événements simples": "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n",
  "fins de ligne CRLF": "event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n",
  "commentaires ignorés": ": ping\n\nevent: a\n: encore\ndata: x\n\n",
  "data sur plusieurs lignes": "data: l1\ndata: l2\ndata:\ndata: l4\n\n",
  "id mémorisé d'un événement à l'autre": "id: 7\ndata: a\n\ndata: b\n\nid: 9\ndata: c\n\n",
  "id contenant NUL ignoré": "id: 5\ndata: a\n\nid: 6\u0000x\ndata: b\n\n",
  "champ sans deux-points": "data\n\ndata: z\n\n",
  "un seul espace retiré": "data:   trois\n\ndata:sans espace\n\n",
  "événement sans data : pas de dispatch": "event: vide\n\nevent: ok\ndata: 1\n\n",
  "nom d'événement remis à zéro": "event: a\ndata: 1\n\ndata: 2\n\n",
  "fin de flux sans ligne vide": "event: a\ndata: reste",
  "fin de flux sur CR final": "data: x\r",
  "champs inconnus et retry": "retry: 5000\nfoo: bar\ndata: ok\n\n",
  "UTF-8": "data: {\"t\":\"é à ü 你好 😀\"}\n\n",
  "deux-points dans la valeur": "data: http://x.fr:80/a\n\n",
  "[DONE]": "data: [DONE]\n\n"
};

function parseWith(factory, text, size) {
  const events = [];
  const parser = factory((name, payload, id) => events.push([name, payload, id]));
  if (size === 0) parser.feed(text);
  else for (let i = 0; i < text.length; i += size) parser.feed(text.slice(i, i + size));
  parser.end();
  return events;
}

for (const [label, text] of Object.entries(SSE_SAMPLES)) {
  await test(`SSE — ${label} : identique à createSseParser (découpages 0/1/2/3/5)`, () => {
    for (const size of [0, 1, 2, 3, 5]) {
      assert.deepEqual(parseWith(createSseParser, text, size), parseWith(context.createSseParser, text, size), `taille ${size}`);
    }
  });
}

await test("SSE — résultat attendu explicite (le parseur ne dépend pas que de l'original)", () => {
  assert.deepEqual(parseWith(createSseParser, "id: 4\nevent: x\ndata: a\ndata: b\n\n", 1), [["x", "a\nb", "4"]]);
  assert.deepEqual(parseWith(createSseParser, ": c\n\n", 0), []);
  assert.deepEqual(parseWith(createSseParser, "data: fin", 0), [["", "fin", ""]]);
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. Messages d'erreur.
// ---------------------------------------------------------------------------------------------------------------------
await test("describeStreamError : identique (grille de formes d'erreur)", () => {
  const cases = [null, undefined, 0, "", "texte", 12, { message: "m" }, { message: 5 }, { error: { message: "e" } }, { error: {} }, { x: 1 }, { big: "x".repeat(900) }, { message: "", error: { message: "interne" } }];
  for (const value of cases) assert.equal(describeStreamError(value), context.describeStreamError(value), JSON.stringify(value));
});

const typeError = new TypeError("boom");
const ERRORS = [
  null, undefined, "chaîne", new Error("x"), new Error(""), typeError,
  { message: "Failed to fetch" }, { message: "NetworkError when attempting" }, { message: "Load failed" }, { message: "réseau indisponible" }, { message: "request timed out" },
  { auth: true, message: "" }, { auth: true, message: "Session close" }, { upload: true }, { upload: true, message: "Refusé" },
  { code: "moderation_blocked", moderation: { moderation_stage: "output" } }, { code: "moderation_blocked", moderation: { moderation_stage: "input" } },
  { message: "CONTENT_POLICY_VIOLATION" }, { type: "image_generation_user_error" },
  { message: "insufficient_quota" }, { message: "You exceeded your quota exceeded" }, { message: "billing hard limit" },
  { message: "model is at capacity" }, { code: "rate_limit_exceeded" }, { message: "HTTP 429 : trop" }, { message: "too many requests" }, { type: "server_is_overloaded" },
  { message: "HTTP 502" }, { message: "HTTP 503 : x" }, { message: "GATEWAY_TIMEOUT" }, { message: "BAD_GATEWAY" },
  { status: 401 }, { status: 403, message: "x" }, { status: 413 }, { status: 429 }, { status: 500 }, { status: 599, message: "z" },
  { status: 404, message: "HTTP 404" }, { message: "HTTP 418 : théière" }, { message: "HTTP 500 : interne" }, { message: "erreur banale" }, { message: "" }
];
await test("friendlyError : identique à l'original (erreurs × état réseau true/false/inconnu)", () => {
  assert.ok(ERRORS.length >= 40);
  for (const online of [true, false, undefined]) {
    navigator.onLine = online;
    for (const error of ERRORS) {
      assert.equal(friendlyError(error, online), context.friendlyError(error), `online=${online} erreur=${JSON.stringify(error)}`);
    }
  }
  navigator.onLine = true;
});

await test("friendlyError : hors connexion prime sur les autres causes (sauf auth/upload)", () => {
  assert.match(friendlyError({ message: "HTTP 500" }, false), /Pas de connexion Internet/);
  assert.match(friendlyError({ auth: true, message: "expirée" }, false), /expirée/);
  assert.match(friendlyError({ status: 500 }, true), /HTTP 500/);
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. Sources et images.
// ---------------------------------------------------------------------------------------------------------------------
const BIG = "A".repeat(300);
const PNG = "iVBORw0KGgo" + BIG;
const JPG = "/9j/" + BIG;
const WEBP = "UklGR" + BIG;
const GIF = "R0lGOD" + BIG;
const U1 = "123e4567-e89b-12d3-a456-426614174000";
const U2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U3 = "11111111-2222-4333-8444-555555555555";

const nested = depth => (depth === 0 ? { url: "https://profond.example/x" } : { a: nested(depth - 1) });
const many = Array.from({ length: 55 }, (_, i) => ({ url: `https://site${i}.example/page`, title: `T${i}` }));

const SOURCE_CASES = {
  "web_search_call": { item: { type: "web_search_call", action: { sources: [{ url: "https://www.lemonde.fr/a?x=1#h", title: " Le Monde " }, { url: "https://lemonde.fr/a/" }] } } },
  "url_citation": { annotations: [{ type: "url_citation", url: "https://fr.wikipedia.org/wiki/Paris", title: "Paris" }] },
  "clé uri": { uri: "https://exemple.org/p", title: "Ex" },
  "domaines nus": { webSearchDomains: ["lemonde.fr", "www.lefigaro.fr", "pas un domaine", "x", "https://a.b.c/d"] },
  "listes de chaînes": { citations: ["https://c1.example/z"], links: ["c2.example"], unrelated: ["https://non.example"] },
  "rejets": [{ url: "ftp://x.example/a" }, { url: "https://sans-point/a" }, { url: "https://a.example/with space" }, { url: "https://" + "x".repeat(2100) + ".fr" }, { url: "   " }, { url: 12 }],
  "doublons (casse, fragment, requête, slash)": [{ url: "https://A.example/P" }, { url: "https://a.example/p/" }, { url: "https://a.example/p?q=1" }, { url: "https://a.example/p#f" }],
  "profondeur > 10": nested(12),
  "profondeur limite": nested(9),
  "plafond de 40 sources": many,
  "tableaux imbriqués": [[[{ url: "https://n1.example/a" }]], { sources: [{ uri: "https://n2.example/b" }] }],
  "rien": { text: "bonjour", n: 3 }
};
for (const [label, data] of Object.entries(SOURCE_CASES)) {
  await test(`sources — ${label} : identique à collectSourceUrls`, () => {
    const modern = [];
    const modernKeys = new Set();
    const legacySources = vm.runInContext("[]", context);
    const legacyKeys = vm.runInContext("new Set()", context);
    const addedModern = collectSourceUrls(data, modern, modernKeys);
    const addedLegacy = context.collectSourceUrls(data, legacySources, legacyKeys);
    assert.equal(addedModern, addedLegacy);
    assert.deepEqual(modern, plain(legacySources));
    assert.deepEqual([...modernKeys].sort(), [...legacyKeys].sort());
    // Un second passage ne rajoute rien (les clés sont conservées entre événements).
    assert.equal(collectSourceUrls(data, modern, modernKeys), context.collectSourceUrls(data, legacySources, legacyKeys));
  });
}
await test("sources — plafond : jamais plus de 40", () => {
  const sources = [];
  collectSourceUrls(many, sources, new Set());
  assert.equal(sources.length, 40);
});

const IMAGE_CASES = {
  "image_generation_call base64": { type: "image_generation_call", result: PNG },
  "base64 déjà en data URL": { type: "output_image", b64_json: "data:image/png;base64," + BIG },
  "partial_image ignorée": { type: "response.image_generation_call.partial_image", partial_image_b64: PNG },
  "type partial ignoré": { type: "image_generation_partial", result: PNG },
  "identifiant (UUID) seul": { type: "generated_image", imageId: U1 },
  "UUID dans result": { type: "image_generation_call", result: U1 },
  "UUID dans id (type image)": { type: "image", id: U2 },
  "id d'un image_generation_call n'est pas une image": { type: "image_generation_call", id: U2, status: "completed" },
  "URL absolue": { type: "image", url: "https://cdn.example/i.png" },
  "URL relative": { type: "image", url: "/files/i.png" },
  "image_url objet": { type: "input_image", image_url: { url: "https://cdn.example/o.png" } },
  "mimeType image": { mimeType: "image/webp", data: WEBP },
  "toolName image_generation": { toolName: "image_generation", result: JPG },
  "tableau images (chaînes UUID/URL)": { images: [U1, "https://cdn.example/a.png", "data:image/png;base64,xx", { url: "/x.png" }, { b64_json: PNG }] },
  "JSON dans une chaîne": { content: JSON.stringify({ type: "generated_image", imageId: U3 }) },
  "message utilisateur ignoré": { role: "user", parts: [{ type: "image", url: "https://u.example/a.png" }] },
  "message système ignoré": { role: "system", type: "image", imageId: U1 },
  "base64 brut sous clé quelconque": { weird: { blob: PNG } },
  "base64 JPEG/WebP/GIF bruts": { a: JPG, b: WEBP, c: GIF },
  "base64 brut sous clé 'input' ignoré": { input: PNG, partial_x: JPG },
  "doublons": [{ type: "image", imageId: U1 }, { type: "image", imageId: U1 }, { type: "image", url: "https://d.example/a.png" }, { type: "image", url: "https://d.example/a.png" }],
  "profondeur > 10": { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { type: "image", imageId: U1 } } } } } } } } } } } } },
  "uuid sous clés connues": { generatedImageId: U1, generated_image_id: U2, image_id: U3 },
  "rien": { text: "pas d'image", n: 1 },
  "réponse complète (message assistant avec parts)": { id: U3, role: "assistant", parts: [{ type: "text", text: "voilà" }, { type: "image_generation_call", status: "completed", result: PNG }] }
};
for (const [label, data] of Object.entries(IMAGE_CASES)) {
  await test(`images — ${label} : identique à collectGeneratedImages`, () => {
    assert.deepEqual(collectGeneratedImages(data), plain(context.collectGeneratedImages(data)));
  });
}
await test("clé d'image : données, identifiant, URL, vide", () => {
  for (const image of [null, undefined, {}, { data: "data:image/png;base64," + BIG }, { id: U1 }, { url: "https://x.example/a.png" }, { id: U1, url: "/a" }, { data: "d", id: U1 }]) {
    assert.equal(generatedImageKey(image), context.generatedImageKey(image), JSON.stringify(image));
  }
});
await test("describeShape et collectUuidCandidates : identiques", () => {
  const samples = [null, undefined, "court", "x".repeat(80), U1, 12, true, [1, 2, 3, 4, 5, 6], { a: { b: { c: { d: { e: 1 } } } } }, Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]))];
  for (const sample of samples) assert.equal(describeShape(sample), context.describeShape(sample), JSON.stringify(sample));
  const tree = { chatId: U1, userId: U1, parts: [{ id: U2 }, { id: U2 }, [U3]], messageId: U3, deep: { x: "pas un uuid" } };
  assert.deepEqual(collectUuidCandidates(tree, [U2]), plain(context.collectUuidCandidates(tree, [U2])));
  assert.deepEqual(collectUuidCandidates(tree, []), plain(context.collectUuidCandidates(tree, [])));
  const lots = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
  assert.equal(collectUuidCandidates(lots, []).length, 6);
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. Flux complet : `streamChatRequest` de l'original contre `processChatStream`, même faux serveur, même découpage.
// ---------------------------------------------------------------------------------------------------------------------
const ev = (event, data, id) => (id === undefined ? "" : `id: ${id}\n`) + (event ? `event: ${event}\n` : "") + `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
const delta = (text, id) => ev("response.output_text.delta", { delta: text }, id);
const done = (text = "") => ev("response.completed", { response: {} });

const DETAIL_WITH_IMAGE = { chatMessages: [{ id: "m-old", role: "assistant", createdAt: "2026-01-01T00:00:00Z", parts: [] }, { id: "m-new", role: "assistant", createdAt: "2026-01-02T00:00:00Z", parts: [{ type: "image_generation_call", result: PNG }] }] };
const DETAIL_WITH_UUID = { chatMessages: [{ id: "m1", role: "assistant", createdAt: "2026-01-02T00:00:00Z", parts: [{ weird: U2 }] }] };

const SCENARIOS = [
  { name: "texte simple, chat_id et id d'événements", text: ev("chat", { chat_id: "chat-1" }, 1) + delta("Bon", 2) + delta("jour é 😀", 3) + done(), conv: { chatId: null, pendingResponse: { output: "", lastEventId: "" } } },
  { name: "texte sans pendingResponse", text: delta("a") + delta("b") + done() },
  { name: "response.output_text.done utilisé si aucun delta", text: ev("response.output_text.done", { text: "complet" }) + done() },
  { name: "output_text.done ignoré si du texte existe déjà", text: delta("déjà") + ev("response.output_text.done", { text: "autre" }) + done() },
  { name: "événement completed avec message texte", text: ev("completed", { message: { id: "srv-1", role: "assistant", content: "Réponse finale", isUpvoted: true } }) },
  { name: "completed : contenu en parts", text: ev("completed", { message: { id: "srv-2", content: [{ text: "A" }, "B", { type: "text", content: "C" }, { type: "x", content: "ignoré" }], parts: [{ text: "D" }] } }) },
  { name: "completed après deltas : pas de doublon", text: delta("Salut") + ev("completed", { message: { id: "srv-3", content: "Salut" } }) },
  { name: "[DONE] seul marque la fin", text: delta("ok") + "data: [DONE]\n\n" },
  { name: "ligne non JSON ignorée (journal)", text: "data: pas du json\n\n" + delta("ok") + done() },
  { name: "JSON non objet ignoré", text: "data: 42\n\ndata: null\n\n" + delta("ok") + done() },
  { name: "flux tronqué → TypeError", text: delta("partiel") },
  { name: "flux vide → TypeError", text: "" },
  { name: "response.failed avec code/type/retryable", text: delta("x") + ev("response.failed", { code: "server_is_overloaded", type: "server_error", retryable: true, message: "Surcharge" }) },
  { name: "event error imbriqué + modération", text: ev("error", { error: { message: "Bloqué", code: "moderation_blocked", type: "image_generation_user_error", moderation_details: { moderation_stage: "output" } } }) },
  { name: "response.completed avec response.error", text: ev("response.completed", { response: { error: { message: "Quota", code: "insufficient_quota" } } }) },
  { name: "erreur sans message : JSON tronqué à 500", text: ev("error", { blob: "x".repeat(900) }) },
  { name: "arrêt demandé après le premier delta", text: delta("un") + delta("deux") + delta("trois") + done(), stopAfter: 1 },
  { name: "arrêt demandé sur flux tronqué : pas d'erreur", text: delta("un") + delta("deux"), stopAfter: 1 },
  { name: "HTTP 429 avec détail", nonOk: { status: 429, text: "trop de requêtes" } },
  { name: "HTTP 500 sans détail", nonOk: { status: 500, text: "" } },
  { name: "HTTP 502 : détail tronqué à 500", nonOk: { status: 502, text: "d".repeat(800) } },
  { name: "réponse sans lecteur de flux (text())", text: delta("tout") + done(), noReader: true },
  { name: "reprise avec lastEventId : texte déjà reçu rejoué", resume: true, conv: { chatId: "chat-9", pendingResponse: { output: "Début ", lastEventId: "12" } }, text: delta("suite", 13) + done() },
  { name: "reprise sans lastEventId : on repart de zéro", resume: true, conv: { chatId: "chat-9", pendingResponse: { output: "ancien", lastEventId: "" } }, text: delta("neuf", 1) + done() },
  { name: "id d'événement non numérique non mémorisé", conv: { chatId: "c", pendingResponse: { output: "", lastEventId: "5" } }, text: delta("a", "abc") + done() },
  { name: "sans onEvent : images et sources ignorées", noEvent: true, text: ev("response.output_item.done", { item: { type: "image_generation_call", result: PNG } }) + delta("t") + done() },
  { name: "image base64 dans le flux avec message_id", conv: { chatId: "c1" }, text: ev("response.output_item.done", { message_id: "msg-7", item: { type: "image_generation_call", result: PNG } }) + done() },
  { name: "image UUID avec messageId", conv: { chatId: "c1" }, text: ev("x", { messageId: "msg-8", item: { type: "generated_image", imageId: U1 } }) + done() },
  { name: "image UUID sans messageId → repli /chats (image trouvée)", conv: { chatId: "c1" }, text: ev("x", { item: { type: "generated_image", imageId: U1 } }) + done(), detail: { status: 200, body: DETAIL_WITH_IMAGE } },
  { name: "mode image sans rien dans le flux → repli /chats", imageMode: true, conv: { chatId: "c2" }, text: delta("texte") + done(), detail: { status: 200, body: DETAIL_WITH_IMAGE } },
  { name: "repli /chats en erreur HTTP 500", imageMode: true, conv: { chatId: "c2" }, text: delta("t") + done(), detail: { status: 500, body: {} } },
  { name: "repli /chats sans chat_id : pas de requête", imageMode: true, text: delta("t") + done() },
  { name: "indice d'image sans résultat : image_start une fois", conv: { chatId: "c3" }, text: ev("response.image_generation_call.in_progress", { type: "response.image_generation_call.in_progress" }) + ev("response.image_generation_call.generating", { x: 1 }) + done(), detail: { status: 200, body: { chatMessages: [] } } },
  { name: "reprise avec imageStarted : repli autorisé", resume: true, conv: { chatId: "c4", pendingResponse: { output: "", lastEventId: "", imageStarted: true } }, text: done(), detail: { status: 200, body: DETAIL_WITH_IMAGE } },
  { name: "UUID candidats testés via resolveImage (succès)", imageMode: true, conv: { chatId: "c5" }, text: done(), detail: { status: 200, body: DETAIL_WITH_UUID }, resolve: () => "data:image/png;base64,ZZ" },
  { name: "UUID candidats : échec journalisé", imageMode: true, conv: { chatId: "c5" }, text: done(), detail: { status: 200, body: DETAIL_WITH_UUID }, resolve: () => { throw new Error("HTTP 404"); } },
  { name: "UUID candidats : aucun uuid", imageMode: true, conv: { chatId: "c5" }, text: done(), detail: { status: 200, body: { chatMessages: [{ id: "m9", role: "assistant", createdAt: "2026-01-02T00:00:00Z", parts: [{ type: "text", text: "rien" }] }] } } },
  { name: "sources : web_search_call puis texte", text: ev("response.output_item.done", { item: { type: "web_search_call", action: { sources: [{ url: "https://www.lemonde.fr/a", title: "LM" }] } } }) + ev("response.output_item.done", { item: { type: "web_search_call", action: { sources: [{ url: "https://lefigaro.fr/b" }, { url: "https://www.lemonde.fr/a" }] } } }) + delta("ok") + done() },
  { name: "événement web_search tant qu'aucun texte", text: ev("response.web_search_call.searching", { item: { type: "web_search_call" } }) + ev("response.web_search_call.completed", { type: "response.web_search_call.completed" }) + delta("t") + done() },
  { name: "web_search ignoré une fois du texte reçu", text: delta("t") + ev("response.web_search_call.searching", { item: { type: "web_search_call" } }) + done() },
  { name: "journal limité à 60 entrées, doublons consécutifs fusionnés", text: Array.from({ length: 80 }, (_, i) => ev(`evt${i}`, { type: `t${i}` })).join("") + ev("evt79", { type: "t79" }) + done() }
];

function chunkBytes(text, size) {
  const bytes = new TextEncoder().encode(text);
  if (!size) return bytes.length ? [bytes] : [];
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

function fakeMain(scenario, size) {
  if (scenario.nonOk) return { ok: false, status: scenario.nonOk.status, text: async () => scenario.nonOk.text };
  const chunks = chunkBytes(scenario.text, size);
  let index = 0;
  const state = { cancelled: 0 };
  const response = {
    ok: true,
    status: 200,
    text: async () => scenario.text,
    state
  };
  if (!scenario.noReader) {
    response.body = {
      getReader: () => ({
        read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
        cancel: async () => { state.cancelled += 1; }
      })
    };
  }
  return response;
}

function fakeDetail(scenario) {
  const detail = scenario.detail || { status: 404, body: {} };
  return { ok: detail.status >= 200 && detail.status < 300, status: detail.status, json: async () => structuredClone(detail.body) };
}

function normalizeError(error) {
  return {
    name: error.name, message: error.message, status: error.status, code: error.code, type: error.type,
    retryable: error.retryable, moderation: plain(error.moderation), fromStream: error.fromStream, auth: error.auth
  };
}

async function runLegacy(scenario, size) {
  const conversation = plain(scenario.conv || { chatId: null });
  const deltas = [];
  const events = [];
  const paths = [];
  const main = fakeMain(scenario, size);
  let saves = 0;
  const stop = { value: false };
  const stopAfter = scenario.stopAfter || 0;
  Object.assign(context, {
    stopRequested: false,
    store: { imageMode: scenario.imageMode === true },
    saveStore: () => { saves += 1; },
    apiFetch: async pathName => {
      paths.push(pathName);
      return /\/stream(\?|$)/.test(pathName) ? main : fakeDetail(scenario);
    },
    resolveGeneratedImage: async image => (scenario.resolve ? scenario.resolve(image) : null),
    uploadAttachment: async () => { throw new Error("pièces jointes : hors périmètre du test"); },
    syncImageTool: async () => {},
    syncFileInstructions: async () => {},
    imagePromptPrefix: () => "",
    postAttachment: async () => ""
  });
  context.window.__lastStreamLog = undefined;
  context.__conversation = conversation;
  context.__onDelta = value => {
    deltas.push(value);
    if (stopAfter && deltas.length >= stopAfter) { context.stopRequested = true; stop.value = true; }
  };
  context.__onEvent = scenario.noEvent ? undefined : (name, data) => events.push({ name, data: plain(data) });
  context.__resume = scenario.resume === true;
  let output;
  let error = null;
  try {
    output = await vm.runInContext("streamChatRequest(__conversation, 'q', [], __onDelta, __onEvent, __resume)", context);
  } catch (caught) {
    error = normalizeError(caught);
  }
  // Réponse non OK : l'original lève avant de créer son journal (undefined) ; le service reçoit un tableau vide.
  return { output, error, deltas, events, paths, conversation, log: plain(context.window.__lastStreamLog) ?? [], cancelled: main.state?.cancelled ?? 0, saved: saves > 0 };
}

async function runModern(scenario, size) {
  const conversation = plain(scenario.conv || { chatId: null });
  const deltas = [];
  const events = [];
  const paths = [];
  const main = fakeMain(scenario, size);
  let saves = 0;
  let stop = false;
  const stopAfter = scenario.stopAfter || 0;
  const log = [];
  let output;
  let error = null;
  try {
    output = await processChatStream({
      response: main,
      conversation,
      resume: scenario.resume === true,
      imageMode: scenario.imageMode === true,
      onDelta: value => {
        deltas.push(value);
        if (stopAfter && deltas.length >= stopAfter) stop = true;
      },
      onEvent: scenario.noEvent ? undefined : event => events.push({ name: event.name, data: plain(event.data) }),
      shouldStop: () => stop,
      fetchChatDetail: async chatId => {
        paths.push("/chats/" + encodeURIComponent(chatId));
        return fakeDetail(scenario);
      },
      resolveImage: async image => (scenario.resolve ? scenario.resolve(image) : null),
      save: () => { saves += 1; },
      log
    });
  } catch (caught) {
    error = normalizeError(caught);
  }
  return { output, error, deltas, events, paths, conversation, log, cancelled: main.state?.cancelled ?? 0, saved: saves > 0 };
}

for (const scenario of SCENARIOS) {
  await test(`flux — ${scenario.name} : identique à streamChatRequest (découpages 0/1/7 octets)`, async () => {
    for (const size of scenario.nonOk ? [0] : [0, 1, 7]) {
      const expected = await runLegacy(scenario, size);
      const actual = await runModern(scenario, size);
      // Le chemin de requête principal est construit par l'appelant ; seuls les replis /chats sont comparés.
      const detailPaths = expected.paths.filter(p => !/\/stream(\?|$)/.test(p));
      assert.deepEqual({ ...actual, paths: actual.paths }, { ...expected, paths: detailPaths }, `taille ${size}`);
    }
  });
}

await test("reprise : le delta déjà enregistré est ignoré et le terminal sans id reste traité", async () => {
  const result = await runModern({
    resume: true,
    conv: { chatId: "reprise", pendingResponse: { output: "Début ", lastEventId: "12" } },
    text: delta("Début ", 12) + delta("suite", 13) + done()
  }, 1);
  assert.equal(result.error, null);
  assert.equal(result.output, "Début suite");
  assert.deepEqual(result.deltas, ["Début ", "Début suite"]);
});

await test("flux — le jeu de scénarios exerce vraiment les branches (pas de test creux)", async () => {
  const by = async name => runModern(SCENARIOS.find(s => s.name.startsWith(name)), 0);
  assert.equal((await by("texte simple")).output, "Bonjour é 😀");
  assert.equal((await by("flux tronqué")).error.name, "TypeError");
  assert.equal((await by("response.failed")).error.code, "server_is_overloaded");
  assert.ok((await by("image UUID sans messageId")).events.some(e => e.name === "image"));
  assert.ok((await by("indice d'image")).events.some(e => e.name === "image_start"));
  assert.ok((await by("sources : web_search_call")).events.some(e => e.name === "sources"));
  assert.ok((await by("événement web_search tant")).events.some(e => e.name === "web_search"));
  assert.ok((await by("image base64 dans le flux")).events.some(e => e.name === "image" && e.data.data));
  assert.equal((await by("arrêt demandé après")).cancelled, 1);
  assert.equal((await by("HTTP 429")).error.status, 429);
  assert.ok((await by("journal limité")).log.length <= 61);
  assert.ok((await by("UUID candidats testés")).log.includes("image trouvée via uuid"));
  const failed = await by("response.failed");
  assert.equal(failed.error.fromStream, true);
});

await test("reprise : chemin de requête identique (curseur encodé, absent si vide)", async () => {
  for (const cursor of ["", "12", "a b&c"]) {
    const scenario = { resume: true, conv: { chatId: "chat/é 1", pendingResponse: { output: "x", lastEventId: cursor } }, text: done() };
    const expected = (await runLegacy(scenario, 0)).paths[0];
    assert.equal(resumeStreamPath("chat/é 1", cursor), expected);
  }
  assert.equal(resumeStreamPath("c", undefined), "/chats/c/stream");
});

console.log(`Service de streaming (TypeScript) : ${count} vérifications réussies.`);
