/** Les commandes Rust rejettent avec une chaîne, le reste du code avec une `Error` : on affiche les deux. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : String(error);
}
