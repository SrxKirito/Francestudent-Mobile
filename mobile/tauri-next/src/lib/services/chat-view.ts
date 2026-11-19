// Présentation du chat : fonctions pures (aucun DOM, aucune rune). Reprend les règles d'affichage de l'ancienne
// interface (assistant.js : sourceLabel, sourceIcon, sourcesHtml ; app.js : titres des bascules).
import type { ChatSource, ComposerAttachment, StudyMode } from "../types/chat.ts";
import type { LiveState } from "./chat-live.ts";

/** Nom court d'un site à partir de son hôte (même règle que sourceLabel du legacy). */
export function sourceLabel(host: string | null | undefined): string {
  const raw = String(host || "");
  const parts = raw.split(".");
  if (parts.length < 2) return raw;
  let i = parts.length - 2;
  if (parts.length >= 3 && parts[i].length <= 3) i -= 1;
  return parts[i] || raw;
}

export function sourceLetter(host: string | null | undefined): string {
  return (sourceLabel(host)[0] || "?").toUpperCase();
}

export function faviconUrl(host: string): string {
  return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64";
}

export function sourcesSummary(count: number, searching: boolean): string {
  if (searching) return "Recherche sur le web… · " + count + (count > 1 ? " sites" : " site");
  return count + (count > 1 ? " sites consultés" : " site consulté");
}

export interface SourcesLayout {
  all: ChatSource[];
  collapsed: boolean;
  /** Cartes affichées d'emblée (toutes si ≤ 4, sinon les 3 premières). */
  visible: ChatSource[];
  hiddenCount: number;
  moreLabel: string;
  /** Icônes de la carte « N autres sources » (sources 4 à 7). */
  moreIcons: ChatSource[];
  /** Icônes de la pilule (4 premières sources). */
  pillIcons: ChatSource[];
}

export function layoutSources(sources: ChatSource[] | null | undefined): SourcesLayout {
  const all = Array.isArray(sources) ? sources : [];
  const collapsed = all.length > 4;
  const hiddenCount = collapsed ? all.length - 3 : 0;
  return {
    all,
    collapsed,
    visible: collapsed ? all.slice(0, 3) : all,
    hiddenCount,
    moreLabel: hiddenCount + " autres sources",
    moreIcons: all.slice(3, 7),
    pillIcons: all.slice(0, 4)
  };
}

export type AttachmentIcon = "image" | "file" | "text";

export function attachmentIcon(kind: string): AttachmentIcon {
  return kind === "image" || kind === "text" ? kind : "file";
}

const STUDY_LABELS: Record<string, string> = { fiches: "Fiches", quiz: "Quiz", cartes: "Cartes mémoire" };

export function studyLabel(mode: StudyMode | string): string {
  return Object.prototype.hasOwnProperty.call(STUDY_LABELS, mode) ? "Étudiant : " + STUDY_LABELS[mode] : "Étudiant";
}

export function webSearchTitle(on: boolean, mode: string): string {
  if (mode === "disabled") return "Recherche web désactivée dans Paramètres > Général";
  return on ? "Désactiver la recherche web" : "Activer la recherche web";
}

export function imageTitle(on: boolean): string {
  return on ? "Désactiver la génération d'image" : "Activer la génération d'image";
}

export type LiveIndicator = "none" | "typing" | "search" | "image";

/** Indicateur à afficher dans la bulle de la réponse en cours (rien dès que du texte arrive). */
export function liveStatus(live: LiveState): LiveIndicator {
  if (!live.active) return "none";
  if (live.searching) return "search";
  if (live.text) return "none";
  return live.imageStarted ? "image" : "typing";
}

/**
 * La bulle « en direct » n'existe que pendant la génération, et seulement tant que la réponse n'est pas déjà
 * enregistrée dans la conversation (sinon elle s'afficherait deux fois).
 */
export function liveVisible(state: { busy: boolean; messages: { role: string }[] }, live: LiveState): boolean {
  if (!state.busy || !live.active) return false;
  return state.messages[state.messages.length - 1]?.role !== "assistant";
}

export function canSend(text: string, attachmentCount: number, busy: boolean): boolean {
  if (busy) return false;
  return text.trim().length > 0 || attachmentCount > 0;
}

/** Vrai tant qu'une pièce jointe n'est pas totalement téléversée (en attente, en cours ou en échec) : l'envoi est alors refusé. */
export function uploadsPending(attachments: readonly ComposerAttachment[]): boolean {
  return attachments.some(file => file.upload !== undefined);
}

/** Texte d'état d'une puce, comme l'ancienne interface (vide quand le fichier est prêt). */
export function uploadLabel(file: ComposerAttachment): string {
  if (file.upload === "queued") return "En attente d’envoi";
  if (file.upload === "uploading") {
    const ratio = typeof file.progress === "number" && Number.isFinite(file.progress) ? Math.min(1, Math.max(0, file.progress)) : 0;
    return "Envoi " + Math.round(ratio * 100) + " %";
  }
  if (file.upload === "error") return "Échec";
  return "";
}
