// Garde visible le champ actif quand le clavier tactile s'ouvre : on attend la fin de l'animation du clavier,
// puis on centre le champ s'il a toujours le focus. Non vérifié sur appareil (voir docs/migration-reglages-cartographie.md).

/** Types de `<input>` qui n'ouvrent pas le clavier. */
const NO_KEYBOARD = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "range", "file", "color", "hidden"]);

export interface FocusTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  isConnected?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  scrollIntoView?: (options: { block: "center"; behavior: "smooth" }) => void;
}

export interface FocusReveal {
  (event: { target: unknown }): void;
  dispose(): void;
}

export interface FocusRevealDeps {
  /** Durée de l'animation du clavier, en millisecondes. */
  delay: number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (id: unknown) => void;
  activeElement: () => unknown;
}

/** Vrai pour un champ de saisie modifiable (texte, zone de texte, liste de choix, contenu éditable). */
export function needsKeyboard(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as FocusTarget;
  if (element.disabled === true || element.readOnly === true) return false;
  if (element.isContentEditable === true) return true;
  const tag = String(element.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NO_KEYBOARD.has(String(element.type ?? "").toLowerCase());
}

export function createFocusReveal(deps: FocusRevealDeps): FocusReveal {
  let pending: unknown = null;
  let waiting = false;

  const clear = () => {
    if (!waiting) return;
    waiting = false;
    deps.cancel(pending);
    pending = null;
  };

  const handler = ((event: { target: unknown }) => {
    clear();
    const target = event.target;
    if (!needsKeyboard(target)) return;
    const element = target as FocusTarget;
    waiting = true;
    pending = deps.schedule(() => {
      waiting = false;
      pending = null;
      if (element.isConnected === false || deps.activeElement() !== target) return;
      try {
        element.scrollIntoView?.({ block: "center", behavior: "smooth" });
      } catch {
        // Ce défilement est un confort : un navigateur qui le refuse ne doit pas gêner la saisie.
      }
    }, deps.delay);
  }) as FocusReveal;
  handler.dispose = clear;
  return handler;
}

/** Action Svelte : à poser sur le conteneur d'une fenêtre ; les champs qu'il contient (sous-fenêtres comprises) sont suivis. */
export function revealFocus(node: HTMLElement) {
  const handler = createFocusReveal({
    delay: 300,
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: id => window.clearTimeout(id as number),
    activeElement: () => node.ownerDocument.activeElement
  });
  node.addEventListener("focusin", handler);
  return {
    destroy() {
      node.removeEventListener("focusin", handler);
      handler.dispose();
    }
  };
}
