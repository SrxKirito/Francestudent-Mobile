import { errorMessage } from "../utils/errors.ts";
import type { SessionFlow } from "./session-flow.ts";

// Comportement des deux formulaires de connexion, repris de login() et cookieLogin() de mobile/www/js/login.js.

export type LoginBusy = "" | "password" | "cookie";

/** Partie de l'état de l'écran de connexion que les actions modifient (portée par des `$state` côté Svelte). */
export interface LoginView {
  error: string;
  busy: LoginBusy;
}

type Flow = Pick<SessionFlow, "loginWithPassword" | "loginWithCookie">;

/** Renvoie `true` quand la connexion a abouti. Champs vides ou connexion déjà en cours : rien n'est tenté. */
export async function submitPassword(flow: Flow, view: LoginView, rawEmail: string, password: string): Promise<boolean> {
  const email = rawEmail.trim();
  if (view.busy || !email || !password) return false;
  view.busy = "password";
  view.error = "";
  try {
    await flow.loginWithPassword(email, password);
    return true;
  } catch (error) {
    view.error = errorMessage(error);
    return false;
  } finally {
    view.busy = "";
  }
}

export async function submitCookie(flow: Flow, view: LoginView, raw: string): Promise<boolean> {
  if (view.busy) return false;
  view.busy = "cookie";
  view.error = "";
  try {
    return await flow.loginWithCookie(raw);
  } catch (error) {
    view.error = errorMessage(error);
    return false;
  } finally {
    view.busy = "";
  }
}
