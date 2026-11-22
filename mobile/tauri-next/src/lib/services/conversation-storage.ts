import type { Conversation } from "../types/conversation.ts";
import { STORE_KEY, clearStoredConversations, hasStoredConversationFallback, readStoredConversations, setStoredConversations } from "../utils/state.ts";

// Équivalent TypeScript de `initializeConversationStorage` / `saveStore` (mobile/www/js/core.js) pour les discussions.
// Même base (`francestudent-conversations`, version 1), même object store (`state`), même clé (`conversations`) :
// ce qui est écrit ici est relu tel quel par l'ancienne interface, et inversement.

export const DB_NAME = "francestudent-conversations";
export const DB_VERSION = 1;
const STORE_NAME = "state";
const RECORD_KEY = "conversations";
const WARNING_INTERVAL_MS = 30_000;

export const MSG_STORAGE_UNAVAILABLE =
  "Le stockage local des discussions est temporairement indisponible.";
export const MSG_WRITE_FAILED = "La dernière modification des discussions n’a pas pu être enregistrée sur cet appareil.";
const MSG_QUOTA = "La limite du stockage local de l’application est atteinte. La dernière modification des discussions reste en attente.";

export interface ConversationStorageDeps {
  indexedDB: IDBFactory | undefined;
  localStorage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  reclaimSpace?: () => Promise<void>;
  /** Avertissement visible (toast) ; par défaut `console.error`. Déjà limité à un message toutes les 30 s. */
  warn?: (message: string) => void;
}

export interface LoadedConversations {
  conversations: Conversation[];
  /** Vrai si IndexedDB est ouvert pour les écritures ; faux = repli sur localStorage. */
  persistent: boolean;
}

export interface ConversationStorage {
  load(): Promise<LoadedConversations>;
  /** Enregistre un instantané des discussions ; les écritures sont sérialisées, la dernière gagne. */
  save(conversations: readonly Conversation[]): void;
  retry(): void;
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

function revision(row: Conversation): number {
  const pending = row?.pendingResponse as unknown as { startedAt?: unknown } | undefined;
  const started = typeof pending?.startedAt === "number" ? pending.startedAt : 0;
  return Math.max(row?.updatedAt || 0, started);
}

function reconcileFallback(saved: Conversation[], fallback: Conversation[]): Conversation[] {
  let merged = saved;
  const positions = new Map(saved.flatMap((row, index) => typeof row?.id === "string" ? [[row.id, index] as const] : []));
  for (const row of fallback) {
    if (typeof row?.id !== "string") continue;
    const index = positions.get(row.id);
    if (index !== undefined && revision(row) <= revision(merged[index])) continue;
    if (merged === saved) merged = saved.slice();
    if (index === undefined) {
      positions.set(row.id, merged.length);
      merged.push(row);
    } else merged[index] = row;
  }
  return merged;
}

export function createConversationStorage(deps: ConversationStorageDeps): ConversationStorage {
  const now = deps.now ?? Date.now;
  const warnUser = deps.warn ?? ((message: string) => console.error(message));
  let database: IDBDatabase | null = null;
  let pending: string | null = null;
  let failed: string | null = null;
  let writing: Promise<void> | null = null;
  let legacyCleanupPending = false;
  let lastWarningAt = -Infinity;

  function warn(message: string): void {
    if (now() - lastWarningAt < WARNING_INTERVAL_MS) return;
    lastWarningAt = now();
    warnUser(message);
  }

  function storageError(error: unknown): string {
    return (error as { name?: string } | null)?.name ?? "";
  }

  async function write(database: IDBDatabase, conversations: Conversation[]) {
    const put = () => runTransaction(database, "readwrite", store => store.put(conversations, RECORD_KEY));
    try { await put(); }
    catch (error) {
      if (storageError(error) !== "QuotaExceededError" || !deps.reclaimSpace) throw error;
      await deps.reclaimSpace().catch(() => {});
      await put();
    }
  }

  function clearLegacyCopy(): void {
    try {
      deps.localStorage.setItem(STORE_KEY, clearStoredConversations(deps.localStorage.getItem(STORE_KEY)));
      legacyCleanupPending = false;
    } catch {
      // La copie précédente ne doit disparaître que si la migration est confirmée.
    }
  }

  async function load(): Promise<LoadedConversations> {
    // Le JSON stocké n'est pas validé élément par élément (comme dans l'ancienne interface) : le type est posé à la lecture.
    const raw = deps.localStorage.getItem(STORE_KEY);
    const legacy = readStoredConversations<Conversation>(raw);
    let conversations = legacy;
    let loadedDatabase = false;
    try {
      if (!deps.indexedDB) throw new Error("IndexedDB absent");
      database = await openDatabase(deps.indexedDB);
      const saved: unknown = await runTransaction(database, "readonly", store => store.get(RECORD_KEY));
      loadedDatabase = true;
      if (Array.isArray(saved)) {
        // Une copie d’avant la migration peut contenir des discussions supprimées depuis dans IndexedDB.
        conversations = hasStoredConversationFallback(raw) ? reconcileFallback(saved, legacy) : saved;
      }
      if (conversations !== saved) {
        await write(database, conversations);
      }
      clearLegacyCopy();
      return { conversations, persistent: true };
    } catch (error) {
      if (loadedDatabase) {
        legacyCleanupPending = true;
        failed = JSON.stringify(conversations);
        if (storageError(error) !== "AbortError") warn(storageError(error) === "QuotaExceededError" ? MSG_QUOTA : MSG_WRITE_FAILED);
        return { conversations, persistent: true };
      }
      database?.close();
      database = null;
      warn(MSG_STORAGE_UNAVAILABLE);
      return { conversations, persistent: false };
    }
  }

  function save(conversations: readonly Conversation[]): void {
    if (!database) {
      // Repli : écriture synchrone dans localStorage, comme l'ancienne interface sans IndexedDB.
      try {
        deps.localStorage.setItem(STORE_KEY, setStoredConversations(deps.localStorage.getItem(STORE_KEY), conversations, true));
        failed = null;
      } catch (error) {
        failed = JSON.stringify(conversations);
        warn(storageError(error) === "QuotaExceededError" ? MSG_QUOTA : MSG_WRITE_FAILED);
      }
      return;
    }
    // Instantané pris maintenant : une écriture asynchrone ne peut ni réordonner ni voir des modifications ultérieures.
    pending = JSON.stringify(conversations);
    failed = null;
    drain(database);
  }

  function drain(db: IDBDatabase): void {
    if (writing) return;
    writing = (async () => {
      while (pending !== null) {
        const next = pending;
        pending = null;
        try {
          await write(db, JSON.parse(next) as Conversation[]);
          if (legacyCleanupPending) clearLegacyCopy();
        } catch (error) {
          if (pending === null) failed = next;
          if (storageError(error) !== "AbortError") warn(storageError(error) === "QuotaExceededError" ? MSG_QUOTA : MSG_WRITE_FAILED);
        }
      }
    })().finally(() => {
      writing = null;
    });
  }

  function retry(): void {
    if (failed === null || pending !== null) return;
    const snapshot = failed;
    failed = null;
    if (database) {
      pending = snapshot;
      drain(database);
    } else save(JSON.parse(snapshot) as Conversation[]);
  }

  async function flush(): Promise<void> {
    while (writing) await writing;
  }

  function close(): void {
    database?.close();
    database = null;
  }

  return { load, save, retry, flush, close };
}
