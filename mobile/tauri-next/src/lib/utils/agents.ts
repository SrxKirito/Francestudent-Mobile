import type { Agent, AgentLike } from "../types/agent.ts";
import type { Conversation } from "../types/conversation.ts";

// Libellés et pastilles de modèles repris de mobile/www/js/models.js (providerLabel, agentLabel, providerMark)
// et de la recherche du modèle d'une discussion dans `renderHistory()`.

const PROVIDER_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/openai|gpt|chatgpt/, "OpenAI"],
  [/anthropic|claude|\b(?:sonnet|opus|haiku)\b/, "Anthropic"],
  [/google|gemini|gemma|vertex/, "Google"],
  [/mistral|mixtral|codestral/, "Mistral"],
  [/llama|meta/, "Meta"],
  [/xai|grok/, "xAI"],
  [/deepseek/, "DeepSeek"],
  [/qwen|alibaba/, "Alibaba"]
];

export function providerLabel(provider: unknown, name: unknown): string {
  const raw = String(provider || "").trim();
  const lowerRaw = raw.toLowerCase();
  for (const [pattern, label] of PROVIDER_NAMES) if (lowerRaw && pattern.test(lowerRaw)) return label;
  const lowerName = String(name || "").toLowerCase();
  for (const [pattern, label] of PROVIDER_NAMES) if (pattern.test(lowerName)) return label;
  if (raw) return raw.charAt(0).toUpperCase() + raw.slice(1);
  return "";
}

/** Nom affiché : la parenthèse finale (« GPT-5 (rapide) ») est retirée. */
export function agentLabel(agent: AgentLike | null): string {
  if (!agent) return "";
  const clean = String(agent.name).replace(/\s*\([^)]*\)\s*$/, "").trim();
  return clean || String(agent.name);
}

/** Logos locaux et marque générique pour les modèles sans fournisseur reconnu. */
export function providerMark(agent: AgentLike | null, logos: Readonly<Record<string, string>>): string {
  const provider = agent ? providerLabel(agent.provider, agent.name) : "";
  if (Object.hasOwn(logos, provider)) return logos[provider];
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M10 2v4m4-4v4m-4 12v4m4-4v4M2 10h4m-4 4h4m12-4h4m-4 4h4"/></svg>';
}

/** Modèle d'une discussion : celui du catalogue s'il existe encore, sinon ce que la discussion en a gardé. */
export function conversationAgent(conversation: Conversation, agents: ReadonlyArray<AgentLike & Pick<Agent, "id">>): AgentLike | null {
  const known = agents.find(agent => agent.id === conversation.agentId);
  if (known) return known;
  if (conversation.agentName || conversation.agentProvider) {
    return {
      name: conversation.agentName || "Modèle",
      provider: providerLabel(conversation.agentProvider, conversation.agentName)
    };
  }
  return null;
}
