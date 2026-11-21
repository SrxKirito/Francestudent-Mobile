import type { WebSearchMode } from "../types/state.ts";
import { errorMessage } from "../utils/errors.ts";
import type { ApiClient } from "./api-client.ts";

// Paramètres > Général : préférences du compte (`/user/instructions`) et filtres de recherche web
// (`/user/web-search-domains`). Port de mobile/www/js/general-settings.js : mêmes règles et mêmes messages.
// Seule la limite des instructions suit l'OpenAPI (10 000 caractères) et non les 2 000 000 du code historique.

export type ReasoningLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const REASONING_LEVELS: readonly { value: ReasoningLevel; label: string }[] = [
  { value: "none", label: "Aucun" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Faible" },
  { value: "medium", label: "Moyen" },
  { value: "high", label: "Élevé" },
  { value: "xhigh", label: "Très élevé" }
];

/** Libellés du dialogue « Recherche web » (le lien de la page affiche `webModeSummary`). */
export const WEB_MODES: readonly { value: WebSearchMode; label: string }[] = [
  { value: "open", label: "Sans restriction" },
  { value: "filtered", label: "Filtrer les sites" },
  { value: "disabled", label: "Désactivé" }
];

const WEB_MODE_SUMMARY: Record<WebSearchMode, string> = { open: "Sans restriction", filtered: "Sites filtrés", disabled: "Désactivé" };

export const CUSTOM_INSTRUCTIONS_MAX = 10000;

export type WebFilterType = "allowlist" | "blocklist";

export interface WebDomainSettings {
  filterType: WebFilterType;
  allowedDomains: string[];
  blockedDomains: string[];
}

export interface Personalization {
  gptReasoning: ReasoningLevel;
  /** Texte de l'utilisateur, sans la consigne de création de fichiers de FranceStudent. */
  customInstructions: string;
  /** La consigne de création de fichiers figurait dans les instructions du serveur. */
  fileInstructions: boolean;
  webSearchMode: WebSearchMode;
}

// Consigne que l'application ajoute aux instructions du compte pour que l'IA donne les fichiers sous forme de blocs de code.
// Même texte que `FILE_INSTR` dans mobile/www/js/stream.js (un test les compare) : le moteur historique la reconnaît à son marqueur.
export const FILE_INSTRUCTIONS_TAG = "[FranceStudent-fichiers]";
export const FILE_INSTRUCTIONS =
  FILE_INSTRUCTIONS_TAG +
  " Quand on te demande de créer un fichier (Python, PDF, texte, HTML, CSV...), donne son contenu complet dans un bloc de code avec le langage, et mets le nom du fichier (ex. script.py) en commentaire sur la première ligne du bloc. Pour un PDF, utilise un bloc de langage pdf contenant le texte du document ; l'application le convertit en PDF téléchargeable.";

const FILE_INSTRUCTIONS_SEPARATOR = "\n\n";

/**
 * Sépare le texte de l'utilisateur de la consigne de fichiers (toutes ses occurrences exactes, avec le saut de ligne qui les
 * précède). Un bloc modifié à la main n'est pas reconnu : il reste dans le texte, que l'utilisateur voit et peut changer.
 */
export function splitFileInstructions(text: string): { text: string; hasBlock: boolean } {
  let rest = text;
  let hasBlock = false;
  for (;;) {
    const at = rest.indexOf(FILE_INSTRUCTIONS);
    if (at < 0) break;
    hasBlock = true;
    let before = rest.slice(0, at);
    let after = rest.slice(at + FILE_INSTRUCTIONS.length);
    if (before.endsWith(FILE_INSTRUCTIONS_SEPARATOR)) before = before.slice(0, -FILE_INSTRUCTIONS_SEPARATOR.length);
    else if (before === "" && after.startsWith(FILE_INSTRUCTIONS_SEPARATOR)) after = after.slice(FILE_INSTRUCTIONS_SEPARATOR.length);
    rest = before + after;
  }
  return { text: rest, hasBlock };
}

/** Rattache la consigne de fichiers au texte, une seule fois (rien à ajouter si le marqueur est déjà dans le texte). */
export function joinFileInstructions(userText: string, hasBlock: boolean): string {
  if (!hasBlock || userText.includes(FILE_INSTRUCTIONS_TAG)) return userText;
  return (userText ? userText + FILE_INSTRUCTIONS_SEPARATOR : "") + FILE_INSTRUCTIONS;
}

export interface WebSettingsForm {
  mode: string;
  filterType: string;
  allowedText: string;
  blockedText: string;
  /** Listes lues sur le serveur ; `null` tant qu'elles n'ont pas pu être chargées. */
  loaded: WebDomainSettings | null;
}

/** `domains` : listes réellement enregistrées (même quand l'enregistrement du mode a échoué ensuite). */
export type WebSettingsResult =
  | { ok: true; mode: WebSearchMode; domains: WebDomainSettings | null }
  | { ok: false; message: string; domains: WebDomainSettings | null };

export function reasoningLevel(value: unknown): ReasoningLevel {
  return REASONING_LEVELS.find(level => level.value === value)?.value ?? "none";
}

export function webSearchMode(value: unknown): WebSearchMode {
  return WEB_MODES.find(mode => mode.value === value)?.value ?? "open";
}

export function webModeSummary(mode: unknown): string {
  return WEB_MODE_SUMMARY[webSearchMode(mode)];
}

/** Message d'erreur si le texte (consigne de fichiers comprise quand `withFiles`) dépasse la limite du serveur, sinon `null`. */
export function instructionsError(text: string, withFiles = false): string | null {
  if (joinFileInstructions(text, withFiles).length <= CUSTOM_INSTRUCTIONS_MAX) return null;
  if (withFiles) return "Les instructions sont trop longues (10 000 caractères maximum, y compris la consigne de création de fichiers).";
  return "Les instructions sont trop longues (10 000 caractères maximum).";
}

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Un domaine par ligne (ou séparés par espace, virgule, point-virgule) ; refuse tout ce qui n'est pas un nom de domaine. */
export function parseWebDomains(value: string): string[] {
  const domains = String(value)
    .split(/[\s,;]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(part) ? part : "https://" + part);
      } catch {
        throw new Error("Domaine invalide : " + part);
      }
      const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !HOSTNAME.test(hostname)) {
        throw new Error("Indique uniquement un domaine, par exemple wikipedia.org : " + part);
      }
      return hostname;
    });
  return [...new Set(domains)];
}

export function normalizeWebDomainSettings(raw: unknown): WebDomainSettings {
  const data = raw == null || raw === "" ? {} : raw;
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("Filtres du serveur illisibles.");
  const record = data as Record<string, unknown>;
  const list = (key: string): string[] => {
    const value = record[key];
    if (value == null) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("Liste de domaines invalide.");
    return value as string[];
  };
  return {
    filterType: record.filterType === "blocklist" ? "blocklist" : "allowlist",
    allowedDomains: list("allowedDomains"),
    blockedDomains: list("blockedDomains")
  };
}

export function parsePersonalization(raw: unknown): Personalization {
  if (!raw || typeof raw !== "object") throw new Error("Réponse du serveur illisible.");
  const data = raw as Record<string, unknown>;
  const instructions = splitFileInstructions(typeof data.customInstructions === "string" ? data.customInstructions : "");
  return {
    gptReasoning: reasoningLevel(data.gptReasoning),
    customInstructions: instructions.text,
    fileInstructions: instructions.hasBlock,
    webSearchMode: webSearchMode(data.webSearchMode)
  };
}

export interface GeneralSettingsService {
  loadPersonalization(signal?: AbortSignal): Promise<Personalization>;
  /** Rejette avec l'erreur du serveur ; les valeurs refusées localement ne déclenchent aucune requête. */
  savePersonalization(input: { gptReasoning: string; customInstructions: string; fileInstructions?: boolean }, signal?: AbortSignal): Promise<void>;
  loadWebDomains(signal?: AbortSignal): Promise<WebDomainSettings>;
  /** Ne rejette jamais : le résultat porte le message à afficher et les listes déjà enregistrées. */
  saveWebSettings(form: WebSettingsForm, signal?: AbortSignal): Promise<WebSettingsResult>;
}

export function createGeneralSettingsService(api: Pick<ApiClient, "json">): GeneralSettingsService {
  return {
    async loadPersonalization(signal) {
      return parsePersonalization(await api.json("/user/instructions", { signal }));
    },

    async savePersonalization(input, signal) {
      if (!REASONING_LEVELS.some(level => level.value === input.gptReasoning)) throw new Error("Niveau de réflexion invalide.");
      const withFiles = input.fileInstructions === true;
      const tooLong = instructionsError(input.customInstructions, withFiles);
      if (tooLong) throw new Error(tooLong);
      const customInstructions = joinFileInstructions(input.customInstructions, withFiles);
      await api.json("/user/instructions", { method: "PATCH", body: { gptReasoning: input.gptReasoning, customInstructions }, signal });
    },

    async loadWebDomains(signal) {
      return normalizeWebDomainSettings(await api.json("/user/web-search-domains", { signal }));
    },

    async saveWebSettings(form, signal) {
      const fail = (message: string, domains: WebDomainSettings | null = null): WebSettingsResult => ({ ok: false, message, domains });
      const mode = WEB_MODES.find(item => item.value === form.mode)?.value;
      if (!mode) return fail("Mode de recherche web invalide.");
      let domains: WebDomainSettings | null = null;
      if (mode === "filtered") {
        if (!form.loaded) return fail("Charge les listes avec Réessayer avant de modifier les filtres.");
        try {
          domains = {
            filterType: form.filterType === "blocklist" ? "blocklist" : "allowlist",
            allowedDomains: parseWebDomains(form.allowedText),
            blockedDomains: parseWebDomains(form.blockedText)
          };
          if (domains.filterType === "allowlist" && domains.allowedDomains.length === 0) throw new Error("Ajoute au moins un site autorisé.");
        } catch (error) {
          return fail(errorMessage(error));
        }
      }
      let saved: WebDomainSettings | null = null;
      try {
        if (domains) {
          await api.json("/user/web-search-domains", { method: "PUT", body: domains, signal });
          saved = domains;
        }
        await api.json("/user/instructions", { method: "PATCH", body: { webSearchMode: mode }, signal });
        return { ok: true, mode, domains: saved };
      } catch (error) {
        const prefix = saved ? "Listes enregistrées, mais le mode de recherche n’a pas pu être enregistré : " : "Enregistrement impossible : ";
        return fail(prefix + errorMessage(error), saved);
      }
    }
  };
}
