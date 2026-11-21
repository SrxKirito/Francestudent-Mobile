// Vérification de la barre latérale Svelte dans un VRAI navigateur (Chrome ou Edge sans interface, piloté via CDP).
// Aucune dépendance installée : Node 24 fournit WebSocket, Vite est déjà dans le projet.
//
// Ce que ce script fait : démarre Vite, ouvre http://…/?ui=svelte avec un FAUX backend Tauri (invoke/Channel simulés,
// serveur de discussions simulé), puis clique réellement (souris CDP) dans la barre latérale Svelte et lit l'état du
// moteur legacy (iframe) et les requêtes envoyées au faux serveur.
//
// Ce que ce script NE prouve PAS : le comportement de WKWebView (iOS) ou d'Android WebView, les vraies commandes Rust,
// le vrai serveur France Student, le rendu visuel pixel par pixel. Il sort avec le code 2 si aucun navigateur n'est trouvé.
//
// Usage : node prepare-legacy.cjs ; node verify-shell-browser.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const browser = CANDIDATES.find(candidate => fs.existsSync(candidate));
if (!browser) {
  console.error("Aucun Chrome/Edge trouvé (variable CHROME_PATH possible) : vérification navigateur NON exécutée.");
  process.exit(2);
}

// --- Faux backend, injecté avant tout script de la page (fenêtre principale seulement) ---
const FAKE_BACKEND = String.raw`(() => {
  if (window.top !== window) return;
  const callbacks = new Map();
  let nextCallback = 1;
  const speechListeners = new Map();
  const U = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const ago = hours => new Date(Date.now() - hours * 3600e3).toISOString();
  const chat = (n, title, hours, extra) => Object.assign({ id: U(n), title, projectId: null, isPinned: false, lastMessageAt: ago(hours), createdAt: ago(hours), agent: { id: 1 } }, extra || {});
  const backend = window.__backend = {
    session: "session-de-test", calls: [], invokes: [], fail: {}, cancelled: [], released: false, streamPlan: null, uploads: new Map(), uploadHold: false, uploadFail: 0,
    prefs: { gptReasoning: "medium", customInstructions: "Réponds en français.", webSearchMode: "open" },
    web: { filterType: "allowlist", allowedDomains: [], blockedDomains: [] },
    chats: [chat(1, "Maths", 1), chat(2, "Histoire", 2), chat(5, "Physique", 3)],
    archived: [chat(3, "Vieille discussion", 90)],
    remote: [chat(4, "Géographie du serveur", 200)],
    usage: { chatBudget: { usedPercent: 75.4, remainingPercent: 24.6, resetAt: new Date(Date.now() + 5 * 3600e3).toISOString() } },
    skills: [{ id: "skill-1", name: "Résumé", description: "Synthétiser un texte", enabled: true }],
    mcp: [{ id: "mcp-1", server_label: "Démo", auth_type: "oauth", enabled: true, available_tools: [] }],
    files: [{ id: "file-1", filename: "notes-frst.txt", bytes: 17, created_at: 1700000000 }],
    projects: [{ id: U(81), name: "Projet de test", customInstructions: "Répondre brièvement." }],
    shares: [], savedMessages: [], exported: [],
    memories: [{ id: "mem-1", path: "préférences.md", content: "Mémoire de test" }],
    apiKey: false,
    sessions: [
      { id: "s-iphone", since: ago(48), os: "iOS 19", location: "Paris, France", lastActiveAt: ago(1) },
      { id: "s-web", since: ago(240), os: "Windows 11", location: "Lyon, France", lastActiveAt: ago(30) }
    ]
  };
  backend.speech = { started: [], cancelled: 0 };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, "speechSynthesis", { value: {
    speak: item => backend.speech.started.push({ text: item.text, lang: item.lang }),
    cancel: () => { backend.speech.cancelled++; }
  } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.href.startsWith("https://commons.wikimedia.org/w/api.php?")) {
      backend.calls.push({ method: "GET", path: url.href });
      const offset = Number(url.searchParams.get("gsroffset"));
      const titles = offset ? ["Troisième photo"] : ["Fuji à l’aube", "Fuji sous la neige"];
      return Response.json({
        query: { pages: titles.map((title, i) => ({
          pageid: offset + i + 1, title: "File:" + title + ".png",
          imageinfo: [{
            mime: "image/png",
            thumburl: "https://thumb.wikimedia.org/wikipedia/commons/test.png",
            url: "https://upload.wikimedia.org/wikipedia/commons/test.png",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(title) + ".png",
            extmetadata: { Artist: { value: "<span>Photographe de test</span>" }, LicenseShortName: { value: "CC0" } }
          }]
        })) },
        ...(offset ? {} : { continue: { gsroffset: 8 } })
      });
    }
    if (url.href === "https://upload.wikimedia.org/wikipedia/commons/test.png") {
      return new Response(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nN8AAAAASUVORK5CYII="), char => char.charCodeAt(0)), { headers: { "content-type": "image/png" } });
    }
    return originalFetch(input, options);
  };
  function route(method, path, body) {
    const url = new URL(path, "http://x");
    const p = url.pathname;
    backend.calls.push({ method, path: p + url.search, body: body || null });
    for (const [prefix, status] of Object.entries(backend.fail)) if ((method + " " + p).startsWith(prefix)) return [status, { error: "panne simulée" }];
    if (method === "GET" && p === "/chats/agents") return [200, [
      { id: 1, name: "GPT Test", model: "gpt-test", modelProvider: "OpenAI", isDefault: true },
      { id: 2, name: "Sonnet 4.6", model: "claude-sonnet", modelProvider: "anthropic" }
    ]];
    if (method === "GET" && p === "/chats") return [200, { chats: backend.chats }];
    if (method === "GET" && p === "/chats/archived") return [200, { chats: backend.archived, hasMore: false }];
    if (method === "GET" && p === "/chats/search") {
      const q = (url.searchParams.get("query") || "").toLowerCase();
      return [200, { chats: backend.remote.filter(c => c.title.toLowerCase().includes(q)), hasMore: false }];
    }
    if (p === "/skills" && method === "GET") return [200, { data: backend.skills, has_more: false }];
    if (p === "/skills/skill-1" && method === "POST") { Object.assign(backend.skills[0], JSON.parse(body)); return [200, {}]; }
    if (p === "/mcp/servers" && method === "GET") return [200, { data: backend.mcp }];
    if (p === "/mcp/servers" && method === "POST") {
      const row = { id: "mcp-2", ...JSON.parse(body) };
      backend.mcp.push(row); return [200, row];
    }
    if (p === "/mcp/servers/mcp-1/discover" && method === "POST") {
      backend.mcp[0].available_tools = [{ name: "outil-test", description: "Description simulée" }];
      return [200, {}];
    }
    if (p === "/mcp/servers/mcp-1/oauth/start" && method === "POST") return [200, { authorization_url: "https://example.org/oauth", state: "test-state" }];
    if (p === "/mcp/servers/oauth/complete" && method === "POST") {
      backend.mcp[0].has_authorization = true; return [200, {}];
    }
    const saved = p.match(/^\/user\/@me\/saved-messages\/([^/]+)\/([^/]+)$/);
    if (p === "/user/@me/saved-messages" && method === "GET") return [200, { savedMessages: backend.savedMessages, hasMore: false }];
    if (saved && (method === "PUT" || method === "DELETE")) {
      const [, chatId, messageId] = saved;
      backend.savedMessages = backend.savedMessages.filter(row => row.chatId !== chatId || row.messageId !== messageId);
      if (method === "PUT") {
        const message = backend.chats.find(chat => chat.id === chatId)?.chatMessages?.find(row => row.id === messageId);
        if (!message) return [404, {}];
        backend.savedMessages.push({ chatId, messageId, message });
      }
      return [200, {}];
    }
    if (p === "/user/@me/memories" && method === "GET") {
      return [200, { memories: backend.memories.map(({ id, path }) => ({ id, path })) }];
    }
    if (p === "/user/@me/memories/mem-1" && method === "GET") return [200, backend.memories[0]];
    if (p === "/user/@me/memories/mem-1" && method === "DELETE") { backend.memories = []; return [200, {}]; }
    if (p === "/user/@me/api-key") {
      if (method === "POST") { backend.apiKey = true; return [200, { key: "fixture-key-only" }]; }
      if (method === "DELETE") { backend.apiKey = false; return [200, {}]; }
      return [200, { maskedKey: backend.apiKey ? "fixture-•••" : null, budget: { remainingUsd: 5 } }];
    }
    if (p === "/filesv2/usage" && method === "GET") return [200, { usedBytes: 10000, maxBytes: 20000, remainingBytes: 10000, filesBytes: 8000, skillsBytes: 2000 }];
    if (p === "/filesv2" && method === "GET") return [200, { data: backend.files, has_more: false }];
    if (p === "/filesv2/file-1/content" && method === "GET") return [200, "Y29udGVudSBGUlNU"];
    if (p === "/filesv2/file-1" && method === "DELETE") { backend.files = backend.files.filter(file => file.id !== "file-1"); return [200, { deleted: true }]; }
    if (p === "/projects" && method === "GET") return [200, backend.projects];
    if (p === "/projects/shared" && method === "GET") return [200, []];
    if (p === "/projects/" + U(81) && method === "GET") return [200, backend.projects[0]];
    if (p === "/projects/" + U(81) && method === "PATCH") { Object.assign(backend.projects[0], JSON.parse(body)); return [200, backend.projects[0]]; }
    if (p === "/projects/" + U(81) + "/shares" && method === "GET") return [200, backend.shares];
    if (p === "/projects/" + U(81) + "/shares" && method === "POST") { backend.shares.push({ ...JSON.parse(body), userId: 18, permission: "View" }); return [200, {}]; }
    if (p === "/projects/" + U(81) + "/chats" && method === "GET") return [200, { chats: backend.chats.filter(row => row.projectId === U(81)) }];
    if (p.startsWith("/projects/" + U(81) + "/chats/") && ["PUT", "DELETE"].includes(method)) {
      const row = backend.chats.find(row => row.id === p.split("/").at(-1));
      if (row) row.projectId = method === "PUT" ? U(81) : null;
      return [row ? 200 : 404, row ?? {}];
    }
    if (method === "GET" && p === "/user/me") return [200, { name: "Test", email: "test@example.org" }];
    if (method === "GET" && p === "/user/usage") return [200, backend.usage];
    if (method === "GET" && p === "/user/tokenusage") {
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
      return [200, { totalTokenCount: 1234, last7DaysTokenUsage: [{ date: today, inputTokens: 300, outputTokens: 100, reasoningTokens: 0, totalTokens: 400 }] }];
    }
    if (method === "GET" && p === "/user/sessions") return [200, backend.sessions];
    if (method === "DELETE" && p === "/user/sessions") { backend.sessions = []; return [200, {}]; }
    const ended = p.match(/^\/user\/sessions\/([^/]+)$/);
    if (method === "DELETE" && ended) { backend.sessions = backend.sessions.filter(s => s.id !== decodeURIComponent(ended[1])); return [200, {}]; }
    if (method === "GET" && p === "/user/instructions") return [200, backend.prefs];
    if (method === "PATCH" && p === "/user/instructions") { Object.assign(backend.prefs, JSON.parse(body)); return [200, backend.prefs]; }
    if (method === "GET" && p === "/user/web-search-domains") return [200, backend.web];
    if (method === "PUT" && p === "/user/web-search-domains") { backend.web = JSON.parse(body); return [200, backend.web]; }
    if (method === "POST" && (p === "/files/upload" || p === "/filesv2")) return [200, { id: "fichier-" + backend.calls.length }];
    if (method === "POST" && /^\/chats\/[^/]+\/stream\/cancel$/.test(p)) { backend.released = true; return [200, {}]; }
    const m = p.match(/^\/chats\/([^/]+)(\/.*)?$/);
    if (m) {
      const id = m[1], sub = m[2] || "";
      const find = list => list.find(c => c.id === id);
      if (method === "GET" && sub === "") {
        const c = find(backend.chats) || find(backend.archived) || find(backend.remote);
      return c ? [200, Object.assign({ chatMessages: [] }, c)] : [404, {}];
      }
      if (method === "PATCH" && sub === "") { const c = find(backend.chats); if (c) c.title = JSON.parse(body).title; return [200, {}]; }
      if (sub === "/pins") { const c = find(backend.chats); if (c) c.isPinned = method === "PUT"; return [200, {}]; }
      if (method === "DELETE" && sub === "") { backend.chats = backend.chats.filter(c => c.id !== id); return [200, {}]; }
      if (method === "PUT" && sub === "/archive") { const c = find(backend.chats); if (c) { backend.chats = backend.chats.filter(x => x !== c); backend.archived.push(c); } return [200, {}]; }
      if (method === "PUT" && sub === "/restore") { const c = find(backend.archived); if (c) { backend.archived = backend.archived.filter(x => x !== c); backend.chats.push(c); } return [200, {}]; }
    }
    return [404, {}];
  }
  // Flux SSE simulé : backend.streamPlan = { status, events: [{ name, data, id, delay }], hold, chat, body }.
  function streamRequest(args) {
    const isStream = (args.method === "POST" && args.path.startsWith("/chats/stream")) || (args.method === "GET" && /^\/chats\/[^/]+\/stream/.test(args.path));
    if (!isStream) return null;
    backend.calls.push({ method: args.method, path: args.path, body: args.body || null });
    const plan = backend.streamPlan || { status: 200, events: [] };
    if (plan.chat && !backend.chats.some(c => c.id === U(plan.chat.n))) backend.chats.unshift(chat(plan.chat.n, plan.chat.title, 0));
    const encode = text => Array.from(new TextEncoder().encode(text));
    const gone = () => backend.cancelled.includes(args.id);
    return (async () => {
      const send = (index, message) => callbacks.get(args.onEvent.id)?.({ index, message });
      let index = 0;
      const status = plan.status || 200;
      send(index++, { kind: "started", status, content_type: plan.contentType || (status >= 400 ? "application/json" : "text/event-stream"), retry_after: null });
      if (status >= 400) {
        send(index++, { kind: "chunk", bytes: encode(plan.body || JSON.stringify({ error: "panne simulée" })) });
        send(index++, { kind: "finished" });
        return null;
      }
      for (const event of plan.events) {
        await new Promise(resolve => setTimeout(resolve, event.delay === undefined ? 15 : event.delay));
        if (gone()) return null;
        const text = (event.name ? "event: " + event.name + "\n" : "") + (event.id ? "id: " + event.id + "\n" : "") + "data: " + (typeof event.data === "string" ? event.data : JSON.stringify(event.data)) + "\n\n";
        send(index++, { kind: "chunk", bytes: encode(text) });
      }
      if (plan.hold) {
        while (!gone() && !backend.released) await new Promise(resolve => setTimeout(resolve, 30));
        if (gone()) return null;
      }
      send(index++, { kind: "finished" });
      return null;
    })();
  }
  window.__TAURI_INTERNALS__ = {
    transformCallback(callback) { const id = nextCallback++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    async invoke(command, args) {
      backend.invokes.push(command);
      switch (command) {
        case "plugin:dialog|save": return "conversation.json";
        case "plugin:fs|open": return 42;
        case "plugin:fs|write": backend.exported.push(...args.data); return args.data.length;
        case "plugin:resources|close": return null;
        case "session_read": return backend.session;
        case "session_write": backend.session = args.value; return null;
        case "session_delete": backend.session = null; return null;
        case "legacy_cancel": backend.cancelled.push(args.id); return null;
        case "legacy_exchange": return { accessToken: "jeton-de-test", expiresIn: 3600 };
        case "speech_supported": return true;
        case "plugin:stt|is_available": return { available: true };
        case "plugin:stt|check_permission": return { speechRecognition: "granted", microphone: "granted" };
        case "plugin:stt|register_listener": speechListeners.set(args.event, args.handler.id); return null;
        case "plugin:stt|remove_listener": speechListeners.delete(args.event); return null;
        case "plugin:stt|start_listening":
          setTimeout(() => callbacks.get(speechListeners.get("result"))?.({ index: 0, message: { transcript: "suite dictée" } }), 15);
          return null;
        case "plugin:stt|stop_listening": return null;
        case "upload_begin": {
          // Comme Rust : annonce « ready », puis attend upload_finish avant de répondre {id}.
          const channel = callbacks.get(args.onEvent.id);
          const entry = { chunks: 0, bytes: 0, name: args.name, kind: args.kind, done: false, cancelled: false };
          backend.uploads.set(args.id, entry);
          if (backend.uploadFail > 0) { backend.uploadFail -= 1; throw new Error("HTTP 500"); }
          setTimeout(() => channel?.({ index: 0, message: { kind: "ready" } }), 5);
          while ((!entry.done || backend.uploadHold) && !entry.cancelled) await new Promise(resolve => setTimeout(resolve, 10));
          if (entry.cancelled) throw new Error("Transfert annulé.");
          const id = "fichier-" + args.id.slice(0, 8);
          if (entry.kind === "skill") backend.skills.push({ id: "imported", name: "Skill importé", enabled: true });
          else {
            const file = { id, filename: entry.name, bytes: entry.bytes, created_at: Math.floor(Date.now() / 1000) };
            backend.files.push(file);
            return file;
          }
          return { id };
        }
        case "upload_chunk": {
          const entry = backend.uploads.get(args.id);
          if (entry) { entry.chunks += 1; entry.bytes += args.bytes.length; }
          return null;
        }
        case "upload_finish": { const entry = backend.uploads.get(args.id); if (entry) entry.done = true; return null; }
        case "upload_cancel": { const entry = backend.uploads.get(args.id); if (entry) entry.cancelled = true; return null; }
        case "legacy_request": {
          const streamed = streamRequest(args);
          if (streamed) return streamed;
          const [status, data] = route(args.method, args.path, args.body);
          const send = (index, message) => callbacks.get(args.onEvent.id)?.({ index, message });
          const bytes = Array.from(new TextEncoder().encode(JSON.stringify(data)));
          await new Promise(resolve => setTimeout(resolve, 5));
          send(0, { kind: "started", status, content_type: "application/json", retry_after: null });
          send(1, { kind: "chunk", bytes });
          send(2, { kind: "finished" });
          return null;
        }
        default: return null;
      }
    }
  };
})();`;

// --- Client CDP minimal ---
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.last = 0;
    this.pending = new Map();
    this.handlers = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (entry) message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
      } else for (const handler of this.handlers.get(message.method) || []) handler(message.params);
    };
  }
  send(method, params = {}) {
    const id = ++this.last;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, handler) {
    this.handlers.set(method, [...(this.handlers.get(method) || []), handler]);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-shell-verify-"));
let chrome = null;
let server = null;
let cdp = null;

async function cleanup() {
  try { cdp?.socket.close(); } catch {}
  if (chrome && !chrome.killed) chrome.kill();
  await sleep(300);
  try { await server?.close(); } catch {}
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(name);
    console.log("OK   " + name);
  } catch (error) {
    console.error("ÉCHEC " + name + "\n      " + (error && error.message ? error.message.split("\n").join("\n      ") : error));
    throw error;
  }
}

async function ev(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const inFrame = expression => ev(`(async () => { const w = document.querySelector("iframe").contentWindow; return await w.eval(${JSON.stringify(expression)}); })()`);

async function waitFor(expression, label, { frame = false, timeout = 12000 } = {}) {
  const read = frame ? inFrame : ev;
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await read(expression); if (last) return last; } catch (error) { last = String(error.message || error); }
    await sleep(60);
  }
  throw new Error("Délai dépassé : " + label + " (dernière valeur : " + JSON.stringify(last) + ")");
}

// Rectangle (dans la fenêtre principale) d'un élément désigné par une expression JS ; `frame` = élément de l'iframe.
async function rectOf(elementExpression, frame = false) {
  const code = frame
    ? `(() => { const f = document.querySelector("iframe"); const w = f.contentWindow; const e = w.eval(${JSON.stringify(elementExpression)}); if (!e) return null; const o = f.getBoundingClientRect(); const r = e.getBoundingClientRect(); return { x: o.x + r.x, y: o.y + r.y, w: r.width, h: r.height }; })()`
    : `(() => { const e = ${elementExpression}; if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
  return ev(code);
}

// Vrai clic souris, après avoir vérifié que l'élément est visible et que rien ne le recouvre au point cliqué.
async function click(label, elementExpression, frame = false, at = "center") {
  const rect = await rectOf(elementExpression, frame);
  assert.ok(rect && rect.w > 0 && rect.h > 0, `${label} : élément introuvable ou invisible`);
  // « right » : près du bord droit (le voile n'est cliquable qu'à droite du tiroir ouvert).
  const x = at === "right" ? rect.x + rect.w - 20 : rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  // Survol d'abord : certains boutons (« ⋯ ») ne sont visibles qu'au survol de leur ligne.
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(60);
  const covered = await ev(`(() => { const top = document.elementFromPoint(${x}, ${y}); return top ? top.tagName + "." + String(top.getAttribute("class") || "") + " dans " + (() => { const out = []; for (let n = top; n && n.nodeType === 1; n = n.parentElement) out.push(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "")); return out.join(" < "); })() : null; })()`);
  const same = await ev(frame
    ? `(() => { const f = document.querySelector("iframe"); return document.elementFromPoint(${x}, ${y}) === f; })()`
    : `(() => { const e = ${elementExpression}; const top = document.elementFromPoint(${x}, ${y}); return !!top && (e === top || e.contains(top)); })()`);
  assert.ok(same, `${label} : recouvert au point cliqué (${covered})`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

const historyItem = title => `[...document.querySelectorAll("#history .history-item")].find(e => e.querySelector(".history-title")?.textContent.trim() === ${JSON.stringify(title)})`;
const historyTitles = () => ev(`[...document.querySelectorAll("#history .history-title")].map(e => e.textContent.trim())`);
const labels = () => ev(`[...document.querySelectorAll("#history .history-label")].map(e => e.textContent.trim())`);
const calls = () => ev(`window.__backend.calls.map(c => c.method + " " + c.path)`);
const lastCalls = () => ev(`window.__backend.calls.slice(-6).map(c => c.method + " " + c.path)`);
const localId = title => inFrame(`(store.conversations.find(c => c.title === ${JSON.stringify(title)}) || {}).id || null`);
const dialogs = [];
const dialogPlan = [];

async function openMenuFor(title) {
  await click(`bouton « ⋯ » de ${title}`, `${historyItem(title)}?.querySelector(".history-more")`);
  await waitFor(`!document.getElementById("conv-menu").classList.contains("hidden")`, "menu ouvert");
}

async function main() {
  server = await createServer({
    root: here,
    logLevel: "error",
    cacheDir: path.join(temp, "vite"),
    server: { host: "127.0.0.1", port: 14231, strictPort: false, hmr: false, watch: null }
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");

  chrome = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + path.join(temp, "profile"), "about:blank"
  ], { stdio: "ignore", windowsHide: true });
  const portFile = path.join(temp, "profile", "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  assert.ok(fs.existsSync(portFile), "Le navigateur n'a pas ouvert son port de débogage");
  const port = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0];
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page"); } catch {}
    if (!target) await sleep(100);
  }
  assert.ok(target, "Aucun onglet navigateur");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("WebSocket CDP")); });
  cdp = new Cdp(socket);
  const pageErrors = [];
  cdp.on("Runtime.exceptionThrown", p => pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  cdp.on("Page.javascriptDialogOpening", params => {
    dialogs.push({ type: params.type, message: params.message });
    const plan = dialogPlan.shift() || { accept: false };
    void cdp.send("Page.handleJavaScriptDialog", { accept: plan.accept, promptText: plan.text || "" });
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_BACKEND });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (!process.env.FS_PREVIOUS_HYBRID) {
    await nativePhase(baseUrl, pageErrors);
    return;
  }
  // FS_CHAT_ONLY=1 : n'exécute que la phase chat (itération rapide) ; la vérification complète les enchaîne toutes.
  if (process.env.FS_CHAT_ONLY) {
    await chatPhase(baseUrl, pageErrors);
    return;
  }
  await cdp.send("Page.navigate", { url: baseUrl + "/?ui=svelte&chat=legacy" });

  // 1. Démarrage ---------------------------------------------------------------------------------------------------
  await check("démarrage : la coque Svelte affiche sa propre barre latérale dans la page parente", async () => {
    await waitFor(`!!document.querySelector("aside#sidebar")`, "aside#sidebar dans la page parente", { timeout: 40000 });
    await waitFor(`document.querySelectorAll("#history .history-item").length >= 3`, "discussions dans la barre Svelte", { timeout: 30000 });
    assert.equal(await ev(`document.querySelector("aside#sidebar").offsetWidth > 200`), true, "barre Svelte visible (grand écran)");
    assert.equal(await inFrame(`getComputedStyle(document.getElementById("sidebar")).display`), "none", "barre legacy masquée");
  });

  await check("liste : les discussions du serveur sont là, l'archivée n'y est pas", async () => {
    const titles = await historyTitles();
    for (const wanted of ["Maths", "Histoire", "Physique"]) assert.ok(titles.includes(wanted), "manque " + wanted + " : " + titles);
    assert.ok(!titles.includes("Vieille discussion"), "une discussion archivée ne doit pas apparaître");
  });

  // 2. Ouverture et nouvelle discussion ---------------------------------------------------------------------------
  await check("ouvrir une discussion (clic réel) change la discussion courante du moteur et charge ses messages", async () => {
    await click("ligne Histoire", historyItem("Histoire"));
    const id = await localId("Histoire");
    await waitFor(`currentId === ${JSON.stringify(id)}`, "currentId = Histoire", { frame: true });
    await waitFor(`window.__backend.calls.some(c => c.method === "GET" && c.path === "/chats/00000000-0000-4000-8000-000000000002")`, "GET /chats/{id}");
    await waitFor(`document.querySelector("#history .history-item.active .history-title")?.textContent.trim() === "Histoire"`, "ligne active");
  });
  await check("nouvelle discussion (clic réel) : le moteur n'a plus de discussion courante", async () => {
    await click("Nouvelle discussion", `document.getElementById("new-chat")`);
    await waitFor(`currentId === null`, "currentId = null", { frame: true });
    await waitFor(`!document.querySelector("#history .history-item.active")`, "plus de ligne active");
  });

  // 3. Épingler ------------------------------------------------------------------------------------------------
  await check("épingler puis désépingler : groupe « Épinglées » et requêtes PUT/DELETE /pins", async () => {
    await openMenuFor("Maths");
    assert.ok((await ev(`document.getElementById("conv-pin").textContent`)).includes("Épingler"));
    await click("Épingler", `document.getElementById("conv-pin")`);
    await waitFor(`[...document.querySelectorAll("#history .history-label")].some(e => e.textContent.trim() === "Épinglées")`, "groupe Épinglées");
    await waitFor(`window.__backend.calls.some(c => c.method === "PUT" && c.path.endsWith("0001/pins"))`, "PUT /pins");
    await openMenuFor("Maths");
    assert.ok((await ev(`document.getElementById("conv-pin").textContent`)).includes("Désépingler"));
    await click("Désépingler", `document.getElementById("conv-pin")`);
    await waitFor(`![...document.querySelectorAll("#history .history-label")].some(e => e.textContent.trim() === "Épinglées")`, "groupe Épinglées disparu");
    await waitFor(`window.__backend.calls.some(c => c.method === "DELETE" && c.path.endsWith("0001/pins"))`, "DELETE /pins");
  });

  // 4. Renommer, avec et sans panne serveur -------------------------------------------------------------------------
  await check("renommer : la barre et le serveur reçoivent le nouveau titre", async () => {
    dialogPlan.push({ accept: true, text: "Algèbre" });
    await openMenuFor("Maths");
    await click("Renommer", `document.getElementById("conv-rename")`);
    await waitFor(`document.querySelector("#history")?.textContent.includes("Algèbre")`, "titre Algèbre dans la barre Svelte");
    await waitFor(`window.__backend.calls.some(c => c.method === "PATCH" && c.body && JSON.parse(c.body).title === "Algèbre")`, "PATCH /chats/{id}");
    assert.equal(dialogs.at(-1).type, "prompt");
  });
  await check("renommer pendant une panne serveur : l'utilisateur est prévenu (toast visible)", async () => {
    await ev(`window.__backend.fail = { "PATCH /chats": 500 }`);
    dialogPlan.push({ accept: true, text: "Géométrie" });
    await openMenuFor("Histoire");
    await click("Renommer", `document.getElementById("conv-rename")`);
    await waitFor(`document.querySelector("#history")?.textContent.includes("Géométrie")`, "titre local changé");
    const toast = await waitFor(`(() => { const t = document.getElementById("app-toast"); return t && t.classList.contains("show") && t.classList.contains("error") ? t.textContent : ""; })()`, "toast d'erreur de synchronisation", { frame: true });
    assert.match(toast, /serveur/i);
    await ev(`window.__backend.fail = {}`);
  });

  // 5. Archiver / restaurer ---------------------------------------------------------------------------------------
  await check("le menu « ⋯ » propose Archiver", async () => {
    await openMenuFor("Algèbre");
    const items = await ev(`[...document.querySelectorAll("#conv-menu .menu-item")].map(e => e.textContent.trim())`);
    assert.ok(items.includes("Archiver"), "entrées : " + items);
    await ev(`document.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
    await waitFor(`document.getElementById("conv-menu").classList.contains("hidden")`, "menu refermé par clic extérieur");
  });
  await check("archiver : confirmation, PUT /archive, la discussion quitte la barre Svelte et apparaît dans les archives", async () => {
    dialogPlan.push({ accept: true });
    await openMenuFor("Algèbre");
    await click("Archiver", `[...document.querySelectorAll("#conv-menu .menu-item")].find(e => e.textContent.trim() === "Archiver")`);
    await waitFor(`window.__backend.calls.some(c => c.method === "PUT" && c.path.endsWith("0001/archive"))`, "PUT /archive");
    await waitFor(`!(${historyItem("Algèbre")})`, "Algèbre retirée de la barre Svelte");
    assert.equal(dialogs.at(-1).type, "confirm");
    await click("Conversations archivées", `document.querySelector(".archived-chat-toggle")`);
    await waitFor(`document.querySelectorAll(".archived-chats-panel .archived-chat-row").length === 2`, "2 archives listées (Vieille discussion + Algèbre)");
    const rows = await ev(`[...document.querySelectorAll(".archived-chats-panel .archived-chat-row span")].map(e => e.textContent.trim())`);
    assert.ok(rows.includes("Vieille discussion") && rows.includes("Algèbre"), "lignes : " + rows);
  });
  await check("restaurer : PUT /restore, la discussion revient dans la barre Svelte", async () => {
    await click("Restaurer Algèbre", `[...document.querySelectorAll(".archived-chat-row")].find(r => r.textContent.includes("Algèbre"))?.querySelector("button")`);
    await waitFor(`window.__backend.calls.some(c => c.method === "PUT" && c.path.endsWith("0001/restore"))`, "PUT /restore");
    await waitFor(`!!(${historyItem("Algèbre")})`, "Algèbre revenue dans la barre Svelte");
    await waitFor(`document.querySelectorAll(".archived-chats-panel .archived-chat-row").length === 1`, "1 archive restante");
    await click("replier les archives", `document.querySelector(".archived-chat-toggle")`);
    await waitFor(`document.querySelector(".archived-chats-panel").hidden === true`, "panneau replié");
  });

  // 6. Recherche locale et distante ---------------------------------------------------------------------------------
  await check("recherche : saisie réelle, filtre local, résultats en ligne cliquables qui ouvrent la discussion", async () => {
    await click("champ de recherche", `document.getElementById("search-input")`);
    await cdp.send("Input.insertText", { text: "géo" });
    await waitFor(`[...document.querySelectorAll("#history .history-title")].every(e => /géo/i.test(e.textContent))`, "filtre local appliqué");
    await waitFor(`document.querySelector(".remote-chat-search-results .remote-chat-search-result")`, "résultat en ligne", { timeout: 8000 });
    const remote = await ev(`[...document.querySelectorAll(".remote-chat-search-result")].map(e => e.textContent.trim())`);
    assert.ok(remote.includes("Géographie du serveur"), "résultats en ligne : " + remote);
    assert.ok((await calls()).some(c => c.startsWith("GET /chats/search?query=g")), "requête de recherche distante envoyée");
    await click("résultat en ligne", `document.querySelector(".remote-chat-search-result")`);
    await waitFor(`(store.conversations.find(c => c.title === "Géographie du serveur") || {}).id === currentId`, "discussion distante ouverte", { frame: true });
  });
  await check("recherche vidée (Échap) : la liste complète et les résultats en ligne disparaissent", async () => {
    await ev(`document.getElementById("search-input").focus()`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(`document.getElementById("search-input").value === ""`, "champ vidé");
    await waitFor(`document.querySelector(".remote-chat-search-results")?.hidden !== false`, "résultats en ligne masqués");
    await waitFor(`document.querySelectorAll("#history .history-item").length >= 3`, "liste complète");
  });

  // 7. Supprimer -----------------------------------------------------------------------------------------------
  await check("supprimer : refus de la confirmation = rien ne change ; acceptation = DELETE et disparition", async () => {
    const seen = dialogs.length;
    dialogPlan.push({ accept: false });
    await openMenuFor("Physique");
    await click("Supprimer", `document.getElementById("conv-delete")`);
    for (let i = 0; i < 50 && dialogs.length <= seen; i += 1) await sleep(100);
    assert.ok(dialogs.length > seen, "la boîte de confirmation de suppression doit s'afficher");
    await sleep(300);
    assert.ok(!(await calls()).some(c => c.startsWith("DELETE /chats/00000000-0000-4000-8000-000000000005")), "aucun DELETE après refus");
    assert.ok((await historyTitles()).includes("Physique"));
    dialogPlan.push({ accept: true });
    await openMenuFor("Physique");
    await click("Supprimer", `document.getElementById("conv-delete")`);
    await waitFor(`!(${historyItem("Physique")})`, "Physique supprimée de la barre");
    await waitFor(`window.__backend.calls.some(c => c.method === "DELETE" && c.path === "/chats/00000000-0000-4000-8000-000000000005")`, "DELETE /chats/{id}");
  });

  // 8. Responsive : tiroir sur écran étroit -------------------------------------------------------------------------
  await check("écran étroit : la barre est un tiroir fermé, s'ouvre au bouton du moteur, se ferme au voile et au choix d'une discussion", async () => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    await waitFor(`window.innerWidth === 390`, "fenêtre étroite");
    await waitFor(`document.getElementById("sidebar") && !document.getElementById("sidebar").classList.contains("open")`, "tiroir fermé");
    // Le passage au mode tiroir déclenche la transition de 0,28 s : on attend sa fin avant de mesurer.
    await waitFor(`document.getElementById("sidebar").getBoundingClientRect().right <= 1`, "tiroir fermé hors écran après la transition");
    await click("bouton de menu du moteur", `document.getElementById("menu-toggle")`, true);
    await waitFor(`document.getElementById("sidebar").classList.contains("open")`, "tiroir ouvert");
    await sleep(450);
    assert.ok((await ev(`document.getElementById("sidebar").getBoundingClientRect().left`)) >= -1, "tiroir entièrement visible après l'animation");
    assert.equal(await ev(`document.getElementById("overlay").classList.contains("hidden")`), false, "voile affiché");
    await click("voile", `document.getElementById("overlay")`, false, "right");
    await waitFor(`!document.getElementById("sidebar").classList.contains("open")`, "tiroir refermé par le voile");
    await waitFor(`document.getElementById("sidebar").getBoundingClientRect().right <= 1`, "tiroir refermé après la transition");
    await click("bouton de menu du moteur", `document.getElementById("menu-toggle")`, true);
    await waitFor(`document.getElementById("sidebar").classList.contains("open")`, "tiroir rouvert");
    await sleep(450);
    await click("ligne Maths", historyItem("Algèbre"));
    await waitFor(`!document.getElementById("sidebar").classList.contains("open")`, "tiroir refermé après ouverture d'une discussion");
    const id = await localId("Algèbre");
    await waitFor(`currentId === ${JSON.stringify(id)}`, "discussion ouverte depuis le tiroir", { frame: true });
  });
  await check("retour grand écran : barre fixe, aucun tiroir ouvert", async () => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFor(`window.innerWidth === 1280 && document.getElementById("sidebar").getBoundingClientRect().left >= -1`, "barre fixe visible");
    assert.equal(await ev(`document.getElementById("overlay").classList.contains("hidden")`), true, "voile masqué");
  });

  // 9. Chat Svelte (recharge la page avec ?chat=svelte : le faux backend repart à neuf) -------------------------------
  await chatPhase(baseUrl, pageErrors);

  await check("aucune exception JavaScript non gérée dans la page principale", async () => {
    assert.deepEqual(pageErrors, [], "exceptions : " + JSON.stringify(pageErrors));
  });
}

// --- Phase chat Svelte (sous-drapeau ?chat=svelte) -------------------------------------------------------------------
// PNG valide généré à la volée (aucune dépendance) : base64 > 200 caractères, exigé par le moteur pour une image générée.
function makePng(size = 32) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = y * stride + 1 + x * 4;
      raw[o] = (x * 37 + y * 11) & 255;
      raw[o + 1] = (y * 53 + x * 7) & 255;
      raw[o + 2] = (x * y * 13) & 255;
      raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head, data])) >>> 0);
    return Buffer.concat([length, head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const chatId = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const PANE = `document.querySelector("main.main > .chat-pane")`;
const thread = () => ev(`[...document.querySelectorAll("#thread > .message")].map(m => ({ role: ["user", "assistant", "error"].find(r => m.classList.contains(r)) || "", text: (m.querySelector(".bubble")?.textContent || "").trim() }))`);
const setPlan = plan => ev(`(() => { const b = window.__backend; b.streamPlan = ${JSON.stringify(plan)}; b.released = false; b.cancelled.length = 0; return true; })()`);
const streamPosts = () => ev(`window.__backend.calls.filter(c => c.method === "POST" && c.path.startsWith("/chats/stream"))`);
const delta = (text, n = 9) => ({ name: "response.output_text.delta", data: { delta: text, chat_id: chatId(n) } });
const done = (text, n = 9, id = "msg-" + n) => ({ name: "completed", data: { chat_id: chatId(n), message: { id, role: "assistant", content: text } } });

async function typeMessage(text) {
  await ev(`document.getElementById("prompt").focus()`);
  await cdp.send("Input.insertText", { text });
  await waitFor(`document.getElementById("prompt").value === ${JSON.stringify(text)}`, "texte saisi dans le composer Svelte");
}
async function sendMessage() {
  await waitFor(`!document.getElementById("send").disabled`, "bouton Envoyer actif");
  await click("Envoyer", `document.getElementById("send")`);
}
const settled = label => waitFor(`!document.querySelector("#send.stop")`, "fin de génération : " + label, { timeout: 15000 });
const engineBusy = () => inFrame("busy");
async function freshChat() {
  await click("Nouvelle discussion", `document.getElementById("new-chat")`);
  await waitFor(`currentId === null`, "currentId = null", { frame: true });
  await waitFor(`!document.querySelector("#thread > .message")`, "fil vide");
}

async function nativePhase(baseUrl, pageErrors) {
  const q = selector => "document.querySelector(" + JSON.stringify(selector) + ")";
  const has = selector => "!!" + q(selector);
  const contains = (selector, value) => q(selector) + "?.textContent.includes(" + JSON.stringify(value) + ")";
  async function input(selector, value) {
    await ev("(() => { const el = " + q(selector) + "; el.focus(); el.select(); })()");
    await cdp.send("Input.insertText", { text: value });
  }
  async function escape() {
    const args = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...args });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...args });
  }
  await cdp.send("Page.navigate", { url: baseUrl + "/" });
  await check("coque native par défaut et historique", async () => {
    await waitFor('document.querySelectorAll("#history .history-item").length >= 3 && !document.querySelector(".chat-pane")?.classList.contains("chat-pane-hidden")', "coque native prête", { timeout: 30000 });
    assert.equal(await ev(has("iframe")), false);
  });
  await check("Claude affiche une ressource locale et OpenAI garde sa marque", async () => {
    await click("Catalogue", q("#model-button"));
    const claude = '#model-menu [data-id="2"] img';
    await waitFor(q(claude) + "?.naturalWidth > 0", "logo Claude chargé");
    assert.ok((await ev(q(claude) + '.getAttribute("src")')).endsWith("/legacy/logo/claude.png"));
    assert.equal(await ev(has('#model-menu [data-id="1"] .chatgpt-symbol')), true);
    await escape();
  });
  await check("import : thème, validation sans requête et fermeture", async () => {
    await click("Importer", q("#conversation-import-open"));
    await waitFor(has("dialog.import-dialog[open]"), "dialogue ouvert");
    assert.equal(await ev("document.activeElement.id"), "import-title");
    assert.notEqual(await ev("getComputedStyle(" + q("dialog.import-dialog") + ").backgroundColor"), "rgb(255, 255, 255)");
    await input("#import-link", "https://example.org/faux");
    await click("Valider le lien", q("dialog.import-dialog button[type=submit]"));
    await waitFor(q("#import-status") + "?.textContent.length > 0", "lien rejeté");
    assert.equal(await ev('window.__backend.calls.some(row => row.path.startsWith("/conversation-imports"))'), false);
    await click("Annuler", q('dialog.import-dialog button[type="button"]'));
    await waitFor("!" + has("dialog.import-dialog[open]"), "fermeture");
  });
  await check("slash : ouverture, filtre, annulation, sélection et envoi", async () => {
    await input("#prompt", "un / au milieu");
    assert.equal(await ev(has("#skill-menu")), false);
    await input("#prompt", "/");
    await waitFor(contains("#skill-menu", "/resume"), "skill du catalogue simulé");
    await input("#prompt", "/inconnu");
    await waitFor(contains("#skill-menu", "Aucun skill"), "aucun résultat");
    await escape();
    assert.equal(await ev(has("#skill-menu")), false);
    await input("#prompt", "/res");
    await waitFor(has("#skill-choice-0"), "suggestion filtrée");
    await click("Sélection du skill", q("#skill-choice-0"));
    await waitFor(q("#prompt") + '.value === "/resume "', "commande insérée");
    await cdp.send("Input.insertText", { text: "Synthétise." });
    await setPlan({ events: [
      { name: "response.output_item.added", data: { item: { id: "appel", type: "mcp_call", name: "Catalogue", arguments: "données internes" } } },
      { name: "response.mcp_call.completed", data: { item_id: "appel" }, delay: 450 },
      { ...delta("Réponse de test", 44), delay: 450 }, done("Réponse de test", 44)
    ] });
    await click("Envoyer", q("#send"));
    await waitFor(contains(".tool-progress", "Catalogue · En cours"), "appel MCP en cours");
    assert.equal(await ev(contains(".tool-progress", "données internes")), false);
    await waitFor(contains(".tool-progress", "Catalogue · Terminé"), "appel MCP terminé");
    await waitFor(contains("#thread", "Réponse de test"), "réponse du flux");
    assert.match((await streamPosts()).at(-1).body, /Skill imposé.*skill-1/);
  });
  await check("historique natif : recherche serveur, ouverture et archives", async () => {
    await input("#search-input", "Géographie");
    await waitFor(contains(".remote-chat-search-results", "Géographie du serveur"), "résultat distant");
    await click("Résultat distant", q(".remote-chat-search-result"));
    await waitFor('window.__backend.calls.some(row => row.path === "/chats/00000000-0000-4000-8000-000000000004")', "conversation distante chargée");
    await input("#search-input", "");
    await escape();
    await click("Archives", q(".archived-chat-toggle"));
    await waitFor(contains(".archived-chats-panel", "Vieille discussion"), "archive chargée");
    await click("Restaurer", q('.archived-chats-panel button[aria-label="Restaurer Vieille discussion"]'));
    await waitFor('!!(' + historyItem("Vieille discussion") + ')', "archive restaurée dans l’historique");
  });
  await check("messages enregistrés : ajouter, retrouver et retirer dans la bibliothèque", async () => {
    await ev(`window.__backend.chats.find(c => c.title === "Maths").chatMessages = [
      { id: "saved-m1", role: "assistant", content: "Contenu à retrouver" }
    ]`);
    await click("Maths", historyItem("Maths"));
    await waitFor(contains("#thread", "Contenu à retrouver"), "message chargé");
    await click("Enregistrer le message", q("#thread .assistant .message-actions button"));
    await waitFor("window.__backend.savedMessages.length === 1", "message stocké côté serveur");
    await click("Bibliothèque", q("#library-open"));
    await waitFor(has("#svelte-library[open]"), "bibliothèque ouverte");
    await click("Messages enregistrés", q("#svelte-library > button[aria-expanded]"));
    await waitFor(contains("#svelte-library section", "Contenu à retrouver"), "message retrouvé");
    await click("Ouvrir la conversation d’origine", q("#svelte-library section article button:first-of-type"));
    await waitFor("!" + has("#svelte-library[open]") + " && " + contains("#thread", "Contenu à retrouver"), "retour au chat");
    await click("Bibliothèque", q("#library-open"));
    await waitFor(has("#svelte-library[open]"), "bibliothèque ouverte à nouveau");
    await click("Messages enregistrés", q("#svelte-library > button[aria-expanded]"));
    await waitFor(contains("#svelte-library section", "Contenu à retrouver"), "message retrouvé après réouverture");
    await click("Retirer", q("#svelte-library section article button:last-child"));
    await waitFor(contains("#svelte-library section", "Aucun message enregistré."), "message retiré");
    await escape();
  });
  await check("rendus structurés : graphique, zoom et checklist sans HTML actif", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const structured = fields => fence + "frst-ui\n" + JSON.stringify({ version: 1, ...fields }) + "\n" + fence;
    const answer = structured({ kind: "chart", title: "Mesures", chart: "bar", series: [
      { name: "Essai", points: [{ label: "Matin", y: 2 }, { label: "Soir", y: -3 }] }
    ] }) + "\n\n" + structured({ kind: "checklist", items: ['<img id="frst-injection" src=x>'] });
    await ev(`window.__backend.chats.find(c => c.title === "Histoire").chatMessages = [
      { id: "widgets-1", role: "assistant", content: ${JSON.stringify(answer)} }
    ]`);
    await click("Histoire", historyItem("Histoire"));
    await waitFor(has('#thread svg[aria-label="Mesures"]'), "graphique rendu");
    const wordButton = word => `[...document.querySelectorAll("#thread button")].find(button => button.textContent.includes(${JSON.stringify(word)}))`;
    await click("Agrandir", wordButton("Agrandir le graphique"));
    assert.equal(await ev(wordButton("Agrandir le graphique") + '.getAttribute("aria-pressed")'), "true");
    await click("Voir les données", wordButton("Voir les données"));
    assert.equal(await ev(contains('#thread table[aria-label="Mesures"]', "Soir")), true);
    const box = '#thread section[aria-label="Liste à cocher"] input';
    await click("Cocher", q(box));
    assert.equal(await ev(q(box) + ".checked"), true);
    assert.equal(await ev(has("#frst-injection")), false);
    assert.equal(await ev(contains("#thread", '<img id="frst-injection"')), true);
  });
  await check("export de texte : conversation active et sélecteur de fichier", async () => {
    await click("Menu de Maths", "(" + historyItem("Maths") + ')?.querySelector(".history-more")');
    const item = `[...document.querySelectorAll("#conv-menu button")].find(b => b.textContent.includes("Exporter le texte"))`;
    await click("Exporter", item);
    await waitFor("window.__backend.exported.length > 0", "écriture via le pont fichiers");
    const payload = await ev("JSON.parse(new TextDecoder().decode(Uint8Array.from(window.__backend.exported)))");
    assert.deepEqual(payload, { title: "Maths", messages: [{ role: "assistant", content: "Contenu à retrouver" }] });
  });
  await check("stockage FRST : limite, transfert et confirmation Svelte", async () => {
    await click("Ouvrir les paramètres", q("#user-button"));
    await waitFor(has("#tab-storage"), "onglet stockage");
    await click("Stockage", q("#tab-storage"));
    const textButton = word => `[...document.querySelectorAll("#panel-storage button")].find(button => button.textContent.includes(${JSON.stringify(word)}))`;
    await waitFor(`!(${textButton("Gérer les fichiers")})?.disabled`, "quota chargé");
    await click("Gérer les fichiers", textButton("Gérer les fichiers"));
    await waitFor(contains("#panel-storage", "notes-frst.txt"), "liste Files V2");
    const choose = (name, size) => ev(`(() => {
      const picker = document.querySelector('#panel-storage input[type="file"]');
      const transfer = new DataTransfer();
      const file = new File(["bonjour"], ${JSON.stringify(name)}, { type: "text/plain" });
      if (${size}) Object.defineProperty(file, "size", { value: ${size} });
      transfer.items.add(file);
      picker.files = transfer.files;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await choose("trop-grand.txt", 50 * 1024 * 1024 + 1);
    await waitFor(contains("#panel-storage [role=alert]", "dépasse 50 Mo"), "limite de taille appliquée");
    assert.equal(await ev("window.__backend.uploads.size"), 0);
    await choose("transfert-frst.txt", 0);
    await waitFor(contains("#panel-storage", "transfert-frst.txt"), "fichier chargé dans Files V2");
    await ev("window.__backend.uploadHold = true");
    await choose("transfert-annule.txt", 0);
    await waitFor("window.__backend.uploads.size === 2", "transfert en cours");
    await click("Annuler le transfert", textButton("Annuler le transfert"));
    await waitFor("[...window.__backend.uploads.values()].some(row => row.name === 'transfert-annule.txt' && row.cancelled)", "annulation transmise au pont Rust");
    assert.equal(await ev("window.__backend.files.some(file => file.filename === 'transfert-annule.txt')"), false);
    await ev("window.__backend.uploadHold = false");
    const remove = `[...document.querySelectorAll("#panel-storage .settings-item")].find(item => item.textContent.includes("notes-frst.txt"))?.querySelector(".danger")`;
    await waitFor("!(" + remove + ")?.disabled && !" + has('#panel-storage progress[aria-label="Progression du transfert"]'), "transfert terminé");
    await ev("(" + remove + ')?.scrollIntoView({ block: "center" })');
    await click("Supprimer le fichier", remove);
    await waitFor(has("dialog.fs-confirm[open]"), "confirmation Svelte ouverte");
    assert.equal(await ev("window.__backend.files.some(file => file.id === 'file-1')"), true);
    await click("Confirmer", q(".fs-confirm-ok"));
    await waitFor("!window.__backend.files.some(file => file.id === 'file-1')", "suppression envoyée");
    assert.equal(await ev("window.__backend.files.some(file => file.filename === 'transfert-frst.txt')"), true);
    assert.equal(dialogs.length, 0);
    await click("Fermer les paramètres", q("#settings-close"));
  });
  await check("chargement à la demande : ouvrir un projet et prévisualiser un fichier", async () => {
    await click("Projets", q("#projects-open"));
    await waitFor(contains("#svelte-projects", "Projet de test"), "liste des projets");
    const project = `[...document.querySelectorAll("#svelte-projects button")].find(button => button.textContent.trim() === "Projet de test")`;
    await click("Ouvrir le projet", project);
    await waitFor(contains("#project-context-name", "Projet de test"), "projet actif dans la barre latérale");
    await click("Quitter le projet", q("#project-leave"));
    await waitFor(q("#project-context") + ".hidden", "retour à l’historique principal");
    await click("Bibliothèque", q("#library-open"));
    await waitFor(contains("#svelte-library", "transfert-frst.txt"), "fichier FRST dans la bibliothèque");
    const file = `[...document.querySelectorAll("#svelte-library .library-open")].find(button => button.textContent.includes("transfert-frst.txt"))`;
    await click("Prévisualiser", file);
    await waitFor(contains("dialog.preview-dialog[open] #preview-title", "transfert-frst.txt"), "module d’aperçu ouvert");
    await escape();
  });
  await check("mémoires du compte : liste, lecture à la demande et suppression", async () => {
    await click("Ouvrir les paramètres", q("#user-button"));
    await waitFor(has("#tab-account"), "onglet compte");
    await click("Compte", q("#tab-account"));
    const memory = `[...document.querySelectorAll("#panel-account details")].find(item => item.querySelector("summary")?.textContent.includes("Mémoires du compte"))`;
    await ev("(" + memory + ')?.scrollIntoView({ block: "center" })');
    await click("Mémoires du compte", "(" + memory + ')?.querySelector("summary")');
    await waitFor("(" + memory + ')?.textContent.includes("préférences.md")', "liste des mémoires");
    assert.equal(await ev('window.__backend.calls.some(row => row.path === "/user/@me/memories/mem-1")'), false);
    const read = "(" + memory + ')?.querySelector("article button:first-child")';
    await ev("(" + read + ')?.scrollIntoView({ block: "center" })');
    await click("Lire", read);
    await waitFor("(" + memory + ')?.textContent.includes("Mémoire de test")', "mémoire affichée");
    const remove = "(" + memory + ')?.querySelector("article button:last-child")';
    await ev("(" + remove + ')?.scrollIntoView({ block: "center" })');
    await click("Supprimer la mémoire", remove);
    await waitFor(has("dialog.fs-confirm[open]"), "confirmation mémoire");
    await click("Confirmer", q(".fs-confirm-ok"));
    await waitFor("(" + memory + ')?.textContent.includes("Aucune mémoire enregistrée.")', "mémoire supprimée");
    await click("Fermer les paramètres", q("#settings-close"));
  });
  await check("lire une réponse et arrêter en changeant de discussion", async () => {
    await click("Ouvrir Maths", historyItem("Maths"));
    const read = '#thread .assistant button[aria-label="Lire à voix haute"]';
    await waitFor(has(read), "lecture vocale disponible");
    await click("Lire à voix haute", q(read));
    await waitFor(has('#thread button[aria-label="Arrêter la lecture"][aria-pressed=true]'), "lecture active");
    assert.equal(await ev("window.__backend.speech.started.at(-1).text"), "Contenu à retrouver");
    await click("Changer de discussion", historyItem("Histoire"));
    await waitFor("window.__backend.speech.cancelled === 1", "lecture interrompue");
  });
  await check("ouvrir et enregistrer des exports Word et Excel", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const content = fence + "docx\n# rapport.docx\n# Résumé\nDocument créé pour le test.\n" + fence +
      "\n\n" + fence + 'xlsx\n# tableau.xlsx\n[["Nom","Total"],["Test",42]]\n' + fence;
    await ev(`window.__backend.chats.find(c => c.title === "Physique").chatMessages = [
      { id: "office-exports", role: "assistant", content: ${JSON.stringify(content)} }
    ]`);
    await click("Ouvrir Physique", historyItem("Physique"));
    for (const [name, preview] of [["rapport.docx", "Document créé pour le test."], ["tableau.xlsx", "42"]]) {
      const card = `[...document.querySelectorAll("#thread button.artifact")].find(button => button.textContent.trim() === ${JSON.stringify(name)})`;
      await waitFor("!!(" + card + ")", "carte " + name);
      await click("Ouvrir " + name, card);
      await waitFor(contains("dialog.preview-dialog .preview-content pre", preview), "aperçu de " + name);
      await ev("window.__backend.exported = []");
      await click("Enregistrer " + name, q("dialog.preview-dialog footer button.primary"));
      await waitFor("window.__backend.exported.length > 100", "fichier enregistré");
      assert.deepEqual(await ev("window.__backend.exported.slice(0, 4)"), [80, 75, 3, 4]);
      await escape();
      await waitFor("!" + has("dialog.preview-dialog[open]"), "aperçu fermé");
    }
  });
  await check("Wikimedia Commons : recherche, pagination, aperçu, téléchargement et historique", async () => {
    await input("#prompt", "Trouve-moi des images du mont Fuji");
    const posts = (await streamPosts()).length;
    await click("Rechercher des images", q("#send"));
    const gallery = ".image-search-gallery";
    await waitFor(contains(gallery, "Fuji à l’aube"), "résultats Commons");
    assert.equal((await streamPosts()).length, posts);
    assert.equal(await ev(q(gallery + " a") + '.hostname'), "commons.wikimedia.org");
    await click("Charger plus d’images", q(gallery + " > button"));
    await waitFor(contains(gallery, "Troisième photo"), "page suivante");
    await click("Afficher la première image", q(gallery + " .tile"));
    await waitFor(has("dialog.commons-preview[open]"), "aperçu Commons");
    const nav = word => `[...document.querySelectorAll("dialog.commons-preview button")].find(b => b.textContent.trim() === ${JSON.stringify(word)})`;
    const galleryClick = async (label, selector) => {
      await ev("(" + selector + ')?.scrollIntoView({ block: "center" })');
      await click(label, selector);
    };
    await galleryClick("Suivante", nav("Suivante"));
    assert.equal(await ev(contains("dialog.commons-preview h3", "Fuji sous la neige")), true);
    await galleryClick("Agrandir", nav("Agrandir"));
    assert.equal(await ev(has("dialog.commons-preview .visual.zoom")), true);
    await galleryClick("Télécharger l’image", nav("Télécharger"));
    await waitFor(contains("dialog.commons-preview [role=status]", "Image téléchargée."), "écriture de l’original");
    await galleryClick("Enregistrer l’image", nav("Enregistrer dans la bibliothèque"));
    await waitFor(contains("dialog.commons-preview [role=status]", "Image enregistrée"), "copie en bibliothèque");
    await escape();
    await click("Bibliothèque", q("#library-open"));
    await waitFor(contains("#svelte-library", "Fuji sous la neige"), "image conservée dans la bibliothèque");
    assert.equal(await ev(contains("#svelte-library", "Photographe de test · CC0")), true);
    await escape();
    await click("Autre discussion", historyItem("Maths"));
    await waitFor("!" + has(gallery), "galerie fermée");
    await click("Historique des images", historyItem("Images · mont Fuji"));
    await waitFor(contains(gallery, "Troisième photo"), "pages restaurées depuis l’historique");
    const searchCalls = 'window.__backend.calls.filter(row => row.path.startsWith("https://commons.wikimedia.org/w/api.php")).length';
    assert.equal(await ev(searchCalls), 2);
    await cdp.send("Page.reload");
    await waitFor('!!(' + historyItem("Images · mont Fuji") + ') && !document.querySelector(".chat-pane")?.classList.contains("chat-pane-hidden")', "historique restauré après rechargement", { timeout: 30000 });
    await click("Historique restauré", historyItem("Images · mont Fuji"));
    await waitFor(contains(gallery, "Troisième photo"), "galerie retrouvée après rechargement");
    assert.equal(await ev(searchCalls), 0);
  });
  await check("animations Svelte : menus et modales, mouvement réduit respecté", async () => {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await click("Outils du compositeur", q("#attach"));
    await waitFor(has("#attach-menu:not(.hidden)"), "menu outils ouvert");
    assert.equal(await ev("getComputedStyle(" + q("#attach-menu") + ").animationName"), "fs-rise");
    await escape();
    await click("Importer", q("#conversation-import-open"));
    await waitFor(has("dialog.import-dialog[open]"), "modale animée ouverte");
    assert.equal(await ev("getComputedStyle(" + q("dialog.import-dialog") + ").animationName"), "fs-rise");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert.equal(await ev("getComputedStyle(" + q("dialog.import-dialog") + ").animationName"), "none");
    assert.equal(await ev("getComputedStyle(" + q("#send") + ").transitionDuration"), "0s");
    await escape();
    await waitFor("!" + has("dialog.import-dialog[open]"), "fermeture en mouvement réduit");
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  });
  await check("petite hauteur : compositeur et dialogue dans la fenêtre", async () => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 370, deviceScaleFactor: 1, mobile: false });
    await waitFor('(() => { const r = document.querySelector("#composer").getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1; })()', "compositeur contenu");
    await click("Ouvrir le tiroir", q("#menu-toggle"));
    await waitFor(`(() => {
      const button = document.querySelector("#sidebar.open #conversation-import-open");
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })()`, "tiroir ouvert et animation terminée");
    await click("Importer", q("#conversation-import-open"));
    await waitFor(has("dialog.import-dialog[open]"), "modale compacte");
    assert.equal(await ev(q("dialog.import-dialog") + ".scrollWidth <= " + q("dialog.import-dialog") + ".clientWidth + 1"), true);
    await escape();
  });
  await check("secours hybride : montage et raccordement du pont historique", async () => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: baseUrl + "/?ui=svelte&chat=legacy" });
    await waitFor(has("main iframe"), "iframe de secours montée");
    await waitFor(`(() => {
      const el = document.querySelector("main iframe");
      const frame = el?.contentWindow;
      return Boolean(frame?.document.getElementById("fs-engine-style"));
    })()`, "pont installé dans l’iframe");
    await waitFor('document.querySelectorAll("#history .history-item").length >= 3', "historique de secours synchronisé", { timeout: 15000 }).catch(async error => {
      const details = await inFrame(`({ ready: document.readyState, hasTransport: !!parent.__franceStudentTransport, appHidden: document.getElementById("app")?.classList.contains("hidden"), count: document.querySelectorAll("#history .history-item").length })`);
      throw new Error(error.message + " " + JSON.stringify({ details, pageErrors }));
    });
    assert.equal(await inFrame('!!document.getElementById("fs-engine-style")'), true);
    await click("Rechercher dans le secours", q("#search-input"));
    await cdp.send("Input.insertText", { text: "Maths" });
    await waitFor("document.querySelectorAll('#history .history-item').length === 1", "historique hybride filtré");
    assert.equal(await inFrame('document.getElementById("search-input").value'), "Maths");
  });
  await check("aucune exception JavaScript non gérée", async () => assert.deepEqual(pageErrors, []));
}

async function chatPhase(baseUrl, pageErrors) {
  const consoleErrors = [];
  cdp.on("Runtime.consoleAPICalled", p => { if (p.type === "error" || p.type === "warning") consoleErrors.push(p.type + ": " + p.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300)); });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: baseUrl + "/?ui=svelte&chat=svelte" });
  // La page recharge avec le cache local de la phase précédente (« Algèbre », renommée avant) : on attend la synchro
  // avec le faux serveur neuf (titre « Maths ») et non le simple nombre de lignes, sinon la suite clique trop tôt.
  await waitFor(`!!${PANE} && !!(${historyItem("Maths")}) && document.querySelectorAll("#history .history-item").length >= 3`, "chat Svelte monté et liste synchronisée avec le serveur", { timeout: 40000 });

  await check("chat : la surcouche Svelte recouvre exactement l'iframe legacy, qui reste vivante mais inerte", async () => {
    await waitFor(`!${PANE}.classList.contains("chat-pane-hidden")`, "surcouche visible");
    const geo = await ev(`(() => { const main = document.querySelector("main.main"); const pane = ${PANE}; const frame = main.querySelector("iframe"); const a = main.getBoundingClientRect(); const b = pane.getBoundingClientRect(); const top = document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2); return { same: Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1, inert: frame.inert, covered: pane.contains(top), frameDisplay: getComputedStyle(frame).display, frameWidth: frame.getBoundingClientRect().width }; })()`);
    assert.equal(geo.same, true, "la surcouche doit avoir la boîte de main : " + JSON.stringify(geo));
    assert.equal(geo.inert, true, "l'iframe doit être inerte sous la surcouche");
    assert.equal(geo.covered, true, "le centre de la zone doit appartenir à la surcouche");
    assert.notEqual(geo.frameDisplay, "none", "l'iframe ne doit jamais être en display:none (le moteur y tourne)");
    assert.ok(geo.frameWidth > 100, "l'iframe garde une taille réelle");
    assert.equal(await ev(`!!document.getElementById("empty-state") && !document.getElementById("empty-state").classList.contains("hidden")`), true, "état vide affiché");
    assert.equal(await ev(`!!document.querySelector("#composer #prompt") && !!document.getElementById("send")`), true, "composer Svelte présent");
  });

  await check("chat : ouvrir une discussion existante affiche l'historique (Markdown, code, tableau, formule KaTeX)", async () => {
    const md = "Voici **du gras** et `du code`.\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nFormule : $x^2 + 1$";
    await ev(`(() => { const c = window.__backend.chats.find(c => c.title === "Maths"); c.chatMessages = [ { id: "m1", role: "user", content: "Explique-moi", createdAt: new Date().toISOString() }, { id: "m2", role: "assistant", content: ${JSON.stringify(md)}, createdAt: new Date().toISOString(), isUpvoted: null } ]; return true; })()`);
    await click("ligne Maths", historyItem("Maths"));
    await waitFor(`document.querySelectorAll("#thread > .message").length === 2`, "2 messages affichés", { timeout: 15000 });
    const view = await ev(`(() => { const a = document.querySelector("#thread > .message.assistant .bubble"); return { user: document.querySelector("#thread > .message.user .bubble")?.textContent.trim(), strong: a.querySelector("strong")?.textContent, code: !!a.querySelector("pre code"), table: !!a.querySelector("table"), cells: [...a.querySelectorAll("td")].map(e => e.textContent.trim()), katex: !!a.querySelector(".katex"), empty: document.getElementById("empty-state").classList.contains("hidden") }; })()`);
    assert.equal(view.user, "Explique-moi");
    assert.equal(view.strong, "du gras");
    assert.equal(view.code, true, "bloc de code rendu");
    assert.equal(view.table, true, "tableau rendu");
    assert.deepEqual(view.cells, ["1", "2"]);
    assert.equal(view.katex, true, "formule rendue par KaTeX : " + JSON.stringify(view));
    assert.equal(view.empty, true, "l'état vide disparaît quand la discussion a des messages");
  });

  await check("chat : nouvelle discussion, envoi réel, flux affiché au fil de l'eau, génération terminée sans gel", async () => {
    await freshChat();
    await setPlan({ status: 200, chat: { n: 9, title: "Salutations" }, events: [delta("Salut, "), delta("je suis "), delta("là."), done("Salut, je suis là.")] });
    await typeMessage("Bonjour test");
    await sendMessage();
    await waitFor(`document.querySelector("#thread > .message.assistant .bubble")?.textContent.includes("Salut, je suis là.")`, "réponse complète affichée", { timeout: 15000 });
    await settled("réponse simple");
    assert.equal(await engineBusy(), false, "le moteur doit sortir de l'état occupé");
    const posts = await streamPosts();
    assert.equal(posts.length, 1, "un seul POST /chats/stream");
    assert.ok(String(posts[0].body).includes("Bonjour test"), "le message de l'utilisateur est dans la requête : " + posts[0].body);
    const msgs = await thread();
    assert.deepEqual(msgs.map(m => m.role), ["user", "assistant"]);
    assert.equal(msgs[0].text, "Bonjour test");
    assert.equal(await ev(`document.getElementById("prompt").value`), "", "le champ est vidé après l'envoi");
    assert.notEqual(await inFrame("currentId"), null, "la discussion créée devient la discussion courante");
  });

  await check("chat : arrêter une génération en cours (clic sur Arrêter) demande l'annulation au serveur et conserve le texte partiel", async () => {
    await freshChat();
    await setPlan({ status: 200, hold: true, chat: { n: 10, title: "Longue réponse" }, events: [delta("Début de la réponse", 10)] });
    await typeMessage("Écris un long texte");
    await sendMessage();
    await waitFor(`document.querySelector("#thread > .message.assistant .bubble")?.textContent.includes("Début de la réponse")`, "texte partiel affiché", { timeout: 15000 });
    await waitFor(`!!document.querySelector("#send.stop")`, "bouton Arrêter affiché");
    assert.equal(await engineBusy(), true, "le moteur est occupé pendant le flux");
    await click("Arrêter la génération", `document.getElementById("send")`);
    await waitFor(`window.__backend.calls.some(c => c.method === "POST" && c.path === "/chats/${chatId(10)}/stream/cancel")`, "annulation côté serveur demandée (comme le legacy)");
    await settled("arrêt");
    assert.equal(await engineBusy(), false, "le moteur n'est plus occupé après l'arrêt");
    const text = (await thread()).filter(m => m.role === "assistant").map(m => m.text).join("|");
    assert.ok(text.includes("Début de la réponse"), "le texte partiel est conservé : " + text);
    await ev(`window.__backend.released = true`);
  });

  await check("chat : erreur HTTP 500 → message d'erreur avec « Réessayer » ; le nouvel essai réussit", async () => {
    await freshChat();
    await setPlan({ status: 500, body: JSON.stringify({ error: "panne simulée" }), events: [] });
    await typeMessage("Question qui échoue");
    await sendMessage();
    await waitFor(`!!document.querySelector("#thread > .message.error")`, "message d'erreur", { timeout: 15000 });
    await settled("erreur 500");
    const labelsSeen = await ev(`[...document.querySelectorAll("#thread > .message.error .msg-action")].map(b => b.textContent.trim())`);
    assert.ok(labelsSeen.includes("Réessayer"), "actions : " + labelsSeen);
    assert.ok((await thread()).some(m => m.role === "error" && m.text.length > 0), "l'erreur affiche un texte");
    await setPlan({ status: 200, chat: { n: 11, title: "Reprise" }, events: [delta("Cette fois, ça marche.", 11), done("Cette fois, ça marche.", 11)] });
    await click("Réessayer", `document.querySelector("#thread > .message.error .retry-action")`);
    await waitFor(`document.querySelector("#thread > .message.assistant .bubble")?.textContent.includes("Cette fois, ça marche.")`, "réponse après nouvel essai", { timeout: 15000 });
    await settled("nouvel essai");
    assert.equal(await ev(`!!document.querySelector("#thread > .message.error")`), false, "le message d'erreur disparaît après réussite");
  });

  await check("chat : événement SSE « error » → erreur affichée, aucun gel", async () => {
    await freshChat();
    await setPlan({ status: 200, events: [delta("Début"), { name: "error", data: { error: { message: "Modèle indisponible", type: "server_error" } } }] });
    await typeMessage("Question SSE en erreur");
    await sendMessage();
    await waitFor(`!!document.querySelector("#thread > .message.error")`, "erreur de flux affichée", { timeout: 15000 });
    await settled("erreur SSE");
    assert.equal(await engineBusy(), false);
  });

  await check("chat : sources web affichées (pastille, cartes cliquables avec les bonnes adresses)", async () => {
    await freshChat();
    const sources = [{ url: "https://fr.wikipedia.org/wiki/Paris", title: "Paris" }, { url: "https://www.example.org/article", title: "Article" }];
    await setPlan({ status: 200, chat: { n: 12, title: "Avec sources" }, events: [{ name: "response.output_item.done", data: { item: { type: "web_search_call", action: { sources } } } }, delta("Paris est la capitale.", 12), done("Paris est la capitale.", 12)] });
    await typeMessage("Capitale de la France ?");
    await sendMessage();
    await waitFor(`document.querySelectorAll("#thread .source-card[href]").length >= 2`, "cartes de sources", { timeout: 15000 });
    await settled("sources");
    const hrefs = await ev(`[...document.querySelectorAll("#thread .source-card[href]")].map(a => a.getAttribute("href"))`);
    assert.ok(hrefs.includes("https://fr.wikipedia.org/wiki/Paris") && hrefs.includes("https://www.example.org/article"), "adresses : " + hrefs);
    assert.equal(await ev(`!!document.querySelector("#thread .sources-pill")`), true, "pastille de sources");
    assert.equal(await ev(`document.querySelector("#thread .source-card[href]").getAttribute("target")`), "_blank");
  });

  await check("chat : image générée décodée et affichée (naturalWidth > 0)", async () => {
    await freshChat();
    const png = makePng(32).toString("base64");
    assert.ok(png.length > 200, "le PNG de test doit dépasser 200 caractères base64 (" + png.length + ")");
    await setPlan({ status: 200, chat: { n: 13, title: "Image" }, events: [{ name: "response.output_item.done", data: { item: { type: "image_generation_call", result: png } } }, done("Voici l'image.", 13)] });
    await typeMessage("Dessine un motif");
    await sendMessage();
    await waitFor(`(() => { const i = document.querySelector("#thread .generated-image img"); return !!i && i.complete && i.naturalWidth > 0; })()`, "image décodée", { timeout: 15000 });
    await settled("image");
    assert.equal(await ev(`document.querySelector("#thread .generated-image img").naturalWidth`), 32);
  });

  const attachFiles = async (files, selector = "#file-input") => {
    await cdp.send("DOM.enable");
    const root = await cdp.send("DOM.getDocument", { depth: 1 });
    const input = await cdp.send("DOM.querySelector", { nodeId: root.root.nodeId, selector });
    assert.ok(input.nodeId, "champ " + selector + " introuvable dans la page parente");
    await cdp.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files });
  };

  await check("chat : pièces jointes téléversées dès la sélection → puces, envoi avec leurs identifiants, puces retirées", async () => {
    await freshChat();
    const file = path.join(temp, "cours.txt");
    const picture = path.join(temp, "schema.png");
    fs.writeFileSync(file, "Notes de cours de test\n");
    fs.writeFileSync(picture, makePng(32));
    await attachFiles([file, picture]);
    await waitFor(`document.querySelectorAll("#attachments .attachment-chip").length === 2`, "deux puces de pièces jointes", { timeout: 10000 });
    const names = await ev(`[...document.querySelectorAll("#attachments .attachment-name")].map(e => e.textContent)`);
    assert.ok(names.some(n => n.includes("cours.txt")) && names.some(n => n.includes("schema.png")), "puces : " + names);
    await waitFor(`[...window.__backend.uploads.values()].filter(u => u.done).length === 2`, "les deux fichiers sont téléversés (upload_begin/chunk/finish)", { timeout: 15000 });
    await waitFor(`!document.querySelector("#attachments .tauri-upload-status")`, "puces sans statut d'envoi en cours", { timeout: 10000 });
    await setPlan({ status: 200, chat: { n: 14, title: "Avec fichier" }, events: [delta("Fichier reçu.", 14), done("Fichier reçu.", 14)] });
    await typeMessage("Résume ce fichier");
    await sendMessage();
    await waitFor(`document.querySelector("#thread > .message.assistant .bubble")?.textContent.includes("Fichier reçu.")`, "réponse avec pièces jointes", { timeout: 15000 });
    await settled("pièces jointes");
    const posts = await streamPosts();
    assert.ok(/fichier-/.test(String(posts.at(-1).body)), "la requête référence les fichiers téléversés : " + posts.at(-1).body);
    assert.equal(await ev(`document.querySelectorAll("#attachments .attachment-chip").length`), 0, "les pièces jointes sont retirées après l'envoi");
  });

  await check("chat : envoi de fichier en cours → statut visible, bouton Envoyer désactivé, réactivé une fois terminé", async () => {
    await freshChat();
    const picture = path.join(temp, "schema-lent.png");
    fs.writeFileSync(picture, makePng(32));
    await ev(`window.__backend.uploadHold = true`);
    try {
      await attachFiles([picture]);
      await typeMessage("Que montre ce schéma ?");
      await waitFor(`document.querySelector("#attachments .tauri-upload-status")`, "statut d'envoi affiché", { timeout: 10000 });
      const label = await ev(`document.querySelector("#attachments .tauri-upload-status").textContent`);
      assert.ok(/Envoi|En attente/.test(label), "libellé du statut : " + label);
      assert.equal(await ev(`document.querySelector("#send").disabled`), true, "Envoyer désactivé pendant l'envoi");
    } finally {
      await ev(`window.__backend.uploadHold = false`);
    }
    await waitFor(`!document.querySelector("#attachments .tauri-upload-status")`, "statut retiré une fois le fichier envoyé", { timeout: 15000 });
    await waitFor(`document.querySelector("#send").disabled === false`, "Envoyer réactivé", { timeout: 5000 });
    await ev(`document.querySelector("#attachments .attachment-remove").click()`);
    await waitFor(`document.querySelectorAll("#attachments .attachment-chip").length === 0`, "puce retirée", { timeout: 5000 });
    await ev(`(() => { const p = document.getElementById("prompt"); p.focus(); p.select(); document.execCommand("delete"); return p.value; })()`);
    await waitFor(`document.getElementById("prompt").value === ""`, "brouillon vidé");
  });

  await check("chat : échec d'envoi de fichier → « Réessayer » rétablit l'envoi", async () => {
    await freshChat();
    const picture = path.join(temp, "schema-echec.png");
    fs.writeFileSync(picture, makePng(32));
    await ev(`window.__backend.uploadFail = 1`);
    await attachFiles([picture]);
    await typeMessage("Que montre ce schéma ?");
    await waitFor(`document.querySelector("#attachments .tauri-upload-status button")`, "bouton Réessayer affiché", { timeout: 10000 });
    const label = await ev(`document.querySelector("#attachments .tauri-upload-status").textContent`);
    assert.ok(/Échec/.test(label), "libellé du statut : " + label);
    assert.equal(await ev(`document.querySelector("#send").disabled`), true, "Envoyer désactivé après l'échec");
    await click("Réessayer l'envoi", `document.querySelector("#attachments .tauri-upload-status button")`);
    await waitFor(`!document.querySelector("#attachments .tauri-upload-status")`, "statut retiré après le nouvel essai", { timeout: 15000 });
    await waitFor(`document.querySelector("#send").disabled === false`, "Envoyer réactivé", { timeout: 5000 });
    await ev(`document.querySelector("#attachments .attachment-remove").click()`);
    await waitFor(`document.querySelectorAll("#attachments .attachment-chip").length === 0`, "puce retirée", { timeout: 5000 });
  });

  await check("chat : les notifications du moteur s'affichent dans le ToastHost Svelte", async () => {
    await inFrame(`showToast("Essai de notification", true)`);
    const text = await waitFor(`(() => { const t = document.getElementById("app-toast"); return t && t.classList.contains("show") && t.classList.contains("error") ? t.textContent : ""; })()`, "toast dans la page parente", { timeout: 6000 });
    assert.match(text, /Essai de notification/);
  });

  await check("chat : import d'une conversation — dialogue, lien invalide refusé sans requête, fermeture", async () => {
    const before = (await calls()).length;
    await click("Importer", `document.getElementById("conversation-import-open")`);
    await waitFor(`!!document.querySelector("dialog.conversation-import-dialog[open]")`, "dialogue d'import ouvert");
    await ev(`document.querySelector("dialog.conversation-import-dialog input.settings-input").focus()`);
    await cdp.send("Input.insertText", { text: "https://example.org/pas-un-partage" });
    await click("Importer (valider)", `[...document.querySelectorAll("dialog.conversation-import-dialog button")].find(b => b.textContent.trim() === "Importer")`);
    const status = await waitFor(`document.querySelector("dialog.conversation-import-dialog .conversation-import-status")?.textContent.trim()`, "message d'état de l'import", { timeout: 8000 });
    assert.ok(status.length > 0, "un message explique le refus");
    assert.equal((await calls()).length, before, "aucune requête réseau pour un lien invalide");
    await click("Fermer", `[...document.querySelectorAll("dialog.conversation-import-dialog button")].find(b => b.textContent.trim() === "Fermer")`);
    await waitFor(`!document.querySelector("dialog.conversation-import-dialog[open]")`, "dialogue d'import fermé");
  });

  await check("chat : « Gérer les accès » du menu ⋯ ouvre le dialogue de partage, qui se ferme", async () => {
    await openMenuFor("Maths");
    await click("Gérer les accès", `[...document.querySelectorAll("#conv-menu .menu-item")].find(e => e.textContent.includes("accès"))`);
    await waitFor(`!!document.querySelector('dialog[aria-label="Accès à la conversation"][open]')`, "dialogue de partage ouvert");
    await click("Fermer", `[...document.querySelectorAll('dialog[aria-label="Accès à la conversation"] button')].find(b => b.textContent.trim() === "Fermer")`);
    await waitFor(`!document.querySelector('dialog[aria-label="Accès à la conversation"][open]')`, "dialogue de partage fermé");
  });

  const settingsOpenNow = `!!document.getElementById("settings-modal") && document.body.classList.contains("settings-open")`;
  const settingsClosedNow = `!document.getElementById("settings-modal") && !document.body.classList.contains("settings-open")`;
  const pressEscape = async () => {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  };
  const openSvelteSettings = async () => {
    await click("Paramètres", `document.getElementById("user-button")`);
    await waitFor(settingsOpenNow, "dialogue Paramètres (Svelte) ouvert", { timeout: 8000 });
  };
  const closeSvelteSettings = async () => {
    await pressEscape();
    await waitFor(settingsClosedNow, "dialogue Paramètres (Svelte) fermé");
  };
  const generalReady = `!!document.getElementById("personalization-fields") && !document.getElementById("personalization-fields").disabled`;
  const patchBodies = () => ev(`window.__backend.calls.filter(c => c.method === "PATCH" && c.path === "/user/instructions").map(c => JSON.parse(c.body))`);

  await check("réglages : « Paramètres » ouvre le dialogue Svelte sur Général et charge les préférences ; Échap le ferme et rend le focus", async () => {
    await waitFor(`!${PANE}.classList.contains("chat-pane-hidden")`, "surcouche visible avant");
    const before = (await calls()).length;
    await openSvelteSettings();
    assert.equal(await ev(`document.getElementById("tab-general").getAttribute("aria-selected")`), "true", "l'onglet Général est sélectionné");
    try {
      await waitFor(`document.getElementById("custom-instructions").value.startsWith("Réponds en français.")`, "instructions personnalisées chargées depuis le serveur", { timeout: 8000 });
    } catch (error) {
      const state = await ev(`JSON.stringify({ status: document.getElementById("personalization-status")?.textContent, value: document.getElementById("custom-instructions")?.value, disabled: document.getElementById("personalization-fields")?.disabled, retryHidden: document.getElementById("personalization-retry")?.hidden })`);
      throw new Error(error.message + " — état du dialogue : " + state);
    }
    assert.ok((await calls()).slice(before).includes("GET /user/instructions"), "GET /user/instructions attendu : " + JSON.stringify((await calls()).slice(before)));
    assert.equal(await inFrame(`document.body.classList.contains("settings-open")`), false, "la fenêtre de réglages classique ne doit pas s'ouvrir");
    assert.equal(await ev(`${PANE}.classList.contains("chat-pane-hidden")`), false, "la surcouche de chat reste en place");
    await closeSvelteSettings();
    assert.equal(await ev(`document.activeElement && document.activeElement.id`), "user-button", "le focus revient sur le bouton Paramètres");
  });

  const select = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const buttonWith = (parent, label) => `[...document.querySelectorAll(${JSON.stringify(parent + " button")})].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
  const contains = (parent, label) => select(parent) + `?.textContent.includes(${JSON.stringify(label)})`;
  const clickButton = (parent, label) => click(label, buttonWith(parent, label));
  async function setField(selector, value) {
    await ev(`(() => { const input = ${select(selector)}; input.focus(); input.select(); })()`);
    await cdp.send("Input.insertText", { text: value });
  }

  await check("skills : activation et import Markdown dans le panneau Svelte", async () => {
    await openSvelteSettings();
    await click("Skills", select("#tab-skills"));
    await waitFor(contains("#panel-skills", "Résumé"), "skill du compte chargé");
    assert.equal(await inFrame(`document.body.classList.contains("settings-open")`), false);
    const toggle = select("#panel-skills [role=switch]");
    await click("Désactiver Résumé", toggle);
    await waitFor(`window.__backend.skills[0].enabled === false && !${toggle}.disabled`, "skill désactivé");
    await click("Activer Résumé", toggle);
    await waitFor(`window.__backend.skills[0].enabled === true && !${toggle}.disabled`, "skill activé");
    const file = path.join(temp, "modele.md");
    fs.writeFileSync(file, "# Résumé");
    await attachFiles([file], '#panel-skills input[type="file"]');
    await waitFor(contains("#panel-skills", "Skill importé"), "skill importé");
    assert.equal(await ev(`[...window.__backend.uploads.values()].find(row => row.kind === "skill")?.name`), "SKILL.md");
    await closeSvelteSettings();
  });

  await check("skills : le raccourci / transmet la consigne et garde la saisie dans la bulle", async () => {
    await freshChat();
    await setField("#prompt", "/");
    await waitFor(contains("#skill-menu", "/resume"), "menu de skills");
    await click("Choisir le skill", select("#skill-menu button"));
    await waitFor(`document.getElementById("prompt").value === "/resume "`, "commande insérée");
    await cdp.send("Input.insertText", { text: "Synthétise le texte." });
    const before = (await streamPosts()).length;
    await setPlan({ events: [delta("Résumé de test", 44), done("Résumé de test", 44)] });
    await sendMessage();
    await waitFor(`window.__backend.calls.filter(c => c.method === "POST" && c.path.startsWith("/chats/stream")).length > ${before}`, "requête chat");
    await settled("skill");
    assert.match((await streamPosts()).at(-1).body, /Skill imposé.*skill-1/);
    assert.equal((await thread()).find(row => row.role === "user")?.text, "/resume Synthétise le texte.");
  });

  await check("dictée : le composeur Svelte ajoute un résultat natif simulé au brouillon et permet l’arrêt", async () => {
    await setField("#prompt", "Début");
    await click("Dicter", select("#mic"));
    await waitFor(select("#prompt") + '.value === "Début suite dictée"', "texte dicté");
    assert.equal(await ev(select("#mic") + '.getAttribute("aria-pressed")'), "true");
    await click("Arrêter la dictée", select("#mic"));
    await waitFor(`window.__backend.invokes.includes("plugin:stt|stop_listening") && ${select("#mic")}.getAttribute("aria-pressed") === "false"`, "arrêt transmis au pont natif");
    await ev(`(() => { const prompt = ${select("#prompt")}; prompt.value = ""; prompt.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  });

  await check("MCP : découverte des outils, connexion OAuth et ajout dans l’assistant Svelte", async () => {
    await openSvelteSettings();
    await click("MCP", select("#tab-mcp"));
    await waitFor(select('[data-mcp-id="mcp-1"]') + " !== null", "serveur MCP chargé");
    await clickButton("#panel-mcp", "Actualiser les outils");
    await waitFor(contains("#panel-mcp", "outil-test"), "outils découverts");
    await clickButton("#panel-mcp", "Connecter mon compte");
    await waitFor(select('#panel-mcp a[href="https://example.org/oauth"]') + " !== null", "lien OAuth");
    await setField('#panel-mcp article input[type="password"]', "code-de-test");
    await clickButton("#panel-mcp", "Terminer la connexion");
    await waitFor(contains("#panel-mcp", "Authentifié"), "OAuth terminé");
    await clickButton("#panel-mcp", "Ajouter MCP");
    await waitFor(select("#panel-mcp dialog[open]") + " !== null", "assistant ouvert");
    await setField("#panel-mcp dialog input:not([type])", "exemple");
    await setField('#panel-mcp dialog input[type="url"]', "https://example.org/mcp");
    await clickButton("#panel-mcp dialog", "Continuer");
    await waitFor(select("#panel-mcp dialog select") + " !== null", "choix de l’authentification");
    await clickButton("#panel-mcp dialog", "Continuer");
    await clickButton("#panel-mcp dialog", "Ajouter le serveur");
    await waitFor(select('[data-mcp-id="mcp-2"]') + " !== null", "serveur ajouté");
    await closeSvelteSettings();
  });

  await check("Files V2 : quota, bibliothèque, miniature de texte et suppression", async () => {
    const openStorage = async () => {
      await openSvelteSettings();
      await click("Stockage", select("#tab-storage"));
      await waitFor(select("#panel-storage progress") + "?.value === 50", "quota Files V2 affiché");
      await clickButton("#panel-storage", "Gérer les fichiers");
      await waitFor(contains("#panel-storage", "notes-frst.txt"), "fichier listé dans Stockage");
    };
    await openStorage();
    await closeSvelteSettings();
    await inFrame(`libraryWrite({ id: "local-test", owner: libraryOwner(), name: "bilan.md", kind: "other", direction: "generated", created: Date.now(), projectId: "", code: "Bilan généré" })`);
    await click("Bibliothèque", select("#library-open"));
    await waitFor(contains("#svelte-library", "notes-frst.txt"), "fichier listé dans Bibliothèque");
    await waitFor(contains("#svelte-library", "bilan.md"), "fichier généré listé dans la même bibliothèque");
    await waitFor(`[...document.querySelectorAll("#svelte-library .library-thumbnail pre")].some(e => e.textContent.includes("contenu FRST"))`, "miniature du texte FRST");
    await pressEscape();
    await waitFor(select("#svelte-library") + " === null", "bibliothèque fermée");
    await openStorage();
    dialogPlan.push({ accept: true });
    await clickButton("#panel-storage", "Supprimer");
    await waitFor(`window.__backend.files.length === 0 && !(${contains("#panel-storage", "notes-frst.txt")})`, "fichier supprimé");
    await closeSvelteSettings();
  });

  const streamSource = fs.readFileSync(path.join(here, "..", "www", "js", "stream.js"), "utf8");
  const filesTag = /const FILE_INSTR_TAG = "([^"]+)";/.exec(streamSource)[1];
  const filesRest = JSON.parse('"' + /const FILE_INSTR = FILE_INSTR_TAG \+ "((?:[^"\\]|\\.)*)";/.exec(streamSource)[1] + '"');
  const FILES_BLOCK = filesTag + filesRest;

  await check("réglages : modifier la réflexion et les instructions les enregistre (PATCH /user/instructions)", async () => {
    await openSvelteSettings();
    await waitFor(generalReady + ` && document.getElementById("custom-instructions").value.startsWith("Réponds en français.")`, "préférences chargées", { timeout: 8000 });
    await click("Niveau de réflexion", `document.getElementById("gpt-reasoning-button")`);
    await click("Élevé", `document.querySelector('[data-reasoning="high"]')`);
    assert.equal(await ev(`document.getElementById("gpt-reasoning").value`), "high", "le niveau Élevé est retenu");
    await ev(`(() => { const t = document.getElementById("custom-instructions"); t.focus(); t.select(); return true; })()`);
    await cdp.send("Input.insertText", { text: "Réponds en anglais." });
    assert.equal(await ev(`document.getElementById("custom-instructions").value`), "Réponds en anglais.");
    await click("Enregistrer", `document.getElementById("personalization-save")`);
    await waitFor(`document.getElementById("personalization-status").textContent.trim() === "Préférences enregistrées sur ton compte."`, "message de confirmation", { timeout: 8000 });
    const bodies = await patchBodies();
    assert.ok(bodies.some(body => body.gptReasoning === "high" && body.customInstructions === "Réponds en anglais.\n\n" + FILES_BLOCK), "PATCH avec la réflexion et les instructions : " + JSON.stringify(bodies));
    const prefs = await ev(`window.__backend.prefs`);
    assert.equal(prefs.gptReasoning, "high", "le faux serveur a reçu la réflexion");
    assert.equal(prefs.customInstructions, "Réponds en anglais.\n\n" + FILES_BLOCK, "le faux serveur a reçu les instructions");
    assert.equal(prefs.webSearchMode, "open", "le mode web n'est pas modifié par cet enregistrement");
    await closeSvelteSettings();
  });

  await check("réglages : échec de chargement des préférences — message, bouton Réessayer, champs inactifs puis actifs", async () => {
    await ev(`window.__backend.fail = { "GET /user/instructions": 500 }`);
    try {
      await openSvelteSettings();
      await waitFor(`document.getElementById("personalization-status").textContent.includes("Impossible de charger les préférences")`, "message d'échec de chargement", { timeout: 8000 });
      assert.equal(await ev(`document.getElementById("personalization-retry").hidden`), false, "le bouton Réessayer est visible");
      assert.equal(await ev(`document.getElementById("personalization-fields").disabled`), true, "les champs restent inactifs après un échec");
    } finally {
      await ev(`window.__backend.fail = {}`);
    }
    await click("Réessayer", `document.getElementById("personalization-retry")`);
    await waitFor(generalReady + ` && document.getElementById("personalization-retry").hidden`, "champs actifs après réessai", { timeout: 8000 });
    assert.equal(await ev(`document.getElementById("custom-instructions").value`), "Réponds en anglais.", "les préférences enregistrées sont rechargées");
    await closeSvelteSettings();
  });

  await check("réglages : la consigne de création de fichiers est masquée dans le champ, conservée à l'enregistrement et comptée dans la limite", async () => {
    await ev(`window.__backend.prefs.customInstructions = ${JSON.stringify("Réponds en français.\n\n" + FILES_BLOCK)}`);
    await openSvelteSettings();
    await waitFor(generalReady + ` && document.getElementById("custom-instructions").value === "Réponds en français."`, "champ sans la consigne de fichiers", { timeout: 8000 });
    await ev(`(() => { const t = document.getElementById("custom-instructions"); t.focus(); t.select(); return true; })()`);
    await cdp.send("Input.insertText", { text: "Réponds en espagnol." });
    await click("Enregistrer", `document.getElementById("personalization-save")`);
    await waitFor(`document.getElementById("personalization-status").textContent.trim() === "Préférences enregistrées sur ton compte."`, "message de confirmation", { timeout: 8000 });
    assert.equal(await ev(`window.__backend.prefs.customInstructions`), "Réponds en espagnol.\n\n" + FILES_BLOCK, "le serveur reçoit le texte et la consigne de fichiers");
    const sent = (await patchBodies()).length;
    await ev(`(() => { const t = document.getElementById("custom-instructions"); t.value = "x".repeat(9990); t.dispatchEvent(new Event("input", { bubbles: true })); return t.value.length; })()`);
    await click("Enregistrer", `document.getElementById("personalization-save")`);
    await waitFor(`/consigne de création de fichiers/.test(document.getElementById("personalization-status").textContent)`, "refus local : la consigne de fichiers compte dans la limite", { timeout: 8000 });
    assert.equal((await patchBodies()).length, sent, "aucune requête pour un texte trop long");
    await ev(`window.__backend.prefs.customInstructions = "Réponds en anglais."`);
    await closeSvelteSettings();
  });

  await check("réglages : Recherche web — mode « filtré » et sites autorisés (PUT /user/web-search-domains puis PATCH webSearchMode)", async () => {
    await openSvelteSettings();
    await waitFor(`!!document.getElementById("web-settings-open") && !document.getElementById("web-settings-open").disabled`, "bouton Recherche web actif", { timeout: 8000 });
    assert.equal(await ev(`document.getElementById("web-settings-summary").textContent.trim()`), "Sans restriction", "résumé initial");
    await click("Recherche web", `document.getElementById("web-settings-open")`);
    await waitFor(`document.getElementById("web-settings-dialog").open`, "sous-dialogue Recherche web ouvert", { timeout: 8000 });
    await waitFor(`!document.getElementById("web-settings-fields").disabled`, "filtres web chargés (champs actifs)", { timeout: 8000 });
    await ev(`(() => { const s = document.getElementById("web-search-mode"); s.value = "filtered"; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
    await waitFor(`!document.getElementById("web-domain-options").hidden`, "options de filtre visibles en mode filtré");
    await ev(`(() => { const f = document.getElementById("web-filter-type"); f.value = "allowlist"; f.dispatchEvent(new Event("change", { bubbles: true })); const t = document.getElementById("web-allowed-domains"); t.value = "wikipedia.org\\nfrancestudent.org"; t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await click("Enregistrer (recherche web)", `document.getElementById("web-settings-save")`);
    await waitFor(`!document.getElementById("web-settings-dialog").open`, "sous-dialogue fermé après enregistrement", { timeout: 8000 });
    const sent = await ev(`window.__backend.calls.filter(c => (c.method === "PUT" && c.path === "/user/web-search-domains") || (c.method === "PATCH" && c.path === "/user/instructions")).map(c => c.method + " " + c.body)`);
    const put = sent.findIndex(item => item.startsWith("PUT ") && item.includes("wikipedia.org") && item.includes("francestudent.org"));
    const patch = sent.findIndex(item => item.startsWith("PATCH ") && item.includes('"webSearchMode":"filtered"'));
    assert.ok(put >= 0, "PUT des domaines attendu : " + JSON.stringify(sent));
    assert.ok(patch > put, "PATCH du mode après le PUT des domaines : " + JSON.stringify(sent));
    assert.deepEqual(await ev(`window.__backend.web.allowedDomains`), ["wikipedia.org", "francestudent.org"]);
    assert.equal(await ev(`window.__backend.prefs.webSearchMode`), "filtered");
    assert.equal(await ev(`document.getElementById("web-settings-summary").textContent.trim()`), "Sites filtrés", "résumé mis à jour");
    await closeSvelteSettings();
  });

  await check("réglages : Recherche web — enregistrement bloqué tant que les filtres ne sont pas chargés, possible après « Réessayer »", async () => {
    const writes = () => ev(`window.__backend.calls.filter(c => (c.method === "PUT" && c.path === "/user/web-search-domains") || (c.method === "PATCH" && c.path === "/user/instructions")).length`);
    const before = await writes();
    await ev(`window.__backend.fail = { "GET /user/web-search-domains": 500 }`);
    try {
      await openSvelteSettings();
      await waitFor(`!!document.getElementById("web-settings-open") && !document.getElementById("web-settings-open").disabled`, "bouton Recherche web actif", { timeout: 8000 });
      await click("Recherche web", `document.getElementById("web-settings-open")`);
      await waitFor(`document.getElementById("web-settings-dialog").open`, "sous-dialogue ouvert", { timeout: 8000 });
      await waitFor(`!document.getElementById("web-settings-retry").hidden`, "bouton Réessayer après l'échec de chargement", { timeout: 8000 });
      assert.equal(await ev(`document.getElementById("web-settings-fields").disabled`), true, "champs bloqués");
      assert.equal(await ev(`document.getElementById("web-settings-save").disabled`), true, "bouton Enregistrer bloqué");
      await click("Enregistrer (bloqué)", `document.getElementById("web-settings-save")`);
      await sleep(300);
      assert.equal(await writes(), before, "aucune écriture tant que les filtres ne sont pas chargés");
    } finally {
      await ev(`window.__backend.fail = {}`);
    }
    await click("Réessayer", `document.getElementById("web-settings-retry")`);
    await waitFor(`!document.getElementById("web-settings-fields").disabled && !document.getElementById("web-settings-save").disabled`, "champs et bouton actifs après « Réessayer »", { timeout: 8000 });
    await click("Annuler", `document.getElementById("web-settings-cancel")`);
    await waitFor(`!document.getElementById("web-settings-dialog").open`, "sous-dialogue fermé", { timeout: 8000 });
    assert.equal(await writes(), before, "annuler n'écrit rien");
    await closeSvelteSettings();
  });

  const countGets = prefix => `window.__backend.calls.filter(c => c.method === "GET" && c.path.startsWith(${JSON.stringify(prefix)})).length`;
  const sessionDeletes = () => ev(`window.__backend.calls.filter(c => c.method === "DELETE" && c.path.startsWith("/user/sessions")).map(c => c.path)`);
  const storedAvatar = `(() => { try { return String(JSON.parse(localStorage.getItem("fs-chat-state")).avatar || ""); } catch { return ""; } })()`;
  const shellUp = `!!document.querySelector("aside#sidebar") && document.querySelectorAll("#history .history-item").length >= 3`;
  const openAccountTab = async () => {
    await openSvelteSettings();
    await click("Compte", `document.getElementById("tab-account")`);
    await waitFor(`!!document.getElementById("panel-account") && !document.getElementById("panel-general")`, "panneau Compte (Svelte)", { timeout: 8000 });
  };

  await check("clé API : génération confirmée, effacement à la fermeture et révocation", async () => {
    await openAccountTab();
    await waitFor(`document.querySelectorAll("#sessions-list li").length === 2 && document.querySelectorAll("#activity-content .activity-cell").length === 343`, "compte stabilisé");
    dialogPlan.push({ accept: true });
    await clickButton("#account-api-key", "Générer une clé");
    await waitFor(contains("#account-api-key code", "fixture-key-only"), "clé générée");
    await closeSvelteSettings();
    await openAccountTab();
    await waitFor(`document.querySelectorAll("#activity-content .activity-cell").length === 343`, "compte rouvert");
    assert.equal(await ev(`document.body.textContent.includes("fixture-key-only")`), false);
    await clickButton("#account-api-key", "Consulter");
    await waitFor(contains("#account-api-key", "fixture-•••"), "clé masquée");
    dialogPlan.push({ accept: true });
    await clickButton("#account-api-key", "Révoquer");
    await waitFor(contains("#account-api-key", "révoquée"), "révocation confirmée");
    await closeSvelteSettings();
  });

  await check("compte : l'onglet Compte est natif — profil, quota, activité et sessions chargés depuis le serveur", async () => {
    await openSvelteSettings();
    const before = (await calls()).length;
    await click("Compte", `document.getElementById("tab-account")`);
    await waitFor(`!!document.getElementById("panel-account") && !document.getElementById("panel-general")`, "panneau Compte (Svelte)", { timeout: 8000 });
    assert.equal(await inFrame(`document.body.classList.contains("settings-open")`), false, "la fenêtre classique ne s'ouvre pas");
    assert.equal(await ev(`document.getElementById("tab-account").getAttribute("aria-selected")`), "true", "onglet Compte sélectionné");
    await waitFor(`document.getElementById("profile-name").textContent.trim() === "Test"`, "nom du profil (GET /user/me)", { timeout: 8000 });
    assert.equal(await ev(`document.getElementById("profile-email").textContent.trim()`), "test@example.org");
    await waitFor(`document.querySelector("#quota-box .quota-row-head strong")?.textContent.trim() === "75 %"`, "quota affiché", { timeout: 8000 });
    assert.equal(await ev(`document.querySelector("#quota-box .quota-bar span").getAttribute("class")`), "warn");
    assert.match(await ev(`document.querySelector("#quota-box .quota-note").textContent`), /25 % restant · Réinitialisation/);
    await waitFor(`!document.getElementById("activity-content").hidden && document.querySelectorAll("#activity-content .activity-cell").length === 343`, "calendrier d'activité (343 cases)", { timeout: 8000 });
    assert.equal(await ev(`document.getElementById("activity-share").disabled`), false, "Partager actif");
    assert.match(await ev(`[...document.querySelectorAll("#activity-content .activity-cell")].at(-1).getAttribute("aria-label")`), /400 tokens/);
    await waitFor(`document.querySelectorAll("#sessions-list li").length === 2`, "deux sessions listées", { timeout: 8000 });
    const seen = (await calls()).slice(before);
    for (const wanted of ["GET /user/me", "GET /user/usage", "GET /user/tokenusage?tokenUsageDays=343", "GET /user/sessions"]) assert.ok(seen.includes(wanted), wanted + " attendu : " + JSON.stringify(seen));
  });

  await check("compte : actualiser le quota et l'activité refait les requêtes ; une case du calendrier affiche son libellé", async () => {
    const quotaBefore = await ev(countGets("/user/usage"));
    const activityBefore = await ev(countGets("/user/tokenusage"));
    await ev(`(() => { window.__backend.usage.chatBudget.usedPercent = 95; window.__backend.usage.chatBudget.remainingPercent = 5; return true; })()`);
    await click("Actualiser le quota", `document.getElementById("quota-refresh")`);
    await waitFor(`document.querySelector("#quota-box .quota-row-head strong")?.textContent.trim() === "95 %"`, "quota actualisé", { timeout: 8000 });
    assert.equal(await ev(`document.querySelector("#quota-box .quota-bar span").getAttribute("class")`), "danger");
    assert.equal(await ev(countGets("/user/usage")), quotaBefore + 1, "une requête de quota");
    await click("Actualiser l'activité", `document.getElementById("activity-refresh")`);
    await waitFor(`${countGets("/user/tokenusage")} === ${activityBefore + 1}`, "requête d'activité", { timeout: 8000 });
    await waitFor(`document.querySelectorAll("#activity-content .activity-cell").length === 343`, "calendrier toujours affiché", { timeout: 8000 });
    await click("case du jour", `[...document.querySelectorAll("#activity-content .activity-cell")].at(-1)`);
    await waitFor(`/400 tokens/.test(document.getElementById("activity-status").textContent)`, "libellé de la case sélectionnée", { timeout: 8000 });
  });

  await check("compte : terminer une session — confirmation en ligne (Annuler sans requête), puis DELETE /user/sessions/{id}", async () => {
    await click("Terminer s-web", `document.querySelector('[data-session-end="s-web"]')`);
    await waitFor(`!!document.getElementById("sessions-confirm")`, "confirmation en ligne", { timeout: 8000 });
    assert.deepEqual(await sessionDeletes(), [], "aucune requête avant la confirmation");
    await click("Annuler", `document.getElementById("sessions-confirm-cancel")`);
    await waitFor(`!document.getElementById("sessions-confirm")`, "confirmation refermée", { timeout: 8000 });
    assert.deepEqual(await sessionDeletes(), [], "Annuler n'envoie rien");
    await click("Terminer s-web", `document.querySelector('[data-session-end="s-web"]')`);
    await waitFor(`!!document.getElementById("sessions-confirm")`, "confirmation en ligne (2e fois)", { timeout: 8000 });
    await click("Confirmer", `document.getElementById("sessions-confirm-yes")`);
    await waitFor(`document.querySelectorAll("#sessions-list li").length === 1`, "une seule session restante", { timeout: 8000 });
    assert.deepEqual(await sessionDeletes(), ["/user/sessions/s-web"]);
    assert.deepEqual(await ev(`window.__backend.sessions.map(s => s.id)`), ["s-iphone"]);
    assert.equal(await ev(`!!document.getElementById("panel-account")`), true, "l'utilisateur reste dans les Paramètres");
  });

  await check("compte : changer puis retirer la photo de profil (fichier réel, redimensionné, écrit dans l'état local)", async () => {
    const picture = path.join(temp, "avatar.png");
    fs.writeFileSync(picture, makePng(32));
    assert.equal(await ev(`document.getElementById("avatar-remove").hidden`), true, "pas de photo personnalisée au départ");
    await attachFiles([picture], "#avatar-input");
    await waitFor(`document.getElementById("profile-avatar").src.startsWith("data:image/")`, "aperçu de la nouvelle photo", { timeout: 10000 });
    await waitFor(`${storedAvatar}.startsWith("data:image/")`, "photo écrite dans fs-chat-state", { timeout: 8000 });
    assert.equal(await ev(`document.getElementById("avatar-remove").hidden`), false, "bouton Retirer visible");
    await click("Retirer", `document.getElementById("avatar-remove")`);
    await waitFor(`document.getElementById("avatar-remove").hidden === true && ${storedAvatar} === ""`, "photo retirée", { timeout: 8000 });
    assert.equal(await ev(`document.getElementById("profile-avatar").src.startsWith("data:image/")`), false, "retour à l'image par défaut");
  });

  await check("compte : « Terminer toutes les sessions » demande confirmation, envoie DELETE /user/sessions puis ramène à l'écran de connexion", async () => {
    await click("Tout terminer", `document.getElementById("sessions-end-all")`);
    await waitFor(`!!document.getElementById("sessions-confirm")`, "confirmation en ligne", { timeout: 8000 });
    assert.match(await ev(`document.getElementById("sessions-confirm-text").textContent`), /toutes les sessions/);
    assert.ok(!(await sessionDeletes()).includes("/user/sessions"), "aucune requête avant la confirmation");
    await click("Confirmer", `document.getElementById("sessions-confirm-yes")`);
    await waitFor(`!!document.getElementById("login-screen")`, "écran de connexion après la fin de toutes les sessions", { timeout: 10000 });
    assert.ok((await sessionDeletes()).includes("/user/sessions"), "DELETE /user/sessions envoyé");
    assert.ok((await ev(`window.__backend.invokes`)).includes("session_delete"), "la session sécurisée de l'appareil est supprimée");
    assert.equal(await ev(`!document.getElementById("settings-modal")`), true, "le dialogue Paramètres est fermé");
  });

  await check("compte : « Se déconnecter » supprime la session sécurisée, vide le profil local et affiche l'écran de connexion", async () => {
    await cdp.send("Page.navigate", { url: baseUrl + "/" });
    await waitFor(shellUp, "coque Svelte après rechargement", { timeout: 40000 });
    await openAccountTab();
    await waitFor(`document.getElementById("profile-name").textContent.trim() === "Test"`, "profil chargé", { timeout: 8000 });
    await waitFor(`document.querySelectorAll("#activity-content .activity-cell").length === 343 && document.querySelectorAll("#sessions-list li").length === 2`, "chargement complet du compte", { timeout: 8000 });
    await click("Se déconnecter", `document.getElementById("logout")`);
    await waitFor(`!!document.getElementById("login-screen")`, "écran de connexion après la déconnexion", { timeout: 10000 });
    assert.ok((await ev(`window.__backend.invokes`)).includes("session_delete"), "session_delete invoqué");
    assert.equal(await ev(`(() => { try { const s = JSON.parse(localStorage.getItem("fs-chat-state")); return s.profile === null && !s.session; } catch { return false; } })()`), true, "profil et session locaux vidés");
    await cdp.send("Page.navigate", { url: baseUrl + "/" });
    await waitFor(shellUp, "coque Svelte après reconnexion simulée", { timeout: 40000 });
  });

  await check("réglages : le thème choisi dans le dialogue Svelte s'applique et s'écrit dans l'état local (pont du moteur historique)", async () => {
    await openSvelteSettings();
    const initial = await ev(`(document.querySelector("[data-theme-choice][aria-checked='true']") || {}).dataset?.themeChoice || null`);
    assert.ok(initial, "un thème est coché à l'ouverture");
    const other = initial === "dark" ? "light" : "dark";
    await click("Thème " + other, `document.querySelector('[data-theme-choice="${other}"]')`);
    await waitFor(`document.documentElement.getAttribute("data-theme") === "${other}"`, "thème appliqué au document", { timeout: 8000 });
    await waitFor(`(() => { try { return JSON.parse(localStorage.getItem("fs-chat-state")).theme === "${other}"; } catch { return false; } })()`, "thème écrit dans fs-chat-state", { timeout: 8000 });
    await click("Thème " + initial, `document.querySelector('[data-theme-choice="${initial}"]')`);
    await waitFor(`(() => { try { return JSON.parse(localStorage.getItem("fs-chat-state")).theme === "${initial}"; } catch { return false; } })()`, "thème d'origine rétabli", { timeout: 8000 });
    await closeSvelteSettings();
  });

  await check("réglages : choisir l'interface classique depuis le dialogue Svelte recharge en interface classique seule", async () => {
    await openSvelteSettings();
    await click("Interface classique", `document.querySelector('[data-ui-choice="legacy"]')`);
    await waitFor(`!document.querySelector("aside#sidebar") && !!document.querySelector("iframe")`, "interface classique seule après le choix", { timeout: 40000 });
    assert.equal(await ev(`JSON.stringify([localStorage.getItem("fs-ui"), localStorage.getItem("fs-chat"), location.search])`), JSON.stringify(["legacy", null, ""]), "fs-ui = legacy, fs-chat retiré, adresse sans ?ui");
    await ev(`(localStorage.removeItem("fs-ui"), localStorage.removeItem("fs-chat"), true)`);
  });

  await check("chat : par défaut (sans paramètre) Svelte 5 et son chat ; ?ui=svelte&chat=legacy garde le chat historique ; ?ui=legacy ne monte pas la coque", async () => {
    await cdp.send("Page.navigate", { url: baseUrl + "/" });
    await waitFor(`!!document.querySelector("aside#sidebar") && !!document.querySelector(".chat-pane") && document.querySelectorAll("#history .history-item").length >= 3`, "coque et chat Svelte par défaut", { timeout: 40000 });
    for (const query of ["?ui=svelte&chat=legacy", "?chat=legacy"]) {
      await cdp.send("Page.navigate", { url: baseUrl + "/" + query });
      await waitFor(`!!document.querySelector("aside#sidebar") && document.querySelectorAll("#history .history-item").length >= 3`, "coque Svelte " + query, { timeout: 40000 });
      assert.equal(await ev(`!!document.querySelector(".chat-pane")`), false, "aucune surcouche pour " + query);
      assert.equal(await ev(`document.querySelector("main.main iframe").inert`), false, "iframe interactive pour " + query);
    }
    await cdp.send("Page.navigate", { url: baseUrl + "/?ui=legacy" });
    await waitFor(`!document.querySelector("aside#sidebar") && !!document.querySelector("iframe")`, "interface classique seule (?ui=legacy)", { timeout: 40000 });
    assert.equal(await ev(`!!document.querySelector(".chat-pane")`), false, "aucune surcouche en interface classique");
  });

  await check("réglages : choix de l'interface dans Paramètres > Général — Svelte → classique → Svelte → nouveau chat → retour classique", async () => {
    const pollUntil = async (expression, label, timeout = 40000) => {
      const end = Date.now() + timeout;
      let last = null;
      while (Date.now() < end) {
        try { if (await ev(expression)) return; } catch (error) { last = error; }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error("Délai dépassé : " + label + (last ? " (" + last.message + ")" : ""));
    };
    const shellReady = `!!document.querySelector("aside#sidebar") && document.querySelectorAll("#history .history-item").length >= 3`;
    const legacyOnly = `!document.querySelector("aside#sidebar") && !!document.querySelector("iframe")`;
    const sectionReady = `(() => { try { const w = document.querySelector("iframe")?.contentWindow; return !!w && !!w.document.querySelector("[data-ui-choice]"); } catch { return false; } })()`;
    const openGeneral = async () => {
      await pollUntil(sectionReady, "section Interface présente dans les Paramètres");
      await inFrame(`openSettings(); document.getElementById("tab-general").click();`);
    };
    const pressed = () => inFrame(`[...document.querySelectorAll("[data-ui-choice]")].filter(b => b.getAttribute("aria-checked") === "true").map(b => b.dataset.uiChoice).join(",")`);
    const choose = selector => inFrame(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const stored = () => ev(`JSON.stringify([localStorage.getItem("fs-ui"), localStorage.getItem("fs-chat"), location.search])`);

    await cdp.send("Page.navigate", { url: baseUrl + "/" });
    await pollUntil(shellReady + ` && !!${PANE}`, "coque et chat Svelte par défaut (aucun paramètre)");
    await openGeneral();
    assert.equal(await pressed(), "svelte", "par défaut, « Interface Svelte 5 (bêta) » est cochée");
    assert.equal(await inFrame(`document.querySelector("[data-ui-chat]").hidden`), false, "l'option du nouveau chat est proposée avec Svelte");
    assert.equal(await inFrame(`document.querySelector("[data-ui-chat]").getAttribute("aria-checked")`), "true", "le nouveau chat est actif par défaut");

    await choose(`[data-ui-choice="legacy"]`);
    await pollUntil(legacyOnly, "retour à l'interface classique (plus de coque Svelte)");
    assert.equal(await stored(), JSON.stringify(["legacy", null, ""]), "fs-ui = legacy, fs-chat retiré, adresse sans ?ui");
    await openGeneral();
    assert.equal(await pressed(), "legacy", "« Interface classique » est cochée");
    assert.equal(await inFrame(`document.querySelector("[data-ui-chat]").hidden`), true, "pas d'option de chat en interface classique");

    await cdp.send("Page.navigate", { url: baseUrl + "/" });
    await pollUntil(legacyOnly, "le choix classique survit à un rechargement");
    await openGeneral();

    await choose(`[data-ui-choice="svelte"]`);
    await pollUntil(shellReady + ` && !!${PANE}`, "coque et nouveau chat après choix de Svelte");
    assert.equal(await stored(), JSON.stringify(["svelte", "svelte", ""]));
    await openGeneral();
    assert.equal(await pressed(), "svelte");

    await choose(`[data-ui-chat]`);
    await pollUntil(shellReady + ` && !${PANE}`, "chat historique dans la coque Svelte après désactivation du nouveau chat");
    assert.equal(await stored(), JSON.stringify(["svelte", "legacy", ""]));
    await openGeneral();
    assert.equal(await inFrame(`document.querySelector("[data-ui-chat]").getAttribute("aria-checked")`), "false");

    await choose(`[data-ui-chat]`);
    await pollUntil(`!!${PANE}`, "nouveau chat Svelte de nouveau monté");
    assert.equal(await stored(), JSON.stringify(["svelte", "svelte", ""]));

    await openGeneral();
    await choose(`[data-ui-choice="legacy"]`);
    await pollUntil(legacyOnly, "retour classique depuis le nouveau chat");
    assert.equal(await stored(), JSON.stringify(["legacy", null, ""]), "fs-ui = legacy, fs-chat retiré");
    assert.equal(await ev(`!!document.querySelector(".chat-pane")`), false);
    await ev(`(localStorage.removeItem("fs-ui"), localStorage.removeItem("fs-chat"), true)`);
  });

  await check("préférences : thème, colonnes de la bibliothèque, agent par défaut et modèle d'image survivent aux bascules Svelte ⇄ classique", async () => {
    const marker = { theme: "dark", libraryColumns: 4, defaultAgentId: 2, imageModel: "gpt-image-2" };
    const saved = () => ev(`(() => { try { const s = JSON.parse(localStorage.getItem("fs-chat-state")); return JSON.stringify({ theme: s.theme, libraryColumns: s.libraryColumns, defaultAgentId: s.defaultAgentId, imageModel: s.imageModel }); } catch { return "illisible"; } })()`);
    const legacyOnly = `!document.querySelector("aside#sidebar") && !!document.querySelector("iframe")`;
    await cdp.send("Page.navigate", { url: baseUrl + "/" });
    await waitFor(shellUp + ` && !!${PANE}`, "coque et chat Svelte par défaut", { timeout: 40000 });
    await inFrame(`(store.theme = "dark", store.libraryColumns = 4, store.defaultAgentId = 2, store.imageModel = "gpt-image-2", saveStore(), true)`);
    assert.equal(await saved(), JSON.stringify(marker), "préférences écrites avant la bascule");

    await openSvelteSettings();
    await click("Interface classique", `document.querySelector('[data-ui-choice="legacy"]')`);
    await waitFor(legacyOnly, "interface classique seule", { timeout: 40000 });
    assert.equal(await saved(), JSON.stringify(marker), "préférences conservées après Svelte → classique");

    await waitFor(`(() => { try { const w = document.querySelector("iframe")?.contentWindow; return !!w && !!w.document.querySelector("[data-ui-choice]"); } catch { return false; } })()`, "section Interface des Paramètres classiques", { timeout: 40000 });
    await inFrame(`openSettings(); document.getElementById("tab-general").click(); document.querySelector('[data-ui-choice="svelte"]').click();`);
    await waitFor(shellUp + ` && !!${PANE}`, "coque et chat Svelte après retour", { timeout: 40000 });
    assert.equal(await saved(), JSON.stringify(marker), "préférences conservées après classique → Svelte");

    await openSvelteSettings();
    assert.equal(await ev(`document.querySelector("[data-theme-choice][aria-checked='true']")?.dataset.themeChoice`), "dark", "le thème sombre est coché dans le dialogue Svelte");
    assert.equal(await ev(`document.documentElement.getAttribute("data-theme")`), "dark", "thème appliqué au document");
    await closeSvelteSettings();
    await ev(`(localStorage.removeItem("fs-ui"), localStorage.removeItem("fs-chat"), true)`);
    await inFrame(`(store.theme = "system", store.libraryColumns = 3, store.defaultAgentId = null, store.imageModel = "gpt-image-2.5-flare", saveStore(), true)`);
  });

  await check("projets : édition, partage, ouverture et rattachement d’une discussion depuis la coque Svelte", async () => {
    await click("Projets", select("#projects-open"));
    await waitFor(contains("#svelte-projects", "Projet de test"), "liste des projets");
    await click("Modifier le projet", select('#svelte-projects button[aria-label="Modifier Projet de test"]'));
    await waitFor(select("#svelte-projects textarea") + " !== null", "éditeur affiché");
    await setField("#svelte-projects textarea", "Instructions migrées.");
    await clickButton("#svelte-projects", "Gérer les accès");
    await waitFor(select('#svelte-projects input[type="email"]') + " && !" + buttonWith("#svelte-projects", "Partager") + ".disabled", "partage prêt");
    await setField('#svelte-projects input[type="email"]', "test@example.org");
    await clickButton("#svelte-projects", "Partager");
    await waitFor(contains("#svelte-projects", "test@example.org"), "accès partagé");
    await clickButton("#svelte-projects", "Enregistrer");
    await waitFor(`window.__backend.projects[0].customInstructions === "Instructions migrées." && ${buttonWith("#svelte-projects", "Projet de test")}`, "instructions enregistrées");
    await clickButton("#svelte-projects", "Projet de test");
    await waitFor(`!document.getElementById("svelte-projects") && document.getElementById("project-context-name").textContent === "Projet de test"`, "contexte projet activé");
    await click("Quitter le projet", select("#project-leave"));
    await waitFor(select("#project-context") + ".hidden", "retour hors projet");
    await openMenuFor("Maths");
    await click("Déplacer vers un projet", select("#conv-project"));
    await waitFor(select("#svelte-projects select option:nth-child(2)") + " !== null", "destination chargée");
    await ev(`(() => { const field = document.querySelector("#svelte-projects select"); field.selectedIndex = 1; field.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await clickButton("#svelte-projects", "Déplacer");
    await waitFor(`!document.getElementById("svelte-projects") && !!window.__backend.chats.find(row => row.title === "Maths")?.projectId`, "discussion rattachée");
  });

  await check("chat : aucune exception JavaScript non gérée pendant toute la phase chat", async () => {
    assert.deepEqual(pageErrors, [], "exceptions : " + JSON.stringify(pageErrors));
  });
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  if (cdp) {
    try {
      console.error("Dernières requêtes du faux serveur :", JSON.stringify(await lastCalls()));
      console.error("Titres de la barre Svelte :", JSON.stringify(await historyTitles()));
    } catch {}
  }
  console.error("\nRÉSULTAT : ÉCHEC après " + results.length + " vérification(s) réussie(s).");
} finally {
  await cleanup();
}
if (failed) process.exit(1);
console.log("\nRÉSULTAT : " + results.length + " vérifications réussies dans " + path.basename(browser) + " (headless). Ne vaut pas test iOS/Android.");
