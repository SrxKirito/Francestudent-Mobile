// Suivi de l'état « en direct » d'une réponse (texte partiel, recherche web, sources, image en préparation), alimenté
// par les rappels du VRAI processChatStream (src/lib/services/chat-stream.ts) : on vérifie aussi que l'enveloppe ne
// change pas le résultat ni les rappels transmis à l'ancienne interface.
import assert from "node:assert/strict";
import { createLiveTracker, emptyLive } from "./src/lib/services/chat-live.ts";
import { processChatStream } from "./src/lib/services/chat-stream.ts";

let count = 0;
async function test(name, fn) {
  try { await fn(); count += 1; } catch (error) { console.error(`ÉCHEC : ${name}`); throw error; }
}

function sse(...events) {
  const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    ok: true, status: 200, text: async () => body,
    body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { value: bytes, done: false })), cancel: async () => {} }) }
  };
}

function options(response, extra = {}) {
  const deltas = [];
  const events = [];
  return {
    deltas, events,
    value: { response, conversation: { chatId: null }, resume: false, imageMode: false, onDelta: out => deltas.push(out), onEvent: event => events.push(event), shouldStop: () => false, ...extra }
  };
}

await test("état initial vide", () => {
  assert.deepEqual(emptyLive(), { active: false, text: "", searching: false, sources: [], imageStarted: false });
});

await test("les deltas alimentent le texte ; l'ancienne interface reçoit les mêmes rappels", async () => {
  const seen = [];
  const tracker = createLiveTracker(live => seen.push(live));
  const o = options(sse(["response.output_text.delta", { delta: "Bon" }], ["response.output_text.delta", { delta: "jour" }], ["response.completed", { response: {} }]));
  const output = await processChatStream(tracker.wrap(o.value));
  assert.equal(output, "Bonjour");
  assert.deepEqual(o.deltas, ["Bon", "Bonjour"]);
  assert.equal(tracker.live.text, "Bonjour");
  assert.equal(tracker.live.active, true);
  assert.ok(seen.length >= 3, "une mise à jour au démarrage et une par delta");
});

await test("recherche web : l'indicateur s'allume sur l'événement du flux et s'éteint à l'arrivée du texte", async () => {
  const seen = [];
  const tracker = createLiveTracker(live => seen.push(live));
  const o = options(sse(
    ["response.web_search_call.in_progress", { type: "response.web_search_call.in_progress" }],
    ["response.output_text.delta", { delta: "Réponse" }],
    ["response.completed", { response: {} }]
  ));
  await processChatStream(tracker.wrap(o.value));
  assert.ok(o.events.some(event => event.name === "web_search"), "l'événement est aussi transmis à l'ancienne interface");
  assert.ok(seen.some(live => live.searching === true), "indicateur allumé pendant la recherche");
  assert.equal(tracker.live.searching, false, "le texte arrivé met fin à l'indicateur");
  assert.equal(tracker.live.text, "Réponse");
});

await test("événements directs : sources, image_start, image", () => {
  const tracker = createLiveTracker(() => {});
  const forwarded = [];
  const wrapped = tracker.wrap({ response: null, conversation: { chatId: null }, resume: false, imageMode: false, onDelta() {}, onEvent: event => forwarded.push(event.name), shouldStop: () => false });
  wrapped.onEvent({ name: "web_search", data: {} });
  assert.equal(tracker.live.searching, true);
  wrapped.onEvent({ name: "sources", data: [{ url: "https://a.fr", title: "A", host: "a.fr" }] });
  assert.equal(tracker.live.searching, false);
  assert.deepEqual(tracker.live.sources, [{ url: "https://a.fr", title: "A", host: "a.fr" }]);
  wrapped.onEvent({ name: "image_start", data: null });
  assert.equal(tracker.live.imageStarted, true);
  assert.deepEqual(forwarded, ["web_search", "sources", "image_start"]);
});

await test("sans onEvent côté ancienne interface : on n'en ajoute pas (comportement du flux inchangé)", () => {
  const tracker = createLiveTracker(() => {});
  const wrapped = tracker.wrap({ response: null, conversation: { chatId: null }, resume: false, imageMode: false, onDelta() {}, shouldStop: () => false });
  assert.equal(wrapped.onEvent, undefined);
});

await test("une erreur de l'interface dans onDelta ou onEvent n'est pas avalée par l'enveloppe", async () => {
  const tracker = createLiveTracker(() => {});
  const wrapped = tracker.wrap({ response: null, conversation: { chatId: null }, resume: false, imageMode: false, onDelta() { throw new Error("boum"); }, shouldStop: () => false });
  assert.throws(() => wrapped.onDelta("x"), /boum/);
});

await test("erreur HTTP : propagée telle quelle avec son statut (traitée ensuite par l'ancienne interface)", async () => {
  const tracker = createLiveTracker(() => {});
  const response = { ok: false, status: 429, text: async () => "trop de requêtes", body: null };
  const o = options(response);
  await assert.rejects(() => processChatStream(tracker.wrap(o.value)), error => error.status === 429 && /HTTP 429/.test(error.message));
});

await test("reset remet l'état à zéro et prévient l'affichage", () => {
  const seen = [];
  const tracker = createLiveTracker(live => seen.push(live));
  tracker.wrap({ response: null, conversation: { chatId: null }, resume: false, imageMode: false, onDelta() {}, shouldStop: () => false }).onDelta("abc");
  tracker.reset();
  assert.deepEqual(tracker.live, emptyLive());
  assert.deepEqual(seen.at(-1), emptyLive());
});

console.log(`test-svelte-chat-live : ${count} tests réussis`);
