"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor() { this.children = []; this.listeners = {}; this.hidden = false; this.value = ""; this.textContent = ""; }
  setAttribute() {}
  addEventListener(name, callback) { this.listeners[name] = callback; }
  insertAdjacentElement(_position, node) { this.parent.appendChild(node); }
  appendChild(node) { node.parent = this; this.children.push(node); }
  replaceChildren() { this.children = []; }
  closest() { return this.parent; }
}

function deferred() {
  let resolve;
  const promise = new Promise(fn => { resolve = fn; });
  return { promise, resolve };
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/api-audit/openapi.json"), "utf8"));
  const operation = spec.paths["/chats/search"].get;
  assert.ok(operation.parameters.some(p => p.name === "query" && p.required === true));
  assert.ok(operation.parameters.some(p => p.name === "limit" && p.in === "query"));

  const sidebar = new Element(), container = new Element(), input = new Element(), logout = new Element();
  sidebar.appendChild(container); container.appendChild(input);
  const timers = new Map(), requests = [], opened = [], errors = [];
  let timerId = 0, onReady, nextId = 0;
  const context = vm.createContext({
    document: {
      readyState: "loading",
      getElementById: id => id === "search-input" ? input : id === "logout" ? logout : null,
      createElement: () => new Element(),
      addEventListener(name, callback) { if (name === "DOMContentLoaded") onReady = callback; }
    },
    store: { session: "session-test", agentId: 1, conversations: [] },
    apiFetch: route => { const pending = deferred(); requests.push({ route, ...pending }); return pending.promise; },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    busy: false, currentProject: null,
    makeId: () => "local-" + ++nextId,
    serverTime: value => Date.parse(value) || 0,
    saveStore() {},
    async openProject(id) { context.currentProject = { id }; },
    leaveProject() { context.currentProject = null; },
    async openConversation(id) { opened.push(id); },
    showToast: message => errors.push(message),
    Date, Set, String, Number, Boolean, encodeURIComponent
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "remote-chat-search.js"), "utf8"), context);
  onReady();
  const status = sidebar.children[1], results = sidebar.children[2];
  assert.ok(status.hidden && results.hidden);
  function type(value) { input.value = value; input.listeners.input(); }
  function fire() { const [id, callback] = [...timers.entries()][0]; timers.delete(id); callback(); }
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const response = chats => ({ ok: true, json: async () => ({ chats }), body: { cancel: async () => {} } });

  type("ancien"); fire();
  type("école & mer"); fire();
  assert.equal(requests[1].route, "/chats/search?query=%C3%A9cole%20%26%20mer&limit=20");
  const id = "11111111-1111-1111-1111-111111111111";
  requests[1].resolve(response([{ id, title: "Discussion retrouvée", projectId: null }]));
  await tick();
  assert.equal(results.children.length, 1);
  assert.equal(results.children[0].textContent, "Discussion retrouvée");
  assert.equal(context.store.conversations.length, 0, "la recherche seule ne doit pas ajouter de conversations au cache");
  requests[0].resolve(response([{ id: "22222222-2222-2222-2222-222222222222", title: "Périmée" }]));
  await tick();
  assert.equal(results.children[0].textContent, "Discussion retrouvée", "une réponse périmée ne doit pas remplacer les résultats récents");
  results.children[0].listeners.click();
  await tick();
  assert.equal(context.store.conversations[0].chatId, id);
  assert.equal(context.store.conversations[0].needsLoad, true);
  assert.deepEqual(opened, ["local-1"]);

  type("projet"); fire();
  requests[2].resolve(response([{ id: "33333333-3333-3333-3333-333333333333", title: "Projet", projectId: "project-1" }]));
  await tick();
  results.children[0].listeners.click();
  await tick();
  assert.equal(context.currentProject.id, "project-1");
  assert.deepEqual(opened, ["local-1", "local-2"]);
  assert.deepEqual(errors, []);

  type("erreur"); fire();
  requests[3].resolve({ ok: false, status: 401 });
  await tick();
  assert.match(status.textContent, /HTTP 401/);
  assert.equal(results.children.length, 0);
  type("attente");
  logout.listeners.click();
  assert.equal(timers.size, 0);
  assert.equal(status.textContent, "");
}
main().then(() => console.log("Recherche serveur : contrat, réponse périmée, ouverture, projet et erreur vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
