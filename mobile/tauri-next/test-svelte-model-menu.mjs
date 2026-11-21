// Menu « Modèle par défaut » : mêmes règles que renderDefaultModelSelect / defaultAgentValid de mobile/www/js/models.js.
import assert from "node:assert/strict";
import { OTHER_MODELS, defaultAgentValid, modelGroups } from "./src/lib/utils/model-menu.ts";

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

const agents = [
  { id: 1, name: "GPT-5", provider: "OpenAI", available: true },
  { id: 2, name: "Claude", provider: "Anthropic", available: true },
  { id: 3, name: "GPT-4", provider: "OpenAI", available: false },
  { id: 4, name: "Maison", provider: "", available: true }
];

test("modèle par défaut valide : identifiant connu ET disponible", () => {
  assert.equal(defaultAgentValid(agents, 1), true);
  assert.equal(defaultAgentValid(agents, 3), false, "indisponible");
  assert.equal(defaultAgentValid(agents, 99), false, "inconnu");
  assert.equal(defaultAgentValid(agents, null), false, "automatique");
  assert.equal(defaultAgentValid([], 1), false);
});

test("groupes : par fournisseur dans l'ordre d'apparition, « Autres modèles » si le fournisseur est vide", () => {
  const groups = modelGroups(agents);
  assert.deepEqual(groups.map(group => group.provider), ["OpenAI", "Anthropic", OTHER_MODELS]);
  assert.deepEqual(groups[0].agents.map(agent => agent.id), [1, 3], "les indisponibles restent listés (grisés par l'écran)");
  assert.deepEqual(groups[2].agents.map(agent => agent.id), [4]);
  assert.equal(OTHER_MODELS, "Autres modèles");
  assert.deepEqual(modelGroups([]), []);
});

console.log(`test-svelte-model-menu : ${count} tests réussis`);
