import type { Conversation } from "../types/conversation.ts";

// Règles de l'historique reprises de `renderHistory()` (mobile/www/js/conversations.js) :
// filtre par projet, recherche locale, tri (épinglées d'abord, puis les plus récentes), groupes datés.

export const GROUP_PINNED = "Épinglées";
export const GROUP_TODAY = "Aujourd'hui";
export const GROUP_YESTERDAY = "Hier";
export const GROUP_WEEK = "7 derniers jours";
export const GROUP_MONTH = "30 derniers jours";
export const GROUP_OLDER = "Plus ancien";
export const UNTITLED = "Sans titre";
export const NO_RESULT = "Aucune conversation trouvée.";

const DAY_MS = 86_400_000;

/** `query` doit déjà être en minuscules et sans espaces autour (comme `historyQuery.trim().toLowerCase()`). */
export function conversationMatches(conversation: Conversation, query: string): boolean {
  if (!query) return true;
  const parts = [conversation.title || ""];
  for (const message of conversation.messages || []) parts.push(String(message.content || ""));
  return parts.join("\n").toLowerCase().includes(query);
}

/** Les jours « calendaires » suivent le fuseau local de l'appareil, comme dans l'ancienne interface. */
export function historyGroup(conversation: Conversation, now: number): string {
  if (conversation.pinned) return GROUP_PINNED;
  const updated = conversation.updatedAt || 0;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (updated >= today.getTime()) return GROUP_TODAY;
  if (updated >= today.getTime() - DAY_MS) return GROUP_YESTERDAY;
  if (now - updated < 7 * DAY_MS) return GROUP_WEEK;
  if (now - updated < 30 * DAY_MS) return GROUP_MONTH;
  return GROUP_OLDER;
}

export interface HistoryFilter {
  /** Projet affiché ; `null` = discussions hors projet. */
  projectId: string | null;
  /** Texte saisi dans la recherche, brut. */
  query: string;
}

/** Discussions visibles pour un projet et une recherche, dans l'ordre d'affichage. N'altère pas la liste d'entrée. */
export function visibleConversations(conversations: readonly Conversation[], filter: HistoryFilter): Conversation[] {
  const query = filter.query.trim().toLowerCase();
  return conversations
    .filter(conversation => (conversation.projectId || null) === filter.projectId)
    .filter(conversation => conversationMatches(conversation, query))
    .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

export interface HistoryGroup {
  label: string;
  items: Conversation[];
}

/** Regroupe une liste déjà triée : une nouvelle étiquette apparaît à chaque changement de groupe. */
export function groupHistory(sorted: readonly Conversation[], now: number): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const conversation of sorted) {
    const label = historyGroup(conversation, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(conversation);
    else groups.push({ label, items: [conversation] });
  }
  return groups;
}

export function conversationTitle(conversation: Conversation): string {
  return conversation.title || UNTITLED;
}
