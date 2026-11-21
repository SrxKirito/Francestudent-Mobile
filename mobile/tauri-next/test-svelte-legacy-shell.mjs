import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createServer } from "vite";
import { connectLegacyEngine } from "./src/lib/services/legacy-engine.ts";

const read = relative => readFileSync(new URL(relative, import.meta.url), "utf8");
const bridge = read("./svelte-engine.js");
const prepared = read("./public/legacy/index.html");
const position = name => {
  const tag = `<script src="${name}"></script>`;
  const index = prepared.indexOf(tag);
  assert.ok(index >= 0, `Script manquant : ${name}`);
  assert.equal(prepared.indexOf(tag, index + 1), -1);
  return index;
};
assert.ok(position("js/core.js") < position("js/conversations.js"));
assert.ok(position("js/conversations.js") < position("app.js"));
assert.ok(position("app.js") < position("js/tauri-svelte-engine.js"));
assert.ok(position("js/tauri-svelte-engine.js") < position("js/tauri-svelte-chat-engine.js"));

function fakeFrame(source = bridge) {
  const nodes = new Map();
  const classes = () => {
    const names = new Set();
    return {
      contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name),
      toggle: name => names.has(name) ? names.delete(name) : names.add(name)
    };
  };
  const node = () => ({ classList: classes() });
  nodes.set("app", node());
  nodes.set("project-status", { textContent: "Synchronisé" });
  const callbacks = new Set();
  const context = vm.createContext({
    console, queueMicrotask,
    document: {
      getElementById: id => nodes.get(id),
      querySelector: () => null,
      addEventListener: (_, listener) => callbacks.add(listener),
      removeEventListener: (_, listener) => callbacks.delete(listener),
      createElement: () => ({ remove() { nodes.delete(this.id); } }),
      head: { appendChild: child => nodes.set(child.id, child) },
      body: node(), documentElement: node()
    },
    MutationObserver: class { observe() {} disconnect() {} },
    store: {
      profile: { name: "Compte" }, theme: "dark",
      conversations: [
        { id: 7, projectId: 0, title: "Maths", agentId: 2, messages: [{ content: "Théorème" }] },
        { id: "general", title: "Accueil", messages: [] }
      ]
    },
    currentId: 7,
    currentProject: { id: 0, name: "Cours" },
    agents: [{ id: 2, name: "Sonnet", provider: "Anthropic", available: true }],
    conversationMatches: (row, query) => [row.title, ...row.messages.map(message => message.content)].join(" ").toLowerCase().includes(query),
    renderHistory() {},
    openConversation(id) { context.currentId = id; },
    togglePin(id) { context.store.conversations.find(row => row.id === id).pinned = true; }
  });
  context.window = context;
  const original = context.renderHistory;
  vm.runInContext(source, context);
  const engine = connectLegacyEngine(context);
  assert.ok(engine);
  assert.equal(context.renderHistory, original, "le script reste inerte avant attach");
  return { engine, context, nodes, callbacks, original };
}

function verifySnapshot(engine) {
  const snapshot = engine.snapshot();
  assert.equal(snapshot.projectId, "0");
  assert.equal(snapshot.currentId, "7");
  assert.equal(snapshot.conversations[0].projectId, "0");
  assert.equal(snapshot.conversations[0].messages, undefined);
  assert.deepEqual([...engine.matches(" THÉORÈME ")], ["7"]);
}
verifySnapshot(fakeFrame().engine);
const mutated = bridge.replace("projectId: project ? project.id : null", "projectId: null");
assert.notEqual(mutated, bridge);
assert.throws(() => verifySnapshot(fakeFrame(mutated).engine), { code: "ERR_ASSERTION" });

const server = await createServer({ appType: "custom", logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { ShellStore } = await server.ssrLoadModule("/src/lib/stores/shell.svelte.ts");
  const { render } = await server.ssrLoadModule("svelte/server");
  const { default: AppLayout } = await server.ssrLoadModule("/src/components/AppLayout.svelte");
  const { engine, context, nodes, callbacks, original } = fakeFrame();
  const themes = [];
  const store = new ShellStore({ width: 768, onTheme: theme => themes.push(theme) });
  store.connect(engine);
  assert.ok(nodes.has("fs-engine-style"));
  assert.equal(callbacks.size, 1);
  assert.equal(store.ready, true);
  assert.equal(store.wide, false);
  store.resize(769);
  assert.equal(store.wide, true);
  assert.deepEqual(themes, ["dark"]);
  assert.equal(store.conversations.currentId, "7");
  assert.equal(store.conversations.projectId, "0");
  store.conversations.query = "théorème";
  assert.deepEqual(store.conversations.visible.map(row => row.id), ["7"]);
  store.open("7");
  store.toggleMenu("7", { left: 0, right: 8, top: 0, bottom: 8 });
  store.menuAction("togglePin");
  await Promise.resolve();
  assert.equal(context.currentId, 7, "les actions conservent l’identifiant historique");
  assert.equal(context.store.conversations[0].pinned, true);
  context.store.conversations[0].messages = [{ content: "géométrie" }];
  context.renderHistory();
  await Promise.resolve();
  assert.deepEqual(store.conversations.visible, []);
  store.conversations.query = "";
  const hybrid = render(AppLayout, { props: { store, legacyChat: true } }).body;
  assert.match(hybrid, /<iframe[^>]+\/legacy\/index\.html/);
  assert.match(hybrid, /Cours/);
  assert.doesNotMatch(render(AppLayout, { props: { store } }).body, /<iframe/);
  context.currentProject = null;
  context.currentId = "general";
  context.renderHistory();
  await Promise.resolve();
  assert.equal(store.conversations.currentId, "general");
  assert.deepEqual(store.conversations.visible.map(row => row.id), ["general"]);
  store.disconnect();
  assert.equal(store.ready, false);
  assert.equal(callbacks.size, 0);
  assert.equal(nodes.has("fs-engine-style"), false);
  assert.equal(context.renderHistory, original);
} finally {
  await server.close();
}
console.log("Commit B : injection, pont VM, identifiants, synchronisation, SSR et mutation de contrôle vérifiés.");
