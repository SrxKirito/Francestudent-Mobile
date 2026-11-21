// Données locales du compte (profil mémorisé, photo de profil, déconnexion).
//
// Une seule interface, `AccountGateway`, deux implémentations (même principe que local-settings.ts) :
//  - `createStorageAccount` lit et écrit directement `fs-chat-state` : cible finale, sans moteur historique ;
//  - `connectAccountBridge` passe par `window.__fsAccount` (svelte-settings-engine.js) et les fonctions du moteur
//    historique (`renderProfile`, `saveStore`, `logout`) : mode de transition, tant que le moteur écrit ce stockage.
// Le serveur ne conserve pas la photo : elle reste sur l'appareil (clé `avatar`), comme dans l'écran historique.
import { STORE_KEY, parseStoredState, patchStoredState } from "../utils/state.ts";
import type { StatePatch } from "../utils/state.ts";
import { isAvatarDataUrl } from "./account.ts";
import type { Profile } from "./account.ts";

export const AVATAR_STORAGE_FULL = "Stockage plein : impossible d'enregistrer la photo.";
export const AVATAR_INVALID = "Choisis un fichier image.";
const PROFILE_REFUSED = "Impossible d’enregistrer le profil : le stockage local est refusé.";
const SIGN_OUT_REFUSED = "Déconnexion impossible : le stockage local est refusé.";

export interface AccountLocal {
  profile: Profile;
  /** data URL d'image ; vide si aucune photo n'a été choisie. */
  avatar: string;
}

export interface AccountGateway {
  read(): AccountLocal;
  saveProfile(profile: Profile): void;
  /** Lève `AVATAR_INVALID` ou `AVATAR_STORAGE_FULL` (l'ancienne photo est alors conservée). */
  setAvatar(dataUrl: string): void;
  removeAvatar(): void;
  /** Efface la session et ce qui dépend du compte ; lève si la déconnexion n'a pas abouti. */
  signOut(): Promise<void>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(input: unknown): AccountLocal {
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    profile: { name: text(source.name), email: text(source.email) },
    avatar: isAvatarDataUrl(source.avatar) ? (source.avatar as string) : ""
  };
}

// --- Implémentation directe : localStorage -----------------------------------------------

export type AccountStorage = Pick<Storage, "getItem" | "setItem">;

export function createStorageAccount(storage: AccountStorage, key: string = STORE_KEY): AccountGateway {
  function readRaw(): string | null {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }
  function write(patch: StatePatch, failure: string): void {
    const next = patchStoredState(readRaw(), patch);
    try {
      storage.setItem(key, next);
    } catch {
      throw new Error(failure);
    }
  }
  return {
    read() {
      const state = parseStoredState(readRaw(), () => "");
      return normalize({ name: state.profile?.name, email: state.profile?.email, avatar: state.avatar });
    },
    saveProfile(profile) {
      write({ profile: { name: profile.name, email: profile.email } }, PROFILE_REFUSED);
    },
    setAvatar(dataUrl) {
      if (!isAvatarDataUrl(dataUrl)) throw new Error(AVATAR_INVALID);
      write({ avatar: dataUrl }, AVATAR_STORAGE_FULL);
    },
    removeAvatar() {
      write({ avatar: "" }, PROFILE_REFUSED);
    },
    async signOut() {
      // Comme `logout()` de login.js ; le thème, la photo et les autres préférences restent sur l'appareil.
      write({ profile: null, customInstructionsManaged: false, fileInstrSynced: false, webSearchMode: "open" }, SIGN_OUT_REFUSED);
    }
  };
}

// --- Implémentation par le pont : svelte-settings-engine.js -------------------------------

/** Ce qu'expose `window.__fsAccount` dans l'iframe : du texte JSON, pas d'objets partagés. */
export interface RawAccountBridge {
  read(): string;
  saveProfile(profile: string): void;
  setAvatar(dataUrl: string): void;
  removeAvatar(): void;
  signOut(): Promise<void>;
}

const BRIDGE_METHODS = ["read", "saveProfile", "setAvatar", "removeAvatar", "signOut"] as const;

function isRawBridge(value: unknown): value is RawAccountBridge {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return BRIDGE_METHODS.every(method => typeof record[method] === "function");
}

export function createBridgeAccount(raw: RawAccountBridge): AccountGateway {
  return {
    read() {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.read());
      } catch {
        parsed = null;
      }
      return normalize(parsed);
    },
    saveProfile(profile) {
      raw.saveProfile(JSON.stringify({ name: profile.name, email: profile.email }));
    },
    setAvatar(dataUrl) {
      if (!isAvatarDataUrl(dataUrl)) throw new Error(AVATAR_INVALID);
      raw.setAvatar(dataUrl);
    },
    removeAvatar() {
      raw.removeAvatar();
    },
    async signOut() {
      await raw.signOut();
    }
  };
}

/** `null` tant que le moteur historique n'a pas chargé le script de pont (ou si la fenêtre est inaccessible). */
export function connectAccountBridge(frameWindow: unknown): AccountGateway | null {
  let raw: unknown;
  try {
    raw = (frameWindow as { __fsAccount?: unknown } | null | undefined)?.__fsAccount;
  } catch {
    return null;
  }
  return isRawBridge(raw) ? createBridgeAccount(raw) : null;
}
