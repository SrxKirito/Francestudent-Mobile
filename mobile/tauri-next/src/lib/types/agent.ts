// Modèle (« agent ») tel que `normalizeAgent()` de mobile/www/js/models.js le produit à partir de `/chats/agents`.

export interface Agent {
  id: number;
  name: string;
  model: string;
  /** Nom normalisé du fournisseur (« OpenAI », « Anthropic »…), vide si inconnu. */
  provider: string;
  description: string;
  available: boolean;
  isDefault: boolean;
}

/** Ce qu'il reste d'un modèle quand il n'est plus au catalogue : le nom et le fournisseur gardés dans la discussion. */
export type AgentLike = Pick<Agent, "name" | "provider">;
