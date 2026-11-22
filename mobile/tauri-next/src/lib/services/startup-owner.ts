import type { KeyValueStorage } from "./session-flow.ts";

export async function resolveStartupOwner(storage: KeyValueStorage, key: string, confirmedScope: Promise<string>,
  profileEmail: Promise<string>, signal: AbortSignal): Promise<string> {
  const scope = await confirmedScope;
  if (signal.aborted) return "";
  if (scope) {
    try {
      const binding = JSON.parse(storage.getItem(key) || "null");
      if (binding?.scope === scope && typeof binding.owner === "string" && binding.owner) return binding.owner;
    } catch { /* La session n’a pas d’association lisible. */ }
  }

  const email = await profileEmail;
  if (signal.aborted) return "";
  const owner = email || scope;
  if (scope && owner) {
    try { storage.setItem(key, JSON.stringify({ scope, owner })); }
    catch { /* L’association reste disponible pour cette ouverture. */ }
  }
  return owner;
}
