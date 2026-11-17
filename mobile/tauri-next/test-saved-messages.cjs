"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Node {
  constructor() {
    this.children = []; this.listeners = {}; this.style = {};
    this.textContent = ""; this.hidden = false; this.disabled = false;
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelector(selector) {
    if (selector === "header") return this.children.find(node => node.tagName === "header");
    if (selector === ".message-actions") return this.children.find(node => node.className === "message-actions");
    return null;
  }
  after(...nodes) {
    const index = this.parent.children.indexOf(this);
    for (const node of nodes) node.parent = this.parent;
    this.parent.children.splice(index + 1, 0, ...nodes);
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/api-audit/openapi.json"), "utf8"));
  const root = "/user/@me/saved-messages";
  assert.ok(spec.paths[root].get);
  assert.ok(spec.paths[root + "/{chatId}/{messageId}"].put);
  assert.ok(spec.paths[root + "/{chatId}/{messageId}"].delete);

  const chatId = "11111111-1111-1111-1111-111111111111";
  const messageId = "22222222-2222-2222-2222-222222222222";
  const secondId = "33333333-3333-3333-3333-333333333333";
  const cursor = "page/2+next=";
  const calls = [], notices = [], actionCalls = [], libraryCalls = [];
  let conversation = { chatId }, fail = false;
  const dialog = new Node(), header = new Node();
  header.tagName = "header"; dialog.append(header); dialog.open = false;
  const context = vm.createContext({
    document: { createElement: () => new Node(), getElementById: id => id === "file-library" ? dialog : null },
    store: { session: "session", conversations: [], agentId: 1 }, busy: false,
    currentConversation: () => conversation,
    showToast: text => notices.push(text),
    addMessageActions: (...args) => actionCalls.push(args),
    openLibrary: (...args) => { libraryCalls.push(args); dialog.open = true; return "library-result"; },
    async settingsApi(route, options = {}) {
      calls.push([route, options.method || "GET"]);
      if (fail) throw new Error("HTTP 500");
      if (options.method) return {};
      if (route === root + "?limit=20") return {
        savedMessages: [{ chatId, messageId, message: { content: "Premier message" } }],
        hasMore: true, nextCursor: cursor
      };
      assert.equal(route, root + "?limit=20&cursor=" + encodeURIComponent(cursor));
      return {
        savedMessages: [{ chatId, messageId: secondId, message: { content: "Second message" } }],
        hasMore: false, nextCursor: null
      };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../www/js/saved-messages.js"), "utf8"), context);

  const row = new Node(), bar = new Node(), message = { serverMessageId: messageId };
  bar.className = "message-actions"; row.append(bar);
  context.addMessageActions(row, message, 7);
  assert.equal(actionCalls.length, 1);
  assert.deepEqual(actionCalls[0], [row, message, 7]);
  assert.equal(bar.children.length, 1);
  const save = bar.children[0];
  assert.equal(save.textContent, "Enregistrer");
  assert.equal(save["aria-label"], "Enregistrer ce message");
  let stopped = 0;
  const click = () => save.listeners.click({ stopPropagation() { stopped++; } });
  await click();
  assert.equal(stopped, 1);
  assert.deepEqual(calls[0], [root + "/" + chatId + "/" + messageId, "PUT"]);
  assert.equal(notices.at(-1), "Message enregistré dans la bibliothèque.");
  assert.equal(save.disabled, false);

  // Chaque identifiant manquant doit interdire l'appel réseau.
  const count = calls.length;
  conversation = {};
  await click();
  assert.match(notices.at(-1), /Recharge cette conversation/);
  assert.equal(calls.length, count);
  conversation = { chatId };
  delete message.serverMessageId;
  await click();
  assert.match(notices.at(-1), /Recharge cette conversation/);
  assert.equal(calls.length, count);
  assert.equal(save.disabled, false);
  message.serverMessageId = messageId;
  fail = true;
  await click();
  assert.match(notices.at(-1), /Enregistrement impossible : HTTP 500/);
  assert.equal(save.disabled, false);
  fail = false;

  assert.equal(context.openLibrary("files"), "library-result");
  assert.deepEqual(libraryCalls, [["files"]]);
  const toggle = dialog.children[1], section = dialog.children[2];
  const [status, list, more] = section.children;
  assert.equal(toggle.textContent, "Messages enregistrés");
  assert.equal(section.hidden, true);
  const beforeLoad = calls.length;
  toggle.onclick();
  await flush();
  assert.equal(section.hidden, false);
  assert.equal(toggle["aria-expanded"], "true");
  assert.deepEqual(calls[beforeLoad], [root + "?limit=20", "GET"]);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "Premier message");
  assert.equal(more.hidden, false);
  more.onclick();
  await flush();
  assert.deepEqual(calls.at(-1), [root + "?limit=20&cursor=" + encodeURIComponent(cursor), "GET"]);
  assert.equal(list.children.length, 2, "la seconde page complète la première");
  assert.equal(list.children[1].children[0].textContent, "Second message");
  assert.equal(more.hidden, true);
  assert.equal(more.disabled, false);

  const savedRow = list.children[0], remove = savedRow.children[2];
  assert.equal(remove.textContent, "Retirer");
  fail = true;
  await remove.onclick();
  assert.equal(list.children.length, 2, "un échec de suppression conserve le message");
  assert.match(status.textContent, /Retrait impossible : HTTP 500/);
  assert.equal(remove.disabled, false);
  fail = false;
  await remove.onclick();
  assert.deepEqual(calls.at(-1), [root + "/" + chatId + "/" + messageId, "DELETE"]);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "Second message");
  assert.equal(remove.disabled, false);
}

main().then(() => console.log("Messages enregistrés : action, contrats PUT/GET/DELETE, pagination et erreurs vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
