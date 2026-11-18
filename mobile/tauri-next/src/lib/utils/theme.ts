import type { Theme } from "../types/state.ts";

/** Valeur de `data-theme` sur <html> ; « système » retire l'attribut (règle de applyTheme dans conversations.js). */
export function themeAttribute(theme: unknown): "light" | "dark" | null {
  return theme === "light" || theme === "dark" ? theme : null;
}

export function applyTheme(theme: Theme, root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }): void {
  const value = themeAttribute(theme);
  if (value) root.setAttribute("data-theme", value);
  else root.removeAttribute("data-theme");
}
