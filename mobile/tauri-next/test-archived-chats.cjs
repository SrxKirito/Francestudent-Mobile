"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Node {
  constructor() { this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ""; }
  setAttribute() {}
  addEventListener() {}
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) { node.parent = this; this.children.push(node); }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
  querySelectorAll() { return this.children.filter(node => node.type === "button"); }
  get childElementCount() { return this.children.length; }
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/api-audit/openapi.json"), "utf8"));
  for (const [route, method] of [["/chats/archived", "get"], ["/chats/{chatId}/archive", "put"], ["/chats/{chatId}/restore", "put"], ["/chats/{chatId}/archive/download", "get"]]) assert.ok(spec.paths[route][method]);
  const id = "11111111-1111-1111-1111-111111111111";
  const conversation = { id: "local", chatId: id, title: "Test", messages: [{ content: "hors ligne" }] };
  const calls = [], notices = [], saves = [];
  let mode = "fail";
  const ctx = vm.createContext({
    document: { readyState: "loading", addEventListener() {}, createElement: () => new Node() },
    conversationMatches: () => true, sendMessage: async () => {}, currentConversation: () => conversation,
    store: { session: "session", agentId: 1, conversations: [conversation] }, busy: false, currentId: "other",
    confirm: () => true, closeMenus() {}, renderHistory() {}, newConversation() {}, saveStore() {},
    showToast: text => notices.push(text), makeId: () => "new", serverTime: () => 0,
    apiFetch: async (route, options = {}) => {
      calls.push([route, options.method || "GET"]);
      if (route.endsWith("/archive")) return { ok: mode !== "fail", status: mode === "fail" ? 500 : 200 };
      if (route.endsWith("/restore")) return { ok: true, status: 200 };
      if (route.endsWith("/archive/download")) return { ok: true, status: 200, body: {} };
      return { ok: true, json: async () => ({ chats: [{ id, title: "Test" }], hasMore: false }) };
    },
    saveResponse: async (name, response) => saves.push([name, response]),
    Date, Number, String, Object, Set, encodeURIComponent
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "archived-chats.js"), "utf8"), ctx);
  vm.runInContext("archivedChats.list = globalThis.list; archivedChats.more = globalThis.more; archivedChats.status = globalThis.status; archivedChats.panel = globalThis.panel", Object.assign(ctx, { list: new Node(), more: new Node(), status: new Node(), panel: new Node() }));
  ctx.panel.hidden = true;
  await ctx.archiveConversation("local");
  assert.equal(conversation.serverArchived, undefined);
  assert.equal(conversation.messages[0].content, "hors ligne");
  mode = "ok";
  await ctx.archiveConversation("local");
  assert.equal(conversation.serverArchived, true);
  assert.equal(ctx.conversationMatches(conversation, ""), false);
  await ctx.refreshArchivedChats();
  assert.equal(ctx.list.childElementCount, 1);
  const row = ctx.list.children[0];
  await ctx.downloadArchivedChat({ id }, row.children[2], "session");
  assert.equal(saves[0][0], `conversation-${id}.json`);
  await ctx.restoreArchivedChat({ id }, row, "session");
  assert.equal(conversation.serverArchived, undefined);
  assert.equal(conversation.needsLoad, true);
  assert.equal(conversation.messages[0].content, "hors ligne");
  assert.ok(calls.some(([route, method]) => route === `/chats/${id}/archive` && method === "PUT"));
  assert.ok(calls.some(([route, method]) => route === `/chats/${id}/restore` && method === "PUT"));
  assert.ok(notices.some(value => value.includes("impossible")));
}
main().then(() => console.log("Archives : contrats, erreur, restauration et téléchargement vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
