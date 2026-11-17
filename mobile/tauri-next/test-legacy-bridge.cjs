"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  const calls = [];
  let exchanges = 0;
  const transport = {
    async exchange(session, device) { assert.equal(session, "session"); assert.equal(device, "device"); return { accessToken: `token-${++exchanges}`, expiresIn: 300 }; },
    async request(request) { calls.push(request); return new Response(calls.length === 1 ? "refusé" : "ok", { status: calls.length === 1 ? 401 : 200 }); },
    async upload(file, token, signal, progress, kind) { assert.equal(file.name, "SKILL.md"); assert.equal(kind, "skill"); assert.equal(token, "token-2"); return { id: "skill-1" }; }
  };
  const context = vm.createContext({ window: { parent: { __franceStudentTransport: transport } }, auth: { accessToken: "", expiresAt: 0 }, store: { session: "session", deviceId: "device" }, TOKEN_MARGIN_MS: 60000, authError: message => new Error(message), getAccessToken: null, apiFetch: null, Date, FormData, Response, AbortController, JSON, encodeURIComponent });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-bridge.js"), "utf8"), context);
  const response = await context.apiFetch("/chats/stream", { method: "POST", stream: true, body: JSON.stringify({ agentId: 7, chatId: "11111111-1111-1111-1111-111111111111", initialContent: "Bonjour", files: ["file-1"], isPrivate: false }) });
  assert.equal(await response.text(), "ok");
  assert.equal(exchanges, 2);
  assert.equal(calls[1].path, "/chats/11111111-1111-1111-1111-111111111111");
  assert.deepEqual(JSON.parse(calls[1].body), { agentId: 7, content: "Bonjour", files: ["file-1"] });
  assert.equal(calls[1].token, "token-2");
  const created = context.tauriChatRequest("/chats/stream", "POST", JSON.stringify({ agentId: 7, initialContent: "Salut", projectId: "p", isIncognito: false }));
  assert.deepEqual(JSON.parse(created.body), { agentId: 7, initialContent: "Salut", projectId: "p" });
  await assert.rejects(context.apiFetch("/filesv2", { method: "POST", body: new FormData() }), /ne peut pas encore/);
  const form = new FormData(); form.append("files", new File(["skill"], "SKILL.md", { type: "text/markdown" }));
  assert.equal((await (await context.apiFetch("/skills", { method: "POST", body: form })).json()).id, "skill-1");
  transport.exchange = async () => { throw new Error("Le serveur a refusé la requête (HTTP 401)"); };
  context.auth.accessToken = "";
  context.authError = message => Object.assign(new Error(message), { auth: true });
  await assert.rejects(context.getAccessToken(), error => error.auth === true && /expirée/.test(error.message));
}
main().then(() => console.log("Pont Tauri : contrats et renouvellement vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
