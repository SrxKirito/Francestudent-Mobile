export type UiMode = "svelte" | "legacy";

export const UI_FLAG_KEY = "fs-ui";

/**
 * Choix de l'interface. La nouvelle interface Svelte 5 est la valeur par défaut ; l'ancien écran (iframe historique)
 * reste accessible avec `?ui=legacy` (navigateur) ou `localStorage["fs-ui"] = "legacy"` (application installée, où l'on
 * ne peut pas modifier l'URL de démarrage). Le paramètre d'URL l'emporte sur la clé enregistrée ; toute autre valeur
 * est ignorée.
 */
export function uiMode(search: string, stored: string | null): UiMode {
  const asked = new URLSearchParams(search).get("ui");
  if (asked === "svelte" || asked === "legacy") return asked;
  return stored === "legacy" ? "legacy" : "svelte";
}

export const CHAT_FLAG_KEY = "fs-chat";

/**
 * Sous-drapeau du chat, utile seulement avec la nouvelle interface : le chat Svelte est la valeur par défaut ;
 * `?chat=legacy` ou `localStorage["fs-chat"] = "legacy"` rétablit le chat historique (iframe) dans la nouvelle interface.
 */
export function chatMode(search: string, stored: string | null): UiMode {
  const asked = new URLSearchParams(search).get("chat");
  if (asked === "svelte" || asked === "legacy") return asked;
  return stored === "legacy" ? "legacy" : "svelte";
}
