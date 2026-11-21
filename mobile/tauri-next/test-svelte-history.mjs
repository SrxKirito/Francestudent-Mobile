// Tests de l'historique (filtre, recherche, tri, groupes) et des libellés de modèles : comparaison directe avec le code
// de l'ancienne interface (`renderHistory`, `providerLabel`, `agentLabel`, `providerMark`, `icon`), exécuté dans un contexte vm,
// sur une grille de cas limites (frontières de dates, épinglage, projets, modèles inconnus).
import assert from "node:assert/strict";
import { PROVIDER_LOGOS } from "./src/lib/data/provider-logos.ts";
import {
  GROUP_MONTH,
  GROUP_OLDER,
  GROUP_PINNED,
  GROUP_TODAY,
  GROUP_WEEK,
  GROUP_YESTERDAY,
  NO_RESULT,
  conversationTitle,
  groupHistory,
  historyGroup,
  visibleConversations
} from "./src/lib/utils/history.ts";
import { agentLabel, conversationAgent, providerLabel, providerMark } from "./src/lib/utils/agents.ts";
import { ICON_PATHS, icon } from "./src/lib/utils/icons.ts";
import { DAY, NOW, createLegacyHistory } from "./test-legacy-history-harness.mjs";

let count = 0;
function test(name, fn) {
  try {
    fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
}

const startOfToday = new Date(NOW).setHours(0, 0, 0, 0);
const startOfYesterday = startOfToday - DAY;

const agents = [
  { id: 1, name: "GPT-5 (rapide)", model: "gpt-5", provider: "OpenAI", description: "", available: true, isDefault: true },
  { id: 2, name: "Claude Sonnet", model: "", provider: "Anthropic", description: "", available: true, isDefault: false },
  { id: 3, name: "Modèle maison", model: "", provider: "", description: "", available: false, isDefault: false }
];
const legacy = createLegacyHistory(agents);

function modernHistory(conversations, { projectId = null, query = "" } = {}) {
  const sorted = visibleConversations(conversations.map(c => ({ ...c })), { projectId, query });
  if (!sorted.length) return query.trim() ? [`! ${NO_RESULT}`] : [];
  return groupHistory(sorted, NOW).flatMap(group => [`# ${group.label}`, ...group.items.map(c => `item: ${conversationTitle(c)}`)]);
}

// ---- Jeu de cas : un cas par frontière de date, épinglage « truthy » inclus.
const stamps = [
  ["maintenant", NOW],
  ["début de journée", startOfToday],
  ["veille 23:59", startOfToday - 1],
  ["début d'hier", startOfYesterday],
  ["avant-hier 23:59", startOfYesterday - 1],
  ["7 j - 1 ms", NOW - 7 * DAY + 1],
  ["7 j pile", NOW - 7 * DAY],
  ["30 j - 1 ms", NOW - 30 * DAY + 1],
  ["30 j pile", NOW - 30 * DAY],
  ["zéro", 0],
  ["absent", undefined],
  ["futur", NOW + 5 * DAY]
];
const pins = [undefined, false, true, "oui"];
const projects = [undefined, null, "p1", ""];
const dataset = [];
for (const [label, updatedAt] of stamps) {
  for (const pinned of pins) {
    for (const projectId of projects) {
      const n = dataset.length;
      const conversation = { id: `c${n}`, updatedAt, messages: [{ role: "user", content: n % 5 === 0 ? "Salut le monde" : n % 7 === 0 ? null : 42 }] };
      if (pinned !== undefined) conversation.pinned = pinned;
      if (projectId !== undefined) conversation.projectId = projectId;
      if (n % 3 !== 0) conversation.title = `${label} #${n}${n % 4 === 0 ? " SALUT" : ""}`;
      dataset.push(conversation);
    }
  }
}

test("groupes aux frontières exactes (fuseau local)", () => {
  const group = updatedAt => historyGroup({ id: "x", updatedAt }, NOW);
  assert.equal(group(NOW), GROUP_TODAY);
  assert.equal(group(startOfToday), GROUP_TODAY);
  assert.equal(group(startOfToday - 1), GROUP_YESTERDAY);
  assert.equal(group(startOfYesterday), GROUP_YESTERDAY);
  assert.equal(group(startOfYesterday - 1), GROUP_WEEK);
  assert.equal(group(NOW - 7 * DAY + 1), GROUP_WEEK);
  assert.equal(group(NOW - 7 * DAY), GROUP_MONTH);
  assert.equal(group(NOW - 30 * DAY + 1), GROUP_MONTH);
  assert.equal(group(NOW - 30 * DAY), GROUP_OLDER);
  assert.equal(group(undefined), GROUP_OLDER);
  assert.equal(historyGroup({ id: "x", pinned: true, updatedAt: 0 }, NOW), GROUP_PINNED);
});

test("recherche : titre et contenus, insensible à la casse, espaces ignorés", () => {
  const list = [
    { id: "a", title: "Maths", messages: [{ role: "user", content: "dérivée" }] },
    { id: "b", title: "Histoire", messages: [{ role: "assistant", content: "La DÉRIVÉE seconde" }] },
    { id: "c", title: "Autre", messages: [] }
  ];
  const ids = query => visibleConversations(list, { projectId: null, query }).map(c => c.id).sort();
  assert.deepEqual(ids("  DÉRIVÉE "), ["a", "b"]);
  assert.deepEqual(ids("histoire"), ["b"]);
  assert.deepEqual(ids("   "), ["a", "b", "c"]);
});

test("la liste d'entrée n'est pas réordonnée", () => {
  const list = [{ id: "1", updatedAt: 1 }, { id: "2", updatedAt: 2 }];
  visibleConversations(list, { projectId: null, query: "" });
  assert.deepEqual(list.map(c => c.id), ["1", "2"]);
});

test("titre par défaut « Sans titre »", () => {
  assert.equal(conversationTitle({ id: "x" }), "Sans titre");
  assert.equal(conversationTitle({ id: "x", title: "" }), "Sans titre");
});

for (const projectId of [null, "p1"]) {
  for (const query of ["", "   ", "SALUT", "  salut le ", "zzz-introuvable", "42"]) {
    test(`identique à l'ancien renderHistory — projet ${projectId}, recherche « ${query} » (${dataset.length} discussions)`, () => {
      const expected = legacy.render(dataset, { projectId, query }).lines;
      assert.deepEqual(modernHistory(dataset, { projectId, query }), expected);
      assert.ok(query === "zzz-introuvable" || expected.length > 0, "le cas ne doit pas être vide par accident");
    });
  }
}

test("l'ancien rendu contient bien les six groupes (le jeu de cas n'est pas trivial)", () => {
  const labels = new Set(legacy.render(dataset).lines.filter(line => line.startsWith("# ")).map(line => line.slice(2)));
  assert.deepEqual([...labels].sort(), [GROUP_PINNED, GROUP_TODAY, GROUP_YESTERDAY, GROUP_WEEK, GROUP_MONTH, GROUP_OLDER].sort());
});

test("logos des fournisseurs : module TypeScript identique à logos.js", () => {
  assert.deepEqual({ ...PROVIDER_LOGOS }, Object.fromEntries(Object.entries(legacy.logos).map(([provider, html]) => [provider, html.replace(`src="logo/`, `src="/legacy/logo/`)])));
});

test("icônes : mêmes tracés et même balisage que icon() de l'ancienne interface", () => {
  for (const name of Object.keys(ICON_PATHS)) {
    for (const size of [14, 16, 20]) assert.equal(icon(name, size), legacy.evaluate(`icon("${name}", ${size})`));
  }
});

test("providerLabel : identique à l'ancienne interface (grille fournisseur × nom)", () => {
  const providers = [undefined, null, "", "  ", "openai", "OpenAI", "ChatGPT", "anthropic", "Claude", "vertex", "mixtral", "meta", "grok", "deepseek", "alibaba", "Inconnu", "x"];
  const names = [undefined, "", "GPT-5", "Claude Opus", "Gemini Pro", "Llama 3", "Qwen", "Autre"];
  for (const provider of providers) {
    for (const name of names) {
      const expected = legacy.evaluate(`providerLabel(${JSON.stringify(provider ?? null)}, ${JSON.stringify(name ?? null)})`);
      assert.equal(providerLabel(provider, name), expected, `provider=${provider} name=${name}`);
    }
  }
});

test("agentLabel : identique (parenthèse finale retirée, nom entièrement entre parenthèses conservé)", () => {
  for (const name of ["GPT-5 (rapide)", "Claude", "(seul)", "A (b) (c)", "  Espaces  (x) "]) {
    assert.equal(agentLabel({ name, provider: "" }), legacy.evaluate(`agentLabel({ name: ${JSON.stringify(name)} })`), name);
  }
  assert.equal(agentLabel(null), "");
});

test("providerMark : Claude, modèles Anthropic sans fournisseur et icône neutre", () => {
  for (const model of [
    { name: "Claude", provider: "anthropic" }, { name: "Sonnet 4.6", provider: "" },
    { name: "Opus", provider: "Claude" }, { name: "Haiku", provider: "" }
  ]) assert.ok(providerMark(model, PROVIDER_LOGOS).includes("/legacy/logo/claude.png"));
  assert.equal(providerMark({ name: "GPT-5", provider: "OpenAI" }, PROVIDER_LOGOS), legacy.logos.OpenAI);
  assert.match(providerMark({ name: "Autre", provider: "Inconnu" }, PROVIDER_LOGOS), /^<svg /);
});

test("modèle d'une discussion : catalogue d'abord, sinon nom/fournisseur gardés, sinon aucun", () => {
  const cases = [
    { id: "a", agentId: 1 },
    { id: "b", agentId: 99, agentName: "Mistral Large", agentProvider: "mistral" },
    { id: "c", agentId: 99, agentName: "Modèle seul" },
    { id: "d", agentId: 99 },
    { id: "e", agentProvider: "grok" }
  ];
  const expected = [
    { name: "GPT-5 (rapide)", provider: "OpenAI" },
    { name: "Mistral Large", provider: "Mistral" },
    { name: "Modèle seul", provider: "" },
    null,
    { name: "Modèle", provider: "xAI" }
  ];
  cases.forEach((conversation, index) => {
    const actual = conversationAgent(conversation, agents);
    assert.deepEqual(actual && { name: actual.name, provider: actual.provider }, expected[index], conversation.id);
  });
});

console.log(`Historique (TypeScript) : ${count} vérifications réussies.`);
