// Menu « Modèle par défaut » : mêmes règles que renderDefaultModelSelect / defaultAgentValid de mobile/www/js/models.js.
import type { EngineAgent } from "../services/legacy-engine.ts";

export const OTHER_MODELS = "Autres modèles";

export interface ModelGroup {
  provider: string;
  agents: EngineAgent[];
}

/** Vrai si l'identifiant désigne un modèle connu ET disponible ; sinon l'écran retombe sur « Automatique ». */
export function defaultAgentValid(agents: readonly EngineAgent[], id: number | null): boolean {
  if (id === null) return false;
  return agents.some(agent => agent.id === id && agent.available);
}

/** Groupes par fournisseur, dans l'ordre d'apparition ; les modèles indisponibles restent listés. */
export function modelGroups(agents: readonly EngineAgent[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const agent of agents) {
    const provider = agent.provider || OTHER_MODELS;
    let group = groups.find(item => item.provider === provider);
    if (!group) {
      group = { provider, agents: [] };
      groups.push(group);
    }
    group.agents.push(agent);
  }
  return groups;
}
