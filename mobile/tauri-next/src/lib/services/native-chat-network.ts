import type { ApiRequest } from "../types/api.ts";
import type { TokenProvider } from "./auth.ts";
import { requestStream } from "./transport.ts";

export interface NativeRequestOptions {
  method?: string;
  accept?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export type NativeRequest = (path: string, options?: NativeRequestOptions) => Promise<Response>;
export type NativeTransport = (request: ApiRequest, signal?: AbortSignal) => Promise<Response>;

/** Requête authentifiée au transport Rust. Seul un refus explicite 401 autorise à retenter. */
export function createNativeRequest(tokens: TokenProvider, transport: NativeTransport = requestStream): NativeRequest {
  return async (path, { method = "GET", accept = "application/json", body, signal } = {}) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const send = async (force: boolean) => {
      signal?.throwIfAborted();
      const token = await tokens.getAccessToken(force);
      signal?.throwIfAborted();
      const options: ApiRequest = { token, method, path, accept };
      if (encoded !== undefined) options.body = encoded;
      return transport(options, signal);
    };
    const response = await send(false);
    if (response.status !== 401) return response;
    void response.body?.cancel().catch(() => {});
    tokens.invalidate();
    return send(true);
  };
}
