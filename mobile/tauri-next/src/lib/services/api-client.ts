import type { ApiRequest } from "../types/api.ts";
import type { TokenProvider } from "./auth.ts";

// Client JSON authentifié pour les écrans de l'application (réglages, fichiers, compétences…).
// Le transport réel est `requestStream` (commande Rust `legacy_request`, qui valide méthode et chemin contre l'OpenAPI) ;
// il est injecté ici pour que la logique se teste sous Node sans Tauri.

export type RequestStream = (request: ApiRequest, signal?: AbortSignal) => Promise<Response>;

/** Réponse HTTP en erreur : `status` permet à l'écran de distinguer un refus d'une panne. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface ApiClientOptions {
  tokens: TokenProvider;
  request: RequestStream;
}

export interface ApiCall {
  /** GET par défaut ; mis en majuscules. */
  method?: string;
  /** Sérialisé en JSON. */
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiClient {
  /** Renvoie le JSON de la réponse (`null` si elle est vide) ; rejette avec `ApiError` ou `AuthError`. */
  json<T = unknown>(path: string, call?: ApiCall): Promise<T>;
}

function aborted(): DOMException {
  return new DOMException("Requête annulée.", "AbortError");
}

/** Même extraction du message que `settingsApi` de mobile/www/js/settings.js. */
function failureMessage(data: unknown, status: number): string {
  let message = "";
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const error = record.error;
    const nested = error && typeof error === "object" ? (error as Record<string, unknown>).message : typeof error === "string" ? error : "";
    for (const candidate of [nested, record.message, record.detail]) {
      if (typeof candidate === "string" && candidate) {
        message = candidate;
        break;
      }
    }
  } else if (typeof data === "string") {
    message = data.slice(0, 200);
  }
  return message || `Erreur ${status}`;
}

async function readBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { tokens, request } = options;

  async function send(path: string, method: string, body: string | undefined, force: boolean, signal?: AbortSignal): Promise<Response> {
    const token = await tokens.getAccessToken(force);
    if (signal?.aborted) throw aborted();
    const call: ApiRequest = { token, method, path, accept: "application/json" };
    if (body !== undefined) call.body = body;
    return request(call, signal);
  }

  async function json<T = unknown>(path: string, call: ApiCall = {}): Promise<T> {
    const method = (call.method ?? "GET").toUpperCase();
    const body = call.body === undefined ? undefined : JSON.stringify(call.body);
    if (call.signal?.aborted) throw aborted();
    let response = await send(path, method, body, false, call.signal);
    if (response.status === 401) {
      // Jeton refusé (expiré côté serveur) : un seul nouvel essai avec un jeton neuf.
      tokens.invalidate();
      // Corps abandonné sans l'attendre : l'annulation d'un flux peut rester en attente et ne doit pas bloquer le nouvel essai.
      void response.body?.cancel().catch(() => {});
      if (call.signal?.aborted) throw aborted();
      response = await send(path, method, body, true, call.signal);
    }
    const data = await readBody(response);
    if (call.signal?.aborted) throw aborted();
    if (!response.ok) throw new ApiError(failureMessage(data, response.status), response.status);
    return data as T;
  }

  return { json };
}
