import { createApiClient } from "./api-client.ts";
import type { ApiClient } from "./api-client.ts";
import type { TokenProvider } from "./auth.ts";
import { requestStream } from "./transport.ts";

// Assemblage de production : le transport réel (commande Rust `legacy_request`) branché sur le client JSON.
// Séparé d'api-client.ts pour que celui-ci reste testable sous Node, sans Tauri.
export function createRuntimeApiClient(tokens: TokenProvider): ApiClient {
  return createApiClient({ tokens, request: requestStream });
}
