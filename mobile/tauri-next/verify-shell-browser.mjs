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
  const U = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const ago = hours => new Date(Date.now() - hours * 3600e3).toISOString();
  const chat = (n, title, hours, extra) => Object.assign({ id: U(n), title, projectId: null, isPinned: false, lastMessageAt: ago(hours), createdAt: ago(hours), agent: { id: 1 } }, extra || {});
  const backend = window.__backend = {
    session: "session-de-test", calls: [], invokes: [], fail: {}, cancelled: [], released: false, streamPlan: null, uploads: new Map(), uploadHold: false, uploadFail: 0,
    chats: [chat(1, "Maths", 1), chat(2, "Histoire", 2), chat(5, "Physique", 3)],
    archived: [chat(3, "Vieille discussion", 90)],
    remote: [chat(4, "Géographie du serveur", 200)]
  };
  function route(method, path, body) {
    const url = new URL(path, "http://x");
    const p = url.pathname;
    backend.calls.push({ method, path: p + url.search, body: body || null });
    for (const [prefix, status] of Object.entries(backend.fail)) if ((method + " " + p).startsWith(prefix)) return [status, { error: "panne simulée" }];
    if (method === "GET" && p === "/chats") return [200, { chats: backend.chats }];
    if (method === "GET" && p === "/chats/archived") return [200, { chats: backend.archived, hasMore: false }];
    if (method === "GET" && p === "/chats/search") {
      const q = (url.searchParams.get("query") || "").toLowerCase();
      return [200, { chats: backend.remote.filter(c => c.title.toLowerCase().includes(q)), hasMore: false }];
    }
    if (method === "GET" && p === "/user/me") return [200, { name: "Test", email: "test@example.org" }];
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
        case "session_read": return backend.session;
        case "session_write": backend.session = args.value; return null;
        case "session_delete": backend.session = null; return null;
        case "legacy_cancel": backend.cancelled.push(args.id); return null;
        case "legacy_exchange": return { accessToken: "jeton-de-test", expiresIn: 3600 };
        case "speech_supported": return false;
        case "upload_begin": {
          // Comme Rust : annonce « ready », puis attend upload_finish avant de répondre {id}.
          const channel = callbacks.get(args.onEvent.id);
          const entry = { chunks: 0, bytes: 0, name: args.name, done: false, cancelled: false };
          backend.uploads.set(args.id, entry);
          if (backend.uploadFail > 0) { backend.uploadFail -= 1; throw new Error("HTTP 500"); }
          setTimeout(() => channel?.({ index: 0, message: { kind: "ready" } }), 5);
          while ((!entry.done || backend.uploadHold) && !entry.cancelled) await new Promise(resolve => setTimeout(resolve, 10));
          if (entry.cancelled) throw new Error("Transfert annulé.");
          return { id: "fichier-" + args.id.slice(0, 8) };
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
  // FS_CHAT_ONLY=1 : n'exécute que la phase chat (itération rapide) ; la vérification complète les enchaîne toutes.
  if (process.env.FS_CHAT_ONLY) {
    await chatPhase(baseUrl, pageErrors);
    return;
  }
  await cdp.send("Page.navigate", { url: baseUrl + "/?ui=svelte" });

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

async function chatPhase(baseUrl, pageErrors) {
  const consoleErrors = [];
  cdp.on("Runtime.consoleAPICalled", p => { if (p.type === "error" || p.type === "warning") consoleErrors.push(p.type + ": " + p.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300)); });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: baseUrl + "/?ui=svelte&chat=svelte" });
  await waitFor(`!!${PANE} && document.querySelectorAll("#history .history-item").length >= 3`, "chat Svelte monté", { timeout: 40000 });

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

  const attachFiles = async files => {
    await cdp.send("DOM.enable");
    const root = await cdp.send("DOM.getDocument", { depth: 1 });
    const input = await cdp.send("DOM.querySelector", { nodeId: root.root.nodeId, selector: "#file-input" });
    assert.ok(input.nodeId, "champ #file-input introuvable dans la page parente");
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

  await check("chat : l'ouverture des Paramètres (iframe) masque la surcouche et rend l'iframe interactive ; la fermeture la ramène", async () => {
    await waitFor(`!${PANE}.classList.contains("chat-pane-hidden")`, "surcouche visible avant");
    await click("Paramètres", `document.getElementById("user-button")`);
    await waitFor(`${PANE}.classList.contains("chat-pane-hidden")`, "surcouche masquée pendant les réglages", { timeout: 8000 });
    assert.equal(await ev(`document.querySelector("main.main iframe").inert`), false, "l'iframe doit être interactive pour les réglages");
    await inFrame(`closeSettings()`);
    await waitFor(`!${PANE}.classList.contains("chat-pane-hidden")`, "surcouche de retour après fermeture", { timeout: 8000 });
    assert.equal(await ev(`document.querySelector("main.main iframe").inert`), true, "iframe de nouveau inerte");
  });

  await check("chat : sans sous-drapeau (?ui=svelte seul, ou chat=legacy), aucune surcouche — le chat legacy reste le défaut", async () => {
    for (const query of ["?ui=svelte", "?ui=svelte&chat=legacy"]) {
      await cdp.send("Page.navigate", { url: baseUrl + "/" + query });
      await waitFor(`!!document.querySelector("aside#sidebar") && document.querySelectorAll("#history .history-item").length >= 3`, "coque Svelte " + query, { timeout: 40000 });
      assert.equal(await ev(`!!document.querySelector(".chat-pane")`), false, "aucune surcouche pour " + query);
      assert.equal(await ev(`document.querySelector("main.main iframe").inert`), false, "iframe interactive pour " + query);
    }
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
