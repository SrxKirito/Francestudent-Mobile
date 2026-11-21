// Client JSON authentifié au-dessus de `requestStream` : jeton, nouvel essai après 401, messages d'erreur, annulation.
// Aucun réseau ni Tauri ici : la requête et le fournisseur de jeton sont de faux objets.
import assert from "node:assert/strict";

const { ApiError, createApiClient } = await import("./src/lib/services/api-client.ts");
const { AuthError } = await import("./src/lib/services/auth.ts");

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

function fakeTokens(values = ["jeton-1", "jeton-2"]) {
  const log = { forced: [], invalidated: 0 };
  let index = 0;
  return {
    log,
    getAccessToken: async (force = false) => {
      log.forced.push(force);
      if (force) index = Math.min(index + 1, values.length - 1);
      return values[index];
    },
    invalidate: () => { log.invalidated += 1; }
  };
}

function fakeRequest(responses) {
  const calls = [];
  const queue = [...responses];
  const request = async call => {
    calls.push(call);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    // Un corps de Response ne se lit qu'une fois : chaque appel reçoit une copie.
    return typeof next === "function" ? next(call) : next.clone();
  };
  return { calls, request };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (status, body) => new Response(body, { status });

await test("GET : jeton, chemin et en-tête Accept, sans corps", async () => {
  const tokens = fakeTokens();
  const { calls, request } = fakeRequest([json(200, { ok: true })]);
  const client = createApiClient({ tokens, request });
  assert.deepEqual(await client.json("/user/instructions"), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/user/instructions");
  assert.equal(calls[0].token, "jeton-1");
  assert.equal(calls[0].accept, "application/json");
  assert.equal("body" in calls[0], false);
});

await test("PATCH et PUT : le corps est sérialisé en JSON", async () => {
  const { calls, request } = fakeRequest([json(200, {})]);
  const client = createApiClient({ tokens: fakeTokens(), request });
  await client.json("/user/instructions", { method: "PATCH", body: { gptReasoning: "low" } });
  await client.json("/user/web-search-domains", { method: "put", body: { filterType: "allowlist" } });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].body, '{"gptReasoning":"low"}');
  assert.equal(calls[1].method, "PUT", "la méthode est mise en majuscules");
  assert.equal(calls[1].body, '{"filterType":"allowlist"}');
});

await test("401 : jeton invalidé, nouveau jeton forcé, une seule nouvelle tentative", async () => {
  const tokens = fakeTokens();
  const { calls, request } = fakeRequest([json(401, { message: "expiré" }), json(200, { done: 1 })]);
  const client = createApiClient({ tokens, request });
  assert.deepEqual(await client.json("/user/instructions"), { done: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.token), ["jeton-1", "jeton-2"]);
  assert.equal(tokens.log.invalidated, 1);
  assert.deepEqual(tokens.log.forced, [false, true]);
});

await test("401 répété : l'erreur est renvoyée avec son statut, sans boucle", async () => {
  const { calls, request } = fakeRequest([json(401, { message: "refusé" })]);
  const client = createApiClient({ tokens: fakeTokens(), request });
  await assert.rejects(client.json("/user/instructions"), error => error instanceof ApiError && error.status === 401 && error.message === "refusé");
  assert.equal(calls.length, 2);
});

await test("messages d'erreur : error.message, error texte, message, detail, texte brut tronqué, repli « Erreur N »", async () => {
  const cases = [
    [json(400, { error: { message: "A" } }), "A"],
    [json(400, { error: "B" }), "B"],
    [json(400, { message: "C" }), "C"],
    [json(400, { detail: "D" }), "D"],
    [text(502, "x".repeat(300)), "x".repeat(200)],
    [json(500, {}), "Erreur 500"],
    [text(503, ""), "Erreur 503"]
  ];
  for (const [response, expected] of cases) {
    const client = createApiClient({ tokens: fakeTokens(), request: fakeRequest([response]).request });
    await assert.rejects(client.json("/x"), error => error instanceof ApiError && error.message === expected && error.status === response.status, expected);
  }
});

await test("204, corps vide et texte non JSON", async () => {
  const none = createApiClient({ tokens: fakeTokens(), request: fakeRequest([new Response(null, { status: 204 })]).request });
  assert.equal(await none.json("/x", { method: "DELETE" }), null);
  const empty = createApiClient({ tokens: fakeTokens(), request: fakeRequest([text(200, "")]).request });
  assert.equal(await empty.json("/x"), null);
  const plain = createApiClient({ tokens: fakeTokens(), request: fakeRequest([text(200, "ok")]).request });
  assert.equal(await plain.json("/x"), "ok");
});

await test("session absente : l'AuthError du fournisseur de jeton traverse le client", async () => {
  const tokens = { getAccessToken: async () => { throw new AuthError("Aucune session : colle ton cookie de session."); }, invalidate() {} };
  const { calls, request } = fakeRequest([json(200, {})]);
  const client = createApiClient({ tokens, request });
  await assert.rejects(client.json("/x"), error => error instanceof AuthError && error.auth === true);
  assert.equal(calls.length, 0);
});

await test("annulation : aucune requête si le signal est déjà annulé, et rejet si annulé pendant l'attente", async () => {
  const controller = new AbortController();
  controller.abort();
  const first = fakeRequest([json(200, {})]);
  await assert.rejects(createApiClient({ tokens: fakeTokens(), request: first.request }).json("/x", { signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(first.calls.length, 0);

  const late = new AbortController();
  const second = fakeRequest([() => { late.abort(); return json(200, { trop: "tard" }); }]);
  await assert.rejects(createApiClient({ tokens: fakeTokens(), request: second.request }).json("/x", { signal: late.signal }), error => error.name === "AbortError");
});

console.log(`test-svelte-api-client : ${count} tests réussis`);
