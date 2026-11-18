import type { Conversation } from "../types/conversation.ts";
import { STORE_KEY, clearStoredConversations, readStoredConversations, setStoredConversations } from "../utils/state.ts";

// Équivalent TypeScript de `initializeConversationStorage` / `saveStore` (mobile/www/js/core.js) pour les discussions.
// Même base (`francestudent-conversations`, version 1), même object store (`state`), même clé (`conversations`) :
// ce qui est écrit ici est relu tel quel par l'ancienne interface, et inversement.

export const DB_NAME = "francestudent-conversations";
export const DB_VERSION = 1;
const STORE_NAME = "state";
const RECORD_KEY = "conversations";
const WARNING_INTERVAL_MS = 30_000;

export const MSG_STORAGE_UNAVAILABLE =
  "Stockage des discussions indisponible. Les données existantes sont conservées ; vérifie l’espace disponible sur le téléphone.";
export const MSG_WRITE_FAILED = "Impossible d’enregistrer les discussions. Vérifie le stockage disponible sur le téléphone.";
export const MSG_SETTINGS_FAILED = "Impossible d’enregistrer les réglages sur ce téléphone. Vérifie le stockage disponible.";

export interface ConversationStorageDeps {
  indexedDB: IDBFactory | undefined;
  localStorage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  /** Avertissement visible (toast) ; par défaut `console.error`. Déjà limité à un message toutes les 30 s. */
  warn?: (message: string) => void;
}

export interface LoadedConversations {
  conversations: Conversation[];
  /** Vrai si les discussions vivent dans IndexedDB ; faux = repli sur localStorage (base indisponible). */
  persistent: boolean;
}

export interface ConversationStorage {
  load(): Promise<LoadedConversations>;
  /** Enregistre un instantané des discussions ; les écritures sont sérialisées, la dernière gagne. */
  save(conversations: readonly Conversation[]): void;
  /** Résout quand toutes les écritures demandées jusque-là sont terminées. */
  flush(): Promise<void>;
  close(): void;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Stockage indisponible"));
    request.onblocked = () => reject(new Error("Stockage bloqué par une autre fenêtre"));
  });
}

function runTransaction<T>(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const request = operation(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error("Enregistrement interrompu"));
  });
}

export function createConversationStorage(deps: ConversationStorageDeps): ConversationStorage {
  const now = deps.now ?? Date.now;
  const warnUser = deps.warn ?? ((message: string) => console.error(message));
  let database: IDBDatabase | null = null;
  let pending: string | null = null;
  let writing: Promise<void> | null = null;
  let lastWarningAt = -Infinity;

  function warn(message: string): void {
    if (now() - lastWarningAt < WARNING_INTERVAL_MS) return;
    lastWarningAt = now();
    warnUser(message);
  }

  async function load(): Promise<LoadedConversations> {
    // Le JSON stocké n'est pas validé élément par élément (comme dans l'ancienne interface) : le type est posé à la lecture.
    const legacy = readStoredConversations(deps.localStorage.getItem(STORE_KEY)) as Conversation[];
    try {
      if (!deps.indexedDB) throw new Error("IndexedDB absent");
      database = await openDatabase(deps.indexedDB);
      const saved: unknown = await runTransaction(database, "readonly", store => store.get(RECORD_KEY));
      let conversations: Conversation[];
      if (Array.isArray(saved)) {
        conversations = saved as Conversation[];
      } else {
        // Première ouverture : on copie d'abord les discussions de localStorage dans IndexedDB.
        await runTransaction(database, "readwrite", store => store.put(legacy, RECORD_KEY));
        conversations = legacy;
      }
      try {
        // La copie de localStorage n'est vidée qu'une fois la transaction validée.
        deps.localStorage.setItem(STORE_KEY, clearStoredConversations(deps.localStorage.getItem(STORE_KEY)));
      } catch {
        // Les discussions sont déjà en sûreté dans IndexedDB, qui prime à la relecture : la copie restante est inoffensive.
      }
      return { conversations, persistent: true };
    } catch {
      database?.close();
      database = null;
      warn(MSG_STORAGE_UNAVAILABLE);
      return { conversations: legacy, persistent: false };
    }
  }

  function save(conversations: readonly Conversation[]): void {
    if (!database) {
      // Repli : écriture synchrone dans localStorage, comme l'ancienne interface sans IndexedDB.
      try {
        deps.localStorage.setItem(STORE_KEY, setStoredConversations(deps.localStorage.getItem(STORE_KEY), conversations));
      } catch {
        warn(MSG_SETTINGS_FAILED);
      }
      return;
    }
    // Instantané pris maintenant : une écriture asynchrone ne peut ni réordonner ni voir des modifications ultérieures.
    pending = JSON.stringify(conversations);
    if (writing) return;
    const db = database;
    writing = (async () => {
      while (pending !== null) {
        const next = JSON.parse(pending) as Conversation[];
        pending = null;
        try {
          await runTransaction(db, "readwrite", store => store.put(next, RECORD_KEY));
        } catch {
          warn(MSG_WRITE_FAILED);
        }
      }
    })().finally(() => {
      writing = null;
    });
  }

  async function flush(): Promise<void> {
    while (writing) await writing;
  }

  function close(): void {
    database?.close();
    database = null;
  }

  return { load, save, flush, close };
}
