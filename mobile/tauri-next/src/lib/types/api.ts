// Contrats partagés entre l'interface et les commandes Rust (src-tauri/src/lib.rs).

/** Évènements émis par la commande Rust `legacy_request` sur un Channel. */
export type TransportEvent =
  | { kind: "started"; status: number; content_type: string | null; retry_after: string | null }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "finished" };

/** Arguments de `legacy_request` (hors `id` et `onEvent`, ajoutés par le transport). */
export interface ApiRequest {
  token: string;
  method: string;
  path: string;
  accept: string;
  lockedAccess?: string;
  body?: string;
}

/** Réponse de `legacy_exchange`. `expiresAt` est en secondes, `expiresIn` en secondes relatives. */
export interface ExchangeResult {
  accessToken: string;
  expiresAt?: number | string;
  expiresIn?: number | string;
}

export interface LoginInput {
  url: string;
  method: string;
  data?: string;
  headers: Record<string, string>;
}

/** Forme exacte de `francestudent_api::login::LoginResponse` : à typer après lecture du struct Rust. */
export type LoginOutput = Record<string, unknown>;

export type UploadKind = "file" | "skill";
