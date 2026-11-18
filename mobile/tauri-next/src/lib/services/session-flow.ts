import type { ExchangeResult } from "../types/api.ts";
import { errorMessage } from "../utils/errors.ts";
import { cleanSession } from "../utils/session.ts";
import { parseStoredState, patchStoredState } from "../utils/state.ts";
import type { StatePatch } from "../utils/state.ts";
import { AuthError, createTokenProvider } from "./auth.ts";
import type { TokenProvider } from "./auth.ts";

// Cycle de vie de la session : démarrage, connexion, déconnexion.
// Port de app.js (startApp), login.js (activateSession, logout) et legacy-session.js (Keychain).

export interface SecureSession {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  delete(): Promise<void>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SessionFlowDeps {
  secure: SecureSession;
  exchange(session: string, deviceId: string): Promise<ExchangeResult>;
  loginWithPassword(email: string, password: string): Promise<string>;
  storage: KeyValueStorage;
  storeKey: string;
  makeId(): string;
  /** Appelé quand les réglages n'ont pas pu être écrits (stockage plein) ; la session, elle, est déjà en sécurité. */
  warn?(message: string): void;
}

export type StartResult =
  | { screen: "app"; message: "" }
  | { screen: "login"; message: string };

export interface SessionFlow {
  tokens: TokenProvider;
  start(): Promise<StartResult>;
  loginWithPassword(email: string, password: string): Promise<void>;
  /** Renvoie `false` quand le texte collé est vide une fois nettoyé (rien n'est tenté). */
  loginWithCookie(raw: string): Promise<boolean>;
  logout(): Promise<void>;
}

export function createSessionFlow(deps: SessionFlowDeps): SessionFlow {
  let session = "";
  let candidate: string | null = null;
  let deviceId = "";
  let secureReady = false;

  const tokens = createTokenProvider({
    exchange: deps.exchange,
    getSession: () => candidate ?? session,
    getDeviceId: () => deviceId
  });

  function persist(patch: StatePatch): void {
    try {
      deps.storage.setItem(deps.storeKey, patchStoredState(deps.storage.getItem(deps.storeKey), patch));
    } catch {
      deps.warn?.("Impossible d’enregistrer les réglages sur ce téléphone. Vérifie le stockage disponible.");
    }
  }

  /** Écrit puis relit : la session n'est considérée enregistrée que si le Keychain la renvoie à l'identique. */
  async function writeVerifiedSession(value: string): Promise<void> {
    const previous = await deps.secure.read();
    try {
      await deps.secure.write(value);
      if ((await deps.secure.read()) !== value) throw new Error("La session n'a pas été confirmée par le stockage sécurisé.");
    } catch (error) {
      if (previous && previous !== value) {
        try { await deps.secure.write(previous); } catch { /* la restauration est au mieux */ }
      }
      throw error;
    }
  }

  async function start(): Promise<StartResult> {
    const stored = parseStoredState(deps.storage.getItem(deps.storeKey), deps.makeId);
    deviceId = stored.deviceId;
    try {
      const old = stored.session;
      let secure = await deps.secure.read();
      if (old && secure && old !== secure) {
        throw new Error("Deux sessions locales différentes ont été trouvées. Les données ont été conservées.");
      }
      if (old && !secure) {
        await writeVerifiedSession(old);
        secure = old;
      }
      session = secure || "";
      secureReady = true;
    } catch (error) {
      return { screen: "login", message: "Stockage sécurisé indisponible : " + errorMessage(error) };
    }
    // Retire la copie en clair du cookie (si elle existait) et fixe l'identifiant d'appareil.
    persist({ deviceId });
    if (!session) return { screen: "login", message: "" };
    try {
      await tokens.getAccessToken(true);
    } catch (error) {
      if (error instanceof AuthError) return { screen: "login", message: error.message };
    }
    return { screen: "app", message: "" };
  }

  async function activate(next: string): Promise<void> {
    if (!secureReady) throw new Error("Stockage sécurisé indisponible. Relance l’application avant de te connecter.");
    candidate = next;
    tokens.invalidate();
    try {
      await tokens.getAccessToken(true);
      await writeVerifiedSession(next);
    } catch (error) {
      tokens.invalidate();
      throw error;
    } finally {
      candidate = null;
    }
    const changed = session !== next;
    session = next;
    persist({
      deviceId,
      ...(changed ? { webSearchMode: "open" as const, customInstructionsManaged: false, fileInstrSynced: false } : {})
    });
  }

  async function loginWithPassword(email: string, password: string): Promise<void> {
    await activate(await deps.loginWithPassword(email, password));
  }

  async function loginWithCookie(raw: string): Promise<boolean> {
    const cleaned = cleanSession(raw);
    if (!cleaned) return false;
    await activate(cleaned);
    return true;
  }

  async function logout(): Promise<void> {
    try {
      await deps.secure.delete();
    } catch (error) {
      throw new Error("Déconnexion impossible : " + errorMessage(error));
    }
    session = "";
    tokens.invalidate();
    persist({ profile: null, customInstructionsManaged: false, fileInstrSynced: false, webSearchMode: "open" });
  }

  return { tokens, start, loginWithPassword, loginWithCookie, logout };
}
