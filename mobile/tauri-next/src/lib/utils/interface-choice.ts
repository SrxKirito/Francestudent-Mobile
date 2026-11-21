// Choix de l'interface (classique / Svelte 5 bêta) : même comportement que `interface-settings.js`, côté Svelte.
// Les règles de lecture viennent de ui-flag.ts (source unique pour le démarrage) ; ici on ajoute le choix et son écriture.
import { CHAT_FLAG_KEY, UI_FLAG_KEY, chatMode, uiMode } from "./ui-flag.ts";
import type { UiMode } from "./ui-flag.ts";

export interface InterfaceChoice {
  ui: UiMode;
  /** Chat Svelte (n'existe qu'avec l'interface Svelte). */
  chat: boolean;
}

export type InterfaceAction = { kind: "ui"; ui: UiMode } | { kind: "chat" };

export type InterfaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function read(storage: InterfaceStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Interface réellement affichée au démarrage : paramètres d'URL d'abord, puis clés locales, puis valeurs par défaut. */
export function interfaceState(search: string, storage: InterfaceStorage): InterfaceChoice {
  const ui = uiMode(search, read(storage, UI_FLAG_KEY));
  if (ui !== "svelte") return { ui, chat: false };
  return { ui, chat: chatMode(search, read(storage, CHAT_FLAG_KEY)) === "svelte" };
}

/** Choix demandé par un bouton « Interface… » ou par l'interrupteur du nouveau chat. */
export function chooseInterface(current: InterfaceChoice, action: InterfaceAction): InterfaceChoice {
  if (action.kind === "chat") return { ui: "svelte", chat: !current.chat };
  return { ui: action.ui, chat: action.ui === "svelte" && (current.ui === "svelte" ? current.chat : true) };
}

function restore(storage: InterfaceStorage, key: string, previous: string | null): void {
  try {
    if (previous === null) storage.removeItem(key);
    else storage.setItem(key, previous);
  } catch {
    // Le stockage est déjà refusé : on ne peut rien faire de plus.
  }
}

/**
 * Enregistre le choix et renvoie l'adresse à recharger (sans `?ui` ni `?chat`, qui l'emporteraient sur la clé).
 * Renvoie `null`, sans rien laisser d'écrit, si l'adresse est invalide ou si le stockage refuse l'écriture.
 */
export function applyInterface(choice: InterfaceChoice, storage: InterfaceStorage, href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  url.searchParams.delete("ui");
  url.searchParams.delete("chat");
  const previousUi = read(storage, UI_FLAG_KEY);
  const previousChat = read(storage, CHAT_FLAG_KEY);
  try {
    storage.setItem(UI_FLAG_KEY, choice.ui);
    if (choice.ui === "svelte") storage.setItem(CHAT_FLAG_KEY, choice.chat ? "svelte" : "legacy");
    else storage.removeItem(CHAT_FLAG_KEY);
  } catch {
    restore(storage, UI_FLAG_KEY, previousUi);
    restore(storage, CHAT_FLAG_KEY, previousChat);
    return null;
  }
  return url.toString();
}
