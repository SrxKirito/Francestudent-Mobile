import type { LibraryRecord } from "./workspace-engine.ts";

const DB_NAME = "francestudent-previews";
const DB_VERSION = 2;
const PREVIEW_BUDGET = 200 * 1024 * 1024;

export interface PreviewEntry {
  id: string;
  blob: Blob;
  name: string;
  size: number;
  created: number;
  saved?: boolean;
}

export interface StoredAttachment {
  id?: string;
  name?: string;
  mime?: string;
  kind?: string;
  data?: string;
  size?: number;
  previewId?: string | null;
  remoteId?: string;
  remoteKind?: string;
}

export interface LibraryEntry extends LibraryRecord {
  owner: string;
  previewId?: string | null;
  code?: string;
  lang?: string;
  file?: StoredAttachment;
  image?: unknown;
}

export interface PreviewStorage {
  remember(file: File): Promise<string | null>;
  readPreview(id: string): Promise<PreviewEntry | undefined>;
  readLibrary(owner: string): Promise<LibraryEntry[]>;
  libraryEntry(id: string, owner: string): Promise<LibraryEntry | undefined>;
  index(entries: readonly LibraryEntry[]): Promise<void>;
  classify(id: string, owner: string, projectId: string): Promise<void>;
  close(): void;
}

type PreviewStoreName = "library" | "files";

function operation<T>(
  database: IDBDatabase,
  names: PreviewStoreName | PreviewStoreName[],
  mode: IDBTransactionMode,
  begin: (tx: IDBTransaction, result: (value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(names, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? new Error("Écriture interrompue."));
    tx.onerror = () => reject(tx.error ?? new Error("Stockage des fichiers indisponible."));
    try {
      begin(tx, result => { value = result; });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

function putPreview(tx: IDBTransaction, entry: PreviewEntry): void {
  const files = tx.objectStore("files");
  files.put(entry);
  const scan = files.openCursor();
  let total = 0;
  const removable: { id: string; size: number; created: number }[] = [];
  scan.onsuccess = () => {
    const cursor = scan.result;
    if (cursor) {
      const row = cursor.value as PreviewEntry;
      const size = typeof row.size === "number" && Number.isFinite(row.size) ? row.size : row.blob?.size ?? 0;
      total += size;
      if (row.id !== entry.id && !row.saved) removable.push({ id: row.id, size, created: row.created || 0 });
      cursor.continue();
      return;
    }
    // Même plafond que la bibliothèque historique. Les fichiers enregistrés ne sont pas évincés.
    for (const row of removable.sort((a, b) => a.created - b.created)) {
      if (total <= PREVIEW_BUDGET) break;
      files.delete(row.id);
      total -= row.size;
    }
  };
}

function putNewLibraryEntry(tx: IDBTransaction, row: LibraryEntry): void {
  const library = tx.objectStore("library");
  const request = library.getKey(row.id);
  request.onsuccess = () => {
    // Préserve les classements, formats et aperçus enrichis par l’ancienne application.
    if (request.result !== undefined) return;
    library.put(row);
    if (!row.previewId) return;
    const files = tx.objectStore("files");
    const preview = files.get(row.previewId);
    preview.onsuccess = () => {
      if (preview.result && !preview.result.saved) files.put({ ...preview.result, saved: true });
    };
  };
}

export function createPreviewStorage(factory: IDBFactory | undefined): PreviewStorage {
  let database: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;
  let disposed = false;

  async function open(): Promise<IDBDatabase> {
    if (disposed) throw new Error("Stockage des fichiers fermé.");
    if (database) return database;
    if (!factory) throw new Error("Stockage des fichiers indisponible.");
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("library")) request.result.createObjectStore("library", { keyPath: "id" });
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Le stockage des fichiers est ouvert dans une autre fenêtre."));
      };
      request.onerror = () => reject(request.error ?? new Error("Stockage des fichiers indisponible."));
      request.onsuccess = () => {
        const opened = request.result;
        if (disposed || blocked) {
          opened.close();
          reject(new Error("Stockage des fichiers indisponible."));
          return;
        }
        database = opened;
        opened.onversionchange = () => {
          opened.close();
          if (database === opened) database = undefined;
        };
        resolve(opened);
      };
    });
    opening = attempt;
    try {
      return await attempt;
    } finally {
      if (opening === attempt) opening = undefined;
    }
  }

  return {
    async remember(file) {
      if (file.size > PREVIEW_BUDGET) return null;
      const id = crypto.randomUUID();
      try {
        await operation<void>(await open(), "files", "readwrite", tx => {
          putPreview(tx, { id, blob: file, name: file.name, size: file.size, created: Date.now() });
        });
        return id;
      } catch {
        return null; // Le transfert peut continuer même si la copie d’aperçu est indisponible.
      }
    },
    async readPreview(id) {
      return operation<PreviewEntry | undefined>(await open(), "files", "readonly", (tx, result) => {
        const request = tx.objectStore("files").get(id);
        request.onsuccess = () => result(request.result?.blob instanceof Blob ? request.result : undefined);
      });
    },
    async readLibrary(owner) {
      if (!owner) return [];
      return operation<LibraryEntry[]>(await open(), "library", "readonly", (tx, result) => {
        const rows: LibraryEntry[] = [];
        const scan = tx.objectStore("library").openCursor();
        scan.onsuccess = () => {
          const cursor = scan.result;
          if (!cursor) { result(rows); return; }
          const row = cursor.value as LibraryEntry | undefined;
          if (row?.owner === owner && typeof row.id === "string" && typeof row.name === "string") rows.push(row);
          cursor.continue();
        };
      });
    },
    async libraryEntry(id, owner) {
      if (!owner) return undefined;
      return operation<LibraryEntry | undefined>(await open(), "library", "readonly", (tx, result) => {
        const request = tx.objectStore("library").get(id);
        request.onsuccess = () => result(request.result?.owner === owner ? request.result : undefined);
      });
    },
    async index(entries) {
      if (!entries.length) return;
      const db = await open();
      // Évite un nombre démesuré de requêtes simultanées sur un historique importé.
      for (let offset = 0; offset < entries.length; offset += 100) {
        if (disposed) return;
        await operation<void>(db, ["library", "files"], "readwrite", tx => {
          for (const row of entries.slice(offset, offset + 100)) putNewLibraryEntry(tx, row);
        });
      }
    },
    async classify(id, owner, projectId) {
      const updated = await operation<boolean>(await open(), "library", "readwrite", (tx, result) => {
        const library = tx.objectStore("library");
        const request = library.get(id);
        request.onsuccess = () => {
          const row = request.result;
          if (!owner || row?.owner !== owner) { result(false); return; }
          library.put({ ...row, projectId });
          result(true);
        };
      });
      if (!updated) throw new Error("Fichier local indisponible.");
    },
    close() {
      disposed = true;
      database?.close();
      database = undefined;
    }
  };
}
