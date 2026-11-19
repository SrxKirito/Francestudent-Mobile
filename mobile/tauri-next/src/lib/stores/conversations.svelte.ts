import type { ConversationStorage } from "../services/conversation-storage.ts";
import type { Conversation } from "../types/conversation.ts";
import { groupHistory, sameConversations, visibleConversations } from "../utils/history.ts";
import type { HistoryGroup } from "../utils/history.ts";

/**
 * Recherche déléguée : renvoie les identifiants des discussions qui correspondent à la saisie, ou `null` pour appliquer
 * la règle locale (titre + messages présents dans la liste).
 */
export type ConversationSearch = (query: string) => ReadonlySet<string> | null;

/**
 * Discussions affichées par l'historique. LECTURE SEULE : tant que l'ancienne interface (iframe) reste le moteur du chat,
 * elle est seule à écrire dans IndexedDB ; écrire aussi d'ici ferait s'écraser deux copies. Deux sources possibles :
 * le stockage (`load()`) ou le moteur historique (`replace()`, discussions sans messages + `search`).
 * Les actions (renommer, épingler, supprimer, ouvrir) arrivent avec les messages et l'envoi.
 */
export class ConversationsStore {
  // Les discussions ne sont jamais modifiées sur place : seule leur référence change.
  items = $state.raw<Conversation[]>([]);
  query = $state("");
  /** Projet affiché ; `null` = discussions hors projet. */
  projectId = $state<string | null>(null);
  currentId = $state<string | null>(null);
  menuId = $state<string | null>(null);
  loaded = $state(false);
  /** Faux si IndexedDB est indisponible (discussions lues dans localStorage). */
  persistent = $state(false);

  readonly visible = $derived.by(() => {
    const ids = this.#search && this.query.trim() ? this.#search(this.query) : null;
    return visibleConversations(this.items, {
      projectId: this.projectId,
      query: this.query,
      matcher: ids ? conversation => ids.has(conversation.id) : undefined
    });
  });

  readonly #storage: ConversationStorage | null;
  readonly #search: ConversationSearch | null;

  constructor(storage: ConversationStorage | null = null, search: ConversationSearch | null = null) {
    this.#storage = storage;
    this.#search = search;
  }

  async load(): Promise<void> {
    if (!this.#storage) throw new Error("Aucun stockage de discussions n'est relié à ce magasin");
    const result = await this.#storage.load();
    this.items = result.conversations;
    this.persistent = result.persistent;
    this.loaded = true;
  }

  /** Remplace la liste (copie fournie par le moteur historique). Sans effet si rien n'a changé à l'affichage. */
  replace(conversations: Conversation[]): void {
    if (!sameConversations(this.items, conversations)) this.items = conversations;
    this.loaded = true;
  }

  groups(now: number): HistoryGroup[] {
    return groupHistory(this.visible, now);
  }
}
