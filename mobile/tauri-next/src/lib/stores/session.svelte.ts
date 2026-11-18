import { submitCookie, submitPassword } from "../services/login-actions.ts";
import type { LoginBusy } from "../services/login-actions.ts";
import type { SessionFlow } from "../services/session-flow.ts";
import { errorMessage } from "../utils/errors.ts";

export type Screen = "starting" | "login" | "app";

/**
 * État de l'écran affiché, partagé par les composants. La logique (Keychain, échange de jeton, messages)
 * vit dans `SessionFlow` et `login-actions`, testées sous Node ; ici il ne reste que les `$state`.
 */
export class SessionStore {
  screen = $state<Screen>("starting");
  error = $state("");
  busy = $state<LoginBusy>("");

  readonly #flow: SessionFlow;

  constructor(flow: SessionFlow) {
    this.#flow = flow;
  }

  async start(): Promise<void> {
    try {
      const result = await this.#flow.start();
      this.error = result.message;
      this.screen = result.screen;
    } catch (error) {
      // Stockage local inaccessible : on propose la connexion plutôt que de rester sur l'écran de chargement.
      this.error = errorMessage(error);
      this.screen = "login";
    }
  }

  async loginWithPassword(email: string, password: string): Promise<boolean> {
    const done = await submitPassword(this.#flow, this, email, password);
    if (done) this.screen = "app";
    return done;
  }

  async loginWithCookie(raw: string): Promise<boolean> {
    const done = await submitCookie(this.#flow, this, raw);
    if (done) this.screen = "app";
    return done;
  }
}
