const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const CACHE_BYTES = 24 * 1024 * 1024;
const CACHE_ENTRIES = 48;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const STORE = "images";

interface CachedImage {
  key: string;
  created: number;
  blob: Blob;
}

export function createRemoteImageCache(indexedDB: IDBFactory | undefined) {
  let database: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;
  let closed = false;
  let writesPaused = false;

  async function open(): Promise<IDBDatabase> {
    if (closed || !indexedDB) throw new Error("Cache d’images indisponible.");
    if (database) return database;
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("francestudent-remote-previews", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("created", "created");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (closed) {
          db.close();
          reject(new Error("Cache d’images fermé."));
          return;
        }
        db.onversionchange = () => {
          db.close();
          if (database === db) database = undefined;
        };
        database = db;
        resolve(db);
      };
    });
    try { return await opening; }
    finally { opening = undefined; }
  }

  async function transaction<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, result: (value: T) => void) => void
  ): Promise<T | undefined> {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      let value: T | undefined;
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      work(tx.objectStore(STORE), next => { value = next; });
    });
  }

  return {
    read(key: string): Promise<Blob | undefined> {
      return transaction<Blob>("readonly", (store, result) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const row = request.result as CachedImage | undefined;
          if (row && Date.now() - row.created < MAX_AGE) result(row.blob);
        };
      }).catch(() => undefined);
    },
    async write(key: string, blob: Blob): Promise<void> {
      if (writesPaused || !blob.size || blob.size > MAX_IMAGE_BYTES) return;
      const created = Date.now();
      await transaction("readwrite", store => {
        if (writesPaused) return;
        store.put({ key, blob, created } satisfies CachedImage);
        const request = store.index("created").openCursor(null, "prev");
        let bytes = blob.size;
        let count = 1;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const row = cursor.value as CachedImage;
          if (row.key === key) {
            cursor.continue();
            return;
          }
          if (created - row.created >= MAX_AGE || count >= CACHE_ENTRIES || bytes + row.blob.size > CACHE_BYTES) {
            cursor.delete();
          } else {
            bytes += row.blob.size;
            count += 1;
          }
          cursor.continue();
        };
      }).catch(() => {});
    },
    async remove(key: string): Promise<void> {
      await transaction("readwrite", store => { store.delete(key); }).catch(() => {});
    },
    async releaseSpace(): Promise<void> {
      writesPaused = true;
      await transaction("readwrite", store => { store.clear(); }).catch(() => {});
    },
    close(): void {
      closed = true;
      database?.close();
      database = undefined;
    }
  };
}
