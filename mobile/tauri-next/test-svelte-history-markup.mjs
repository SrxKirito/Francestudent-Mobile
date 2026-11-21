// Compare le balisage de l'historique rendu par Svelte (rendu serveur via Vite) à celui produit par le vrai `renderHistory`
// de l'ancienne interface, exécuté dans un contexte vm. Teste aussi le store des discussions (lecture seule).
// Ce test vérifie la structure (balises, classes, attributs, textes) : il ne dit RIEN du rendu visuel sur appareil.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { tokens } from "./test-markup-tokens.mjs";
import { DAY, NOW, createLegacyHistory } from "./test-legacy-history-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

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

const agents = [
  { id: 1, name: "GPT-5 (rapide)", model: "gpt-5", provider: "OpenAI", description: "", available: true, isDefault: true },
  { id: 2, name: "Claude Sonnet", model: "", provider: "Anthropic", description: "", available: true, isDefault: false },
  { id: 3, name: "Modèle maison", model: "", provider: "", description: "", available: false, isDefault: false }
];
const legacy = createLegacyHistory(agents);

const startOfToday = new Date(NOW).setHours(0, 0, 0, 0);
const dataset = [
  { id: "a", title: "Maths : dérivées", updatedAt: NOW, agentId: 1, messages: [] },
  { id: "b", title: "Épinglée", updatedAt: NOW - 40 * DAY, pinned: true, agentId: 2, messages: [] },
  { id: "c", title: "Hier soir", updatedAt: startOfToday - 1, agentId: 3, messages: [] },
  { id: "d", title: "Rock & <roll> \"live\" 'x'", updatedAt: NOW - 3 * DAY, agentId: 99, agentName: "Mistral Large", agentProvider: "mistral", messages: [] },
  { id: "e", updatedAt: NOW - 20 * DAY, agentId: 99, messages: [{ role: "user", content: "contenu sans titre" }] },
  { id: "f", title: "Projet", projectId: "p1", updatedAt: NOW - DAY / 2, agentId: 1, messages: [] },
  { id: "g", title: "Ancienne", updatedAt: NOW - 90 * DAY, agentProvider: "grok", messages: [] }
];

const server = await createServer({
  root: here,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null }
});

try {
  const { render } = await server.ssrLoadModule("svelte/server");
  const HistoryList = (await server.ssrLoadModule("/src/components/HistoryList.svelte")).default;
  const { PROVIDER_LOGOS } = await server.ssrLoadModule("/src/lib/data/provider-logos.ts");
  const { agentLabel, conversationAgent, providerMark } = await server.ssrLoadModule("/src/lib/utils/agents.ts");
  const { GROUP_PINNED, NO_RESULT, groupHistory, visibleConversations } = await server.ssrLoadModule("/src/lib/utils/history.ts");
  const { ConversationsStore } = await server.ssrLoadModule("/src/lib/stores/conversations.svelte.ts");

  const markFor = conversation => {
    const agent = conversationAgent(conversation, agents);
    return { html: providerMark(agent, PROVIDER_LOGOS), label: agentLabel(agent) };
  };

  function modern(conversations, { projectId = null, query = "", currentId = null, menuId = null } = {}) {
    const groups = groupHistory(visibleConversations(conversations.map(c => ({ ...c })), { projectId, query }), NOW);
    const props = { groups, searching: query.trim() !== "", currentId, menuId, markFor, onopen() {}, onmenu() {} };
    return render(HistoryList, { props }).body;
  }

  const cases = [
    ["liste simple", {}],
    ["discussion active", { currentId: "a" }],
    ["menu ouvert", { menuId: "b" }],
    ["active et menu ouvert sur la même ligne", { currentId: "d", menuId: "d" }],
    ["dans un projet", { projectId: "p1" }],
    ["recherche avec résultat", { query: "  MATHS " }],
    ["recherche dans le contenu des messages", { query: "contenu sans" }],
    ["recherche sans résultat", { query: "introuvable-zzz" }],
    ["caractères spéciaux dans le titre", { query: "rock" }]
  ];
  for (const [name, options] of cases) {
    await test(`même balisage que l'ancien renderHistory — ${name}`, () => {
      // Le pictogramme Svelte remplace les lettres et le point d’interrogation du legacy.
      const fallback = providerMark({ name: "", provider: "" }, PROVIDER_LOGOS);
      const expected = tokens(legacy.render(dataset, options).html.replace(/<span class="model-logo-letter">[^<]*<\/span>/g, fallback));
      const actual = tokens(modern(dataset, options));
      assert.deepEqual(actual, expected);
      if (name === "liste simple") assert.ok(expected.length > 20, "le cas ne doit pas être vide par accident");
    });
  }

  await test("liste vide sans recherche : conteneur vide comme avant", () => {
    const expected = tokens(legacy.render([], {}).html);
    assert.deepEqual(tokens(modern([], {})), expected);
    assert.deepEqual(expected.length, 2, "seulement <nav> et </nav>");
  });

  await test("message « Aucune conversation trouvée. » seulement avec une recherche", () => {
    assert.match(modern(dataset, { query: "introuvable-zzz" }), new RegExp(`<div class="history-empty">${NO_RESULT}</div>`));
    assert.doesNotMatch(modern([], {}), /history-empty/);
  });

  await test("le titre est échappé (pas d'injection HTML par un titre de discussion)", () => {
    const body = modern(dataset, { query: "rock" });
    assert.doesNotMatch(body, /<roll>/);
    // Svelte échappe `&` et `<` (suffisant pour le texte) ; `>` seul reste littéral, ce qui est du HTML valide.
    assert.match(body, /Rock &amp; &lt;roll>/);
  });

  await test("accessibilité : attributs rendus (role, tabindex, aria) — le comportement clic/clavier n'est PAS testé ici", () => {
    const body = modern(dataset, {});
    assert.match(body, /class="history-item[^"]*" role="button" tabindex="0"/);
    assert.match(body, /aria-haspopup="menu"/);
  });

  await test("ConversationsStore : chargement, filtre par projet et par recherche, groupes", async () => {
    const calls = [];
    const storage = {
      async load() {
        calls.push("load");
        return { conversations: dataset.map(c => ({ ...c })), persistent: true };
      },
      async save() {
        calls.push("save");
      },
      async flush() {
        calls.push("flush");
      },
      close() {
        calls.push("close");
      }
    };
    const store = new ConversationsStore(storage);
    assert.equal(store.loaded, false);
    assert.deepEqual(store.visible, []);
    await store.load();
    assert.equal(store.loaded, true);
    assert.equal(store.persistent, true);
    assert.deepEqual(calls, ["load"], "lecture seule : le store n'écrit jamais");
    assert.deepEqual(store.visible.map(c => c.id).sort(), ["a", "b", "c", "d", "e", "g"]);
    store.projectId = "p1";
    assert.deepEqual(store.visible.map(c => c.id), ["f"]);
    store.projectId = null;
    store.query = "mistral-introuvable";
    assert.deepEqual(store.visible, []);
    store.query = "MATHS";
    assert.deepEqual(store.visible.map(c => c.id), ["a"]);
    store.query = "";
    const labels = store.groups(NOW).map(group => group.label);
    assert.equal(labels[0], GROUP_PINNED);
    assert.deepEqual(calls, ["load"]);
  });

  await test("ConversationsStore : stockage indisponible → liste vide, persistent faux", async () => {
    const store = new ConversationsStore({
      async load() {
        return { conversations: [], persistent: false };
      },
      async save() {},
      async flush() {},
      close() {}
    });
    await store.load();
    assert.equal(store.loaded, true);
    assert.equal(store.persistent, false);
    assert.deepEqual(store.visible, []);
  });
} finally {
  await server.close();
}

console.log(`test-svelte-history-markup : ${count} tests réussis`);
