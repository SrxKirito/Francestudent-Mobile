import type { Agent, AgentLike } from "../types/agent.ts";
import type { Conversation } from "../types/conversation.ts";

// Libellés et pastilles de modèles repris de mobile/www/js/models.js (providerLabel, agentLabel, providerMark)
// et de la recherche du modèle d'une discussion dans `renderHistory()`.

const PROVIDER_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/openai|gpt|chatgpt/, "OpenAI"],
  [/anthropic|claude/, "Anthropic"],
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

/** Pastille HTML du fournisseur : logo connu, sinon initiale. `logos` correspond à `window.PROVIDER_LOGOS`. */
export function providerMark(agent: AgentLike | null, logos: Readonly<Record<string, string>>): string {
  const provider = agent ? agent.provider : "";
  if (provider && logos[provider]) return logos[provider];
  const source = agent ? provider || agent.name : "";
  const letter = source ? source.charAt(0).toUpperCase().replace(/[<>&"']/g, "") : "";
  return '<span class="model-logo-letter">' + (letter || "?") + "</span>";
}

/** Modèle d'une discussion : celui du catalogue s'il existe encore, sinon ce que la discussion en a gardé. */
export function conversationAgent(conversation: Conversation, agents: readonly Agent[]): AgentLike | null {
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
