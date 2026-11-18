import type { ExchangeResult } from "../types/api.ts";

export const TOKEN_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 300;

export class AuthError extends Error {
  readonly auth = true;
}

export interface TokenProviderDeps {
  /** Commande Rust `legacy_exchange` : l'échange de cookie contre un jeton d'accès se fait côté Rust. */
  exchange(session: string, deviceId: string): Promise<ExchangeResult>;
  getSession(): string;
  getDeviceId(): string;
  now?: () => number;
}

export interface TokenProvider {
  getAccessToken(force?: boolean): Promise<string>;
  invalidate(): void;
}

/** Même comportement que `getAccessToken` du pont historique (legacy-bridge.js), sans état global. */
export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  const now = deps.now ?? Date.now;
  let accessToken = "";
  let expiresAt = 0;

  async function getAccessToken(force = false): Promise<string> {
    if (!force && accessToken && expiresAt - now() > TOKEN_MARGIN_MS) return accessToken;
    const session = deps.getSession();
    if (!session) throw new AuthError("Aucune session : colle ton cookie de session.");
    let data: ExchangeResult;
    try {
      data = await deps.exchange(session, deps.getDeviceId());
    } catch (error) {
      const message = String((error as { message?: unknown } | null)?.message || error);
      if (/HTTP (401|403)\b/.test(message)) throw new AuthError("Session refusée ou expirée : reconnecte-toi.");
      throw new Error("Connexion au serveur impossible : " + message);
    }
    if (!data || typeof data.accessToken !== "string" || !data.accessToken) {
      throw new AuthError("Aucun jeton reçu : session expirée ?");
    }
    accessToken = data.accessToken;
    expiresAt = data.expiresAt
      ? Number(data.expiresAt) * 1000
      : now() + (Number(data.expiresIn) || DEFAULT_TOKEN_LIFETIME_S) * 1000;
    return accessToken;
  }

  function invalidate(): void {
    accessToken = "";
    expiresAt = 0;
  }

  return { getAccessToken, invalidate };
}
