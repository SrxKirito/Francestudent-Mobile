import { loginWithPassword } from "./login.ts";
import { readPageFromHtml } from "./page-reader.ts";
import { createSessionFlow } from "./session-flow.ts";
import type { SessionFlow } from "./session-flow.ts";
import { native } from "./transport.ts";
import { STORE_KEY } from "../utils/state.ts";

/** Branche le cycle de vie de la session sur le vrai Keychain (commandes Rust), localStorage et le DOM de la WebView. */
export function createRuntimeSessionFlow(): SessionFlow {
  return createSessionFlow({
    secure: {
      read: () => native.readSession(),
      write: value => native.writeSession(value),
      delete: () => native.deleteSession()
    },
    exchange: native.exchange,
    loginWithPassword: (email, password) =>
      loginWithPassword({ http: native.login, readPage: readPageFromHtml }, email, password),
    storage: window.localStorage,
    storeKey: STORE_KEY,
    makeId: () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
    warn: message => console.warn(message)
  });
}
