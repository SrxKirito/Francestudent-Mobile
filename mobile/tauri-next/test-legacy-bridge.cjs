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
  // Un envoi Files V2 confirmé alimente le cache partagé ; une panne du cache ne casse jamais l'envoi.
  const noted = [];
  context.tauriFilesStore = { peekShared: () => ({ noteUploaded: raw => noted.push(raw) }) };
  transport.upload = async (file, token, signal, progress, kind) => { assert.equal(kind, "file"); return { id: "file-9", filename: "a.pdf" }; };
  const fileForm = new FormData(); fileForm.append("file", new File(["x"], "a.pdf"));
  assert.equal((await (await context.apiFetch("/filesv2", { method: "POST", body: fileForm })).json()).id, "file-9");
  assert.deepEqual(JSON.parse(JSON.stringify(noted)), [{ id: "file-9", filename: "a.pdf" }]);
  context.tauriFilesStore = { peekShared: () => { throw new Error("cache indisponible"); } };
  const fileForm2 = new FormData(); fileForm2.append("file", new File(["x"], "b.pdf"));
  assert.equal((await context.apiFetch("/filesv2", { method: "POST", body: fileForm2 })).status, 200);
  context.tauriFilesStore = undefined;
  let rateLimitRequests = 0;
  transport.request = async () => { rateLimitRequests++; return new Response("limite", { status: 429, headers: { "retry-after": "12" } }); };
  await assert.rejects(context.apiFetch("/chats?limit=20"), error => error.status === 429 && /12 secondes/.test(error.message));
  assert.equal(rateLimitRequests, 1, "une requête limitée ne doit pas être répétée automatiquement");
  transport.exchange = async () => { throw new Error("Le serveur a refusé la requête (HTTP 401)"); };
  context.auth.accessToken = "";
  context.authError = message => Object.assign(new Error(message), { auth: true });
  await assert.rejects(context.getAccessToken(), error => error.auth === true && /expirée/.test(error.message));
}
main().then(() => console.log("Pont Tauri : contrats et renouvellement vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
