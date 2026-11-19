export type UiMode = "svelte" | "legacy";

export const UI_FLAG_KEY = "fs-ui";

/**
 * Choix de l'interface pendant la migration. L'iframe historique reste la valeur par défaut ;
 * la nouvelle interface s'active avec `?ui=svelte` (navigateur) ou `localStorage["fs-ui"] = "svelte"`
 * (application installée, où l'on ne peut pas modifier l'URL de démarrage).
 * `?ui=legacy` force l'ancien écran même si la clé est posée.
 */
export function uiMode(search: string, stored: string | null): UiMode {
  const asked = new URLSearchParams(search).get("ui");
  if (asked === "svelte" || asked === "legacy") return asked;
  return stored === "svelte" ? "svelte" : "legacy";
}

export const CHAT_FLAG_KEY = "fs-chat";

/**
 * Sous-drapeau du chat, utile seulement avec la nouvelle interface : le chat historique (iframe) reste la valeur
 * par défaut ; ?chat=svelte ou localStorage["fs-chat"] = "svelte" active le chat Svelte, ?chat=legacy le désactive.
 */
export function chatMode(search: string, stored: string | null): UiMode {
  const asked = new URLSearchParams(search).get("chat");
  if (asked === "svelte" || asked === "legacy") return asked;
  return stored === "svelte" ? "svelte" : "legacy";
}
