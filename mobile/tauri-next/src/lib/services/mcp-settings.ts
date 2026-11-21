import type { ApiClient } from "./api-client.ts";

export type McpAuth = "none" | "bearer" | "oauth";

export interface McpServer {
  id: string;
  server_label?: string;
  server_url?: string;
  server_description?: string;
  auth_type?: McpAuth;
  enabled?: boolean;
  require_approval?: string;
  has_authorization?: boolean;
  oauth_status?: string;
  available_tools?: { name?: string; title?: string; description?: string }[];
}

export function mcpPath(id: string) {
  return "/mcp/servers/" + encodeURIComponent(id);
}

export function mcpUrl(input: string): URL {
  const url = new URL(input.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Indique une URL HTTP ou HTTPS sans identifiants.");
  return url;
}

export function mcpIdentity(label: string, url: string) {
  const name = label.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Utilise uniquement des lettres, chiffres, underscores et tirets pour le nom.");
  try {
    return { server_label: name, server_url: mcpUrl(url).href };
  } catch {
    throw new Error("Indique une URL HTTP ou HTTPS valide, sans identifiants.");
  }
}

export function mcpCredentials(token: string, headers: string) {
  const authorization = token.trim().replace(/^Bearer\s+/i, "");
  let parsed: Record<string, string>;
  try {
    const data: unknown = JSON.parse(headers.trim() || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.values(data).some(value => typeof value !== "string")) throw new Error();
    parsed = data as Record<string, string>;
  } catch {
    throw new Error("Indique les en-têtes comme objet JSON dont les valeurs sont des chaînes.");
  }
  if (!authorization && !Object.keys(parsed).length) throw new Error("Indique un token ou un en-tête sécurisé.");
  return { ...(authorization ? { authorization } : {}), ...(Object.keys(parsed).length ? { headers: parsed } : {}) };
}

export async function listMcpServers(api: ApiClient, signal: AbortSignal): Promise<McpServer[]> {
  const result = await api.json<McpServer[] | { data?: McpServer[]; servers?: McpServer[] }>("/mcp/servers", { signal });
  const rows = Array.isArray(result) ? result : result?.data ?? result?.servers;
  if (!Array.isArray(rows)) throw new Error("Liste de serveurs MCP illisible.");
  return [...new Map(rows.filter(row => typeof row?.id === "string" && row.id).map(row => [row.id, row])).values()];
}

export interface McpOAuth { id: string; url: string; state: string }

export async function startMcpOAuth(api: ApiClient, id: string, signal: AbortSignal): Promise<McpOAuth> {
  const response = await api.json<{ authorization_url: string; state: string }>(mcpPath(id) + "/oauth/start", { method: "POST", body: {}, signal });
  if (typeof response?.state !== "string" || !response.state || typeof response.authorization_url !== "string") throw new Error("Réponse OAuth incomplète.");
  return { id, url: mcpUrl(response.authorization_url).href, state: response.state };
}

export function mcpOAuthCode(input: string, state: string): string {
  const text = input.trim();
  if (!text) throw new Error("Indique le code d’autorisation.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  const url = new URL(text);
  if (url.searchParams.get("state") !== state) throw new Error("La connexion ne correspond pas à cette demande.");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Le retour OAuth ne contient pas de code d’autorisation.");
  return code;
}
