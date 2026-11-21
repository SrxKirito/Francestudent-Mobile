// Réglages locaux de l'application (thème, bibliothèque, modèle par défaut, images, recherche web, notifications).
//
// Une seule interface, `LocalSettingsGateway`, deux implémentations :
//  - `createStorageSettings` lit et écrit directement `fs-chat-state` : c'est la cible finale, sans moteur historique ;
//  - `connectSettingsBridge` passe par `svelte-settings-engine.js` et les fonctions du moteur historique
//    (`applyTheme`, `setLibraryColumns`, …) : c'est le mode de transition, tant que le moteur écrit lui aussi ce stockage.
// L'écran Réglages ne dépend que de l'interface : retirer le moteur historique revient à changer d'implémentation.
import type { LibraryColumns, Theme, WebSearchMode } from "../types/state.ts";
import { STORE_KEY, parseStoredState, patchStoredState } from "../utils/state.ts";
import type { StatePatch } from "../utils/state.ts";

export interface LocalSettings {
  theme: Theme;
  libraryColumns: LibraryColumns;
  completionNotifications: boolean;
  /** Agent choisi dans « Modèle par défaut » ; `null` = Automatique (dernier utilisé). */
  defaultAgentId: number | null;
  imageTool: boolean;
  imageModel: string;
  webSearchMode: WebSearchMode;
}

/** Réglages modifiables ; les notifications passent par `toggleNotifications` (autorisation système). */
export type LocalSettingsPatch = Partial<Omit<LocalSettings, "completionNotifications">>;

export interface ImageModelOption {
  id: string;
  short: string;
  name: string;
}

export interface SettingsCatalog {
  imageModels: readonly ImageModelOption[];
  notificationsSupported: boolean;
}

export interface LocalSettingsGateway {
  read(): LocalSettings;
  catalog(): SettingsCatalog;
  /** Atomique : une valeur invalide fait échouer tout le correctif sans rien écrire. */
  update(patch: LocalSettingsPatch): void;
  toggleNotifications(): Promise<string>;
  /** À appeler après un enregistrement réussi des instructions : le moteur ne les réécrira plus. */
  instructionsSaved(): void;
  /** Une réponse est en cours dans l'ancien moteur : changer d'interface (rechargement) est alors refusé. */
  busy(): boolean;
}

// Même catalogue que `IMAGE_MODELS` de composer.js après prepare-legacy.cjs (et que l'OpenAPI).
export const IMAGE_MODEL_CATALOG: readonly ImageModelOption[] = [
  { id: "gpt-image-2.6-sunburst", short: "Sunburst", name: "GPT Image 2.6 Sunburst" },
  { id: "gpt-image-2.6-flare", short: "Flare", name: "GPT Image 2.6 Flare" },
  { id: "gpt-image-2.5-sunburst", short: "Sunburst", name: "GPT Image 2.5 Sunburst" },
  { id: "gpt-image-2.5-flare", short: "Flare", name: "GPT Image 2.5 Flare" },
  { id: "gpt-image-2", short: "Image 2", name: "gpt-image-2" }
];

export const NOTIFICATIONS_UNAVAILABLE = "Les notifications de fin de réponse ne sont disponibles que sur iOS.";
export const STORAGE_REFUSED = "Impossible d’enregistrer les réglages : le stockage local est refusé.";

const THEMES: readonly Theme[] = ["system", "light", "dark"];
const WEB_MODES: readonly WebSearchMode[] = ["open", "filtered", "disabled"];
const COLUMNS: readonly LibraryColumns[] = [1, 2, 3, 4];
const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

function invalid(key: string): Error {
  return new Error(`Valeur invalide pour le réglage « ${key} ».`);
}

/** Contrôle un correctif complet avant toute écriture ; les clés inconnues sont ignorées. */
export function validatePatch(
  input: unknown,
  imageModelIds: readonly string[] = IMAGE_MODEL_CATALOG.map(model => model.id)
): LocalSettingsPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Réglages invalides.");
  const source = input as Record<string, unknown>;
  const patch: LocalSettingsPatch = {};
  if (source.theme !== undefined) {
    const theme = THEMES.find(item => item === source.theme);
    if (!theme) throw invalid("theme");
    patch.theme = theme;
  }
  if (source.libraryColumns !== undefined) {
    const columns = COLUMNS.find(item => item === source.libraryColumns);
    if (!columns) throw invalid("libraryColumns");
    patch.libraryColumns = columns;
  }
  if (source.defaultAgentId !== undefined) {
    const id = source.defaultAgentId;
    if (id !== null && !Number.isInteger(id)) throw invalid("defaultAgentId");
    patch.defaultAgentId = id as number | null;
  }
  if (source.imageTool !== undefined) {
    if (typeof source.imageTool !== "boolean") throw invalid("imageTool");
    patch.imageTool = source.imageTool;
  }
  if (source.imageModel !== undefined) {
    if (typeof source.imageModel !== "string" || !imageModelIds.includes(source.imageModel)) throw invalid("imageModel");
    patch.imageModel = source.imageModel;
  }
  if (source.webSearchMode !== undefined) {
    const mode = WEB_MODES.find(item => item === source.webSearchMode);
    if (!mode) throw invalid("webSearchMode");
    patch.webSearchMode = mode;
  }
  return patch;
}

/** Remet en forme ce que renvoie le pont (déjà normalisé côté moteur, mais jamais cru sur parole). */
function normalizeSettings(input: unknown): LocalSettings {
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    theme: source.theme === "light" || source.theme === "dark" ? source.theme : "system",
    libraryColumns: COLUMNS.find(item => item === source.libraryColumns) ?? 3,
    completionNotifications: source.completionNotifications === true,
    defaultAgentId: Number.isInteger(source.defaultAgentId) ? (source.defaultAgentId as number) : null,
    imageTool: source.imageTool !== false,
    imageModel: typeof source.imageModel === "string" && source.imageModel ? source.imageModel : DEFAULT_IMAGE_MODEL,
    webSearchMode: WEB_MODES.find(item => item === source.webSearchMode) ?? "open"
  };
}

// --- Implémentation directe : localStorage -------------------------------------------

export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export function createStorageSettings(storage: SettingsStorage, key: string = STORE_KEY): LocalSettingsGateway {
  function readRaw(): string | null {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }
  function write(patch: StatePatch): void {
    const next = patchStoredState(readRaw(), patch);
    try {
      storage.setItem(key, next);
    } catch {
      throw new Error(STORAGE_REFUSED);
    }
  }
  return {
    read() {
      const state = parseStoredState(readRaw(), () => "");
      return {
        theme: state.theme,
        libraryColumns: state.libraryColumns,
        completionNotifications: state.completionNotifications,
        defaultAgentId: state.defaultAgentId,
        imageTool: state.imageTool,
        imageModel: state.imageModel,
        webSearchMode: state.webSearchMode
      };
    },
    catalog() {
      return { imageModels: IMAGE_MODEL_CATALOG, notificationsSupported: false };
    },
    update(patch) {
      const valid = validatePatch(patch);
      const next: StatePatch = {};
      Object.assign(next, valid);
      // Comme `applyImageSettingsChange` : l'outil image sera resynchronisé avec le serveur au prochain message.
      if (valid.imageTool !== undefined || valid.imageModel !== undefined) next.imageToolSynced = null;
      // Comme `applyWebSearchPreference` : « Désactivé » coupe aussi la recherche web active.
      if (valid.webSearchMode === "disabled") next.webSearch = false;
      if (Object.keys(next).length === 0) return;
      write(next as StatePatch);
    },
    async toggleNotifications() {
      throw new Error(NOTIFICATIONS_UNAVAILABLE);
    },
    instructionsSaved() {
      write({ customInstructionsManaged: true, fileInstrSynced: true });
    },
    busy() {
      return false;
    }
  };
}

// --- Implémentation par le pont : svelte-settings-engine.js -------------------------------

/** Ce qu'expose `window.__fsSettings` dans l'iframe : du texte JSON, pas d'objets partagés. */
interface RawSettingsBridge {
  read(): string;
  catalog(): string;
  update(patch: string): void;
  toggleNotifications(): Promise<string>;
  instructionsSaved(): void;
  busy(): boolean;
}

const BRIDGE_METHODS = ["read", "catalog", "update", "toggleNotifications", "instructionsSaved", "busy"] as const;

function isRawBridge(value: unknown): value is RawSettingsBridge {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return BRIDGE_METHODS.every(method => typeof record[method] === "function");
}

function parseCatalog(text: string): SettingsCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const source = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const list = Array.isArray(source.imageModels) ? source.imageModels : [];
  const imageModels: ImageModelOption[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) continue;
    imageModels.push({
      id: item.id,
      short: typeof item.short === "string" ? item.short : item.id,
      name: typeof item.name === "string" ? item.name : item.id
    });
  }
  return { imageModels, notificationsSupported: source.notificationsSupported === true };
}

export function createBridgeSettings(raw: RawSettingsBridge): LocalSettingsGateway {
  const catalog = (): SettingsCatalog => parseCatalog(raw.catalog());
  return {
    read() {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.read());
      } catch {
        parsed = null;
      }
      return normalizeSettings(parsed);
    },
    catalog,
    update(patch) {
      const valid = validatePatch(
        patch,
        catalog().imageModels.map(model => model.id)
      );
      if (Object.keys(valid).length === 0) return;
      raw.update(JSON.stringify(valid));
    },
    async toggleNotifications() {
      if (!catalog().notificationsSupported) throw new Error(NOTIFICATIONS_UNAVAILABLE);
      return raw.toggleNotifications();
    },
    instructionsSaved() {
      raw.instructionsSaved();
    },
    busy() {
      return raw.busy() === true;
    }
  };
}

/** `null` tant que le moteur historique n'a pas chargé le script de pont (ou si la fenêtre est inaccessible). */
export function connectSettingsBridge(frameWindow: unknown): LocalSettingsGateway | null {
  let raw: unknown;
  try {
    raw = (frameWindow as { __fsSettings?: unknown } | null | undefined)?.__fsSettings;
  } catch {
    return null;
  }
  return isRawBridge(raw) ? createBridgeSettings(raw) : null;
}
