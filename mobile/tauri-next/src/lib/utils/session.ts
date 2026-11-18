/** Nettoie un cookie collé par l'utilisateur (guillemets, préfixe `next-auth.session-token=`). */
export function cleanSession(raw: unknown): string {
  return String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^[\w.-]*session-token=/i, "")
    .trim();
}
