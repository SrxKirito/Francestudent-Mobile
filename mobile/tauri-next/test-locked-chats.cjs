"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const flush = async (count = 5) => { for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve)); };

function reply(status, data) {
  const text = data === undefined ? "" : JSON.stringify(data);
  const response = {
    ok: status >= 200 && status < 300, status,
    text: async () => text,
    json: async () => JSON.parse(text || "null"),
    clone: () => response
  };
  return response;
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/api-audit/openapi.json"), "utf8"));
  for (const [route, methods] of [
    ["/locked-chats", ["get"]],
    ["/locked-chats/status", ["get"]],
    ["/locked-chats/access", ["post", "delete"]],
    ["/locked-chats/pin", ["post", "put", "delete"]],
    ["/locked-chats/chats/{chatId}", ["put", "delete"]]
  ]) for (const method of methods) assert.ok(spec.paths[route]?.[method], `Route absente de l'OpenAPI : ${method.toUpperCase()} ${route}`);

  const lockedId = "11111111-1111-1111-1111-111111111111";
  const otherId = "22222222-2222-2222-2222-222222222222";
  // The `serverLocked` flag is persisted locally, so the chat stays hidden after a restart.
  const lockedConversation = { id: "local-locked", chatId: lockedId, serverLocked: true, title: "Secret", messages: [{ content: "privé" }] };
  const otherConversation = { id: "local-other", chatId: otherId, title: "Public", messages: [{ content: "ouvert" }] };

  const server = { pin: "1234", token: null, tokenSeq: 0, destructiveCalls: 0, locked: new Set([lockedId]) };
  const calls = [], notices = [], events = [], documentListeners = {};
  let current = otherConversation, newConversationCalls = 0, renderCalls = 0;

  const ctx = vm.createContext({
    document: {
      visibilityState: "visible",
      addEventListener(name, listener) { documentListeners[name] = listener; },
      createElement: () => ({})
    },
    window: { dispatchEvent: event => { events.push(event); return true; } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    conversationMatches: () => true,
    store: { session: "session", agentId: 1, conversations: [lockedConversation, otherConversation] },
    currentConversation: () => current,
    newConversation() { newConversationCalls++; current = null; },
    renderHistory() { renderCalls++; },
    saveStore() {},
    showToast: text => notices.push(text),
    apiFetch: async (route, options = {}) => {
      const method = options.method || "GET";
      const body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
      calls.push({ route, method, body, lockedAccess: options.lockedAccess });
      // The server only honours the token it issued last (a new one replaces the previous one).
      const granted = server.token !== null && options.lockedAccess === server.token;
      const issueToken = () => { server.token = "token-" + (++server.tokenSeq); return { accessToken: server.token, idleTimeoutSeconds: 300 }; };
      if (route === "/locked-chats/status" && method === "GET") return reply(200, { hasPin: !!server.pin, accessOpen: granted });
      if (route === "/locked-chats/access" && method === "POST") {
        if (body?.pin !== server.pin) return reply(403, { message: "PIN incorrect" });
        return reply(200, issueToken());
      }
      if (route === "/locked-chats/access" && method === "DELETE") { if (granted) server.token = null; return reply(204); }
      if (route === "/locked-chats" && method === "GET") {
        if (!granted) return reply(403, { message: "Accès fermé" });
        return reply(200, { chats: [...server.locked].map(id => ({ id, title: "Chat " + id.slice(0, 4) })), hasMore: false });
      }
      if (route.startsWith("/locked-chats/chats/")) {
        if (!granted) return reply(403, { message: "Accès fermé" });
        const id = decodeURIComponent(route.slice("/locked-chats/chats/".length));
        if (method === "PUT") { server.locked.add(id); return reply(204); }
        if (method === "DELETE") { server.locked.delete(id); return reply(204); }
      }
      if (route === "/locked-chats/pin") {
        if (method === "POST") { server.pin = body.pin; return reply(200, issueToken()); }
        if (method === "PUT") {
          if (body?.currentPin !== server.pin) return reply(403, { message: "PIN incorrect" });
          server.pin = body.newPin; return reply(204);
        }
        if (method === "DELETE") {
          // Must never be reached: it would permanently delete the locked conversations.
          server.destructiveCalls++; server.pin = null; server.locked.clear(); return reply(204);
        }
      }
      return reply(404, { message: "Route inattendue" });
    },
    encodeURIComponent
  });

  vm.runInContext(fs.readFileSync(path.join(__dirname, "locked-chats.js"), "utf8"), ctx);
  const api = ctx.window.FranceStudentLockedChats;
  assert.ok(api, "L'API doit être attachée à window.FranceStudentLockedChats");
  assert.equal(typeof documentListeners.visibilitychange, "function", "visibilitychange doit être écouté");

  // Synchronisation initiale (status + liste) au chargement du module.
  await flush();
  assert.equal(lockedConversation.serverLocked, true);
  assert.equal(calls.some(call => call.route === "/locked-chats" && call.method === "GET"), false, "pas de liste verrouillée sans jeton après un démarrage");
  assert.equal(ctx.conversationMatches(lockedConversation, ""), false, "chat verrouillé masqué au démarrage");
  calls.length = 0;

  // 1. getStatus
  let state = await api.getStatus();
  assert.equal(calls[0].route, "/locked-chats/status");
  assert.equal(calls[0].method, "GET");
  assert.equal(state.hasPin, true);
  assert.equal(state.accessOpen, false);
  assert.equal(ctx.conversationMatches(lockedConversation, ""), false, "chat verrouillé masqué quand l'accès est fermé");
  assert.equal(ctx.conversationMatches(otherConversation, ""), true);

  // 2. openAccess : refus si PIN invalide, puis ouverture
  calls.length = 0;
  await assert.rejects(api.openAccess("12a"), /invalide/);
  await assert.rejects(api.openAccess(""), /invalide/);
  assert.equal(calls.length, 0, "un PIN mal formé ne doit pas atteindre le serveur");
  await assert.rejects(api.openAccess("9999"), /PIN incorrect/);
  assert.equal(api.state().accessOpen, false);
  calls.length = 0;
  state = await api.openAccess("1234");
  assert.equal(calls[0].route, "/locked-chats/access");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { pin: "1234" });
  assert.equal(state.accessOpen, true);
  assert.equal(ctx.conversationMatches(lockedConversation, ""), true, "chat verrouillé visible quand l'accès est ouvert");

  // 3. list
  calls.length = 0;
  const items = await api.list();
  assert.equal(calls[0].route, "/locked-chats");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].lockedAccess, server.token, "la liste doit porter le jeton d'accès");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, lockedId);
  assert.equal(api.isChatLocked(lockedId), true);
  assert.equal(api.isChatLocked(otherId), false);

  // 4. lockChat
  calls.length = 0;
  assert.equal(await api.lockChat(otherId), true);
  assert.equal(calls[0].route, `/locked-chats/chats/${otherId}`);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].lockedAccess, server.token, "le verrouillage doit porter le jeton d'accès");
  assert.equal(otherConversation.serverLocked, true);
  assert.equal(api.isChatLocked(otherId), true);
  await assert.rejects(api.lockChat("pas-un-uuid"), /invalide/);
  assert.equal(calls.length, 1, "un identifiant invalide ne doit pas atteindre le serveur");

  // 5. unlockChat
  calls.length = 0;
  assert.equal(await api.unlockChat(otherId), true);
  assert.equal(calls[0].route, `/locked-chats/chats/${otherId}`);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(otherConversation.serverLocked, undefined);
  assert.equal(api.isChatLocked(otherId), false);

  // 6. createPin
  calls.length = 0;
  await api.createPin("1234");
  assert.equal(calls[0].route, "/locked-chats/pin");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { pin: "1234" });
  assert.equal(api.state().hasPin, true);

  // 7. changePin
  calls.length = 0;
  await assert.rejects(api.changePin("1234", "ab"), /invalide/);
  assert.equal(calls.length, 0);
  await api.changePin("1234", "5678");
  assert.equal(calls[0].route, "/locked-chats/pin");
  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(calls[0].body, { currentPin: "1234", newPin: "5678" });
  assert.equal(server.pin, "5678");

  // 9. closeAccess + masquage via conversationMatches
  current = lockedConversation;
  const newConversationBefore = newConversationCalls;
  const tokenBeforeClose = server.token;
  assert.ok(tokenBeforeClose, "un jeton doit être détenu avant la fermeture");
  calls.length = 0;
  state = await api.closeAccess();
  assert.equal(calls[0].route, "/locked-chats/access");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].lockedAccess, tokenBeforeClose, "la fermeture révoque le jeton côté serveur");
  assert.equal(server.token, null);
  assert.equal(state.accessOpen, false);
  assert.equal(ctx.conversationMatches(lockedConversation, ""), false);
  assert.equal(ctx.conversationMatches(otherConversation, ""), true);
  assert.equal(newConversationCalls, newConversationBefore + 1, "la conversation verrouillée ouverte doit être quittée");

  // 10. visibilitychange -> hidden ferme l'accès immédiatement
  await api.openAccess("5678");
  assert.equal(api.state().accessOpen, true);
  calls.length = 0;
  ctx.document.visibilityState = "visible";
  documentListeners.visibilitychange();
  await flush();
  assert.equal(api.state().accessOpen, true, "revenir au premier plan ne doit pas fermer l'accès");
  assert.equal(calls.length, 0);

  ctx.document.visibilityState = "hidden";
  documentListeners.visibilitychange();
  // Fermeture locale synchrone, avant toute réponse réseau.
  assert.equal(api.state().accessOpen, false);
  assert.equal(ctx.conversationMatches(lockedConversation, ""), false);
  await flush();
  assert.ok(calls.some(call => call.route === "/locked-chats/access" && call.method === "DELETE"));
  assert.equal(server.token, null, "le jeton est révoqué côté serveur en arrière-plan");

  // Une ouverture qui se termine alors que l'app est en arrière-plan est révoquée aussitôt.
  calls.length = 0;
  await api.openAccess("5678");
  assert.equal(api.state().accessOpen, false, "pas d'accès ouvert en arrière-plan");
  await flush();
  assert.equal(server.token, null, "jeton obtenu en arrière-plan révoqué");
  ctx.document.visibilityState = "visible";

  // 8. removePin : toujours refusé, aucune route destructive atteinte
  calls.length = 0;
  await assert.rejects(api.removePin("5678"), /indisponible/);
  await assert.rejects(ctx.apiFetch("/locked-chats/pin", { method: "DELETE", body: JSON.stringify({ pin: "5678" }) }), /interdite/);
  assert.equal(calls.length, 0, "aucune requête ne doit partir");
  assert.equal(server.destructiveCalls, 0);
  assert.equal(server.locked.has(lockedId), true);
  assert.equal(api.state().hasPin, true);
  assert.equal(lockedConversation.serverLocked, true);
  assert.equal(ctx.conversationMatches(lockedConversation, ""), false);

  // Routes verrouillées sans jeton : refusées sans appel réseau
  await assert.rejects(api.list(), /fermé/);
  await assert.rejects(api.lockChat(otherId), /fermé/);
  await assert.rejects(ctx.apiFetch(`/chats/${lockedId}`), /fermé/);
  assert.equal(calls.length, 0, "aucune requête ne doit partir sans jeton");
  const publicResponse = await ctx.apiFetch(`/chats/${otherId}`);
  assert.equal(publicResponse.status, 404);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lockedAccess, undefined, "un chat non verrouillé ne reçoit pas de jeton");

  // Expiration : le serveur refuse le jeton -> l'accès se referme localement
  await api.openAccess("5678");
  assert.equal(api.state().accessOpen, true);
  server.token = null;
  await assert.rejects(api.list(), /fermé/);
  assert.equal(api.state().accessOpen, false, "un jeton refusé ferme l'accès");
  assert.equal(ctx.conversationMatches(lockedConversation, ""), false, "chat re-masqué après expiration");

  // Le jeton ne fuit ni dans l'état public ni dans les évènements
  await api.openAccess("5678");
  const leaked = JSON.stringify([api.state(), events.map(event => event.detail), notices]);
  assert.equal(leaked.includes("token-"), false, "le jeton ne doit jamais être exposé");
  await api.closeAccess();
  assert.equal(server.token, null);

  assert.ok(events.some(event => event.type === "francestudent:locked-chats"));
  assert.ok(renderCalls > 0);
  assert.equal(notices.length, 0, "aucun message d'erreur ne doit être affiché");
}
main().then(() => console.log("Locked chats : jeton d'accès, PIN, verrouillage, masquage, expiration, arrière-plan et refus de la réinitialisation vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
