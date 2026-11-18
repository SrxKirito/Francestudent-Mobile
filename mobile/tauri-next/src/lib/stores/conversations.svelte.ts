import type { ConversationStorage } from "../services/conversation-storage.ts";
import type { Conversation } from "../types/conversation.ts";
import { groupHistory, visibleConversations } from "../utils/history.ts";
import type { HistoryGroup } from "../utils/history.ts";

/**
 * Discussions affichées par l'historique. LECTURE SEULE pour l'instant : tant que l'ancienne interface (iframe)
 * reste le moteur du chat, elle est seule à écrire dans IndexedDB ; écrire aussi d'ici ferait s'écraser deux copies.
 * Les actions (renommer, épingler, supprimer, ouvrir) arrivent avec les messages et l'envoi.
 */
export class ConversationsStore {
  items = $state<Conversation[]>([]);
  query = $state("");
  /** Projet affiché ; `null` = discussions hors projet. */
  projectId = $state<string | null>(null);
  currentId = $state<string | null>(null);
  menuId = $state<string | null>(null);
  loaded = $state(false);
  /** Faux si IndexedDB est indisponible (discussions lues dans localStorage). */
  persistent = $state(false);

  readonly visible = $derived(visibleConversations(this.items, { projectId: this.projectId, query: this.query }));

  readonly #storage: ConversationStorage;

  constructor(storage: ConversationStorage) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    const result = await this.#storage.load();
    this.items = result.conversations;
    this.persistent = result.persistent;
    this.loaded = true;
  }

  groups(now: number): HistoryGroup[] {
    return groupHistory(this.visible, now);
  }
}
