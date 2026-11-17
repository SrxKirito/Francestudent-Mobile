/** Non-overwriting adapter for the Tauri copy of the existing storage schema. */
const STATE_KEY = "fs-chat-state";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function stateFrom(storage) {
  const raw = storage.getItem(STATE_KEY);
  if (!raw) return {};
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error("L'état local actuel est illisible ; aucune donnée n'a été écrasée."); }
  if (!state || Array.isArray(state) || typeof state !== "object") throw new Error("L'état local actuel est invalide.");
  return state;
}
function get(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error("Lecture locale impossible."));
  });
}
async function sameBlob(a, b) {
  if (!(a instanceof Blob) || !(b instanceof Blob) || a.size !== b.size || a.type !== b.type) return false;
  const aFile = typeof File !== "undefined" && a instanceof File;
  const bFile = typeof File !== "undefined" && b instanceof File;
  if (aFile !== bFile || (aFile && (a.name !== b.name || a.lastModified !== b.lastModified))) return false;
  for (let offset = 0; offset < a.size; offset += 64 * 1024) {
    const first = new Uint8Array(await a.slice(offset, offset + 64 * 1024).arrayBuffer());
    const second = new Uint8Array(await b.slice(offset, offset + 64 * 1024).arrayBuffer());
    if (first.some((value, index) => value !== second[index])) return false;
  }
  return true;
}

function insertRow(db, store, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const objectStore = tx.objectStore(store);
    const request = objectStore.get(key);
    let inserted = false;
    request.onsuccess = () => {
      if (request.result !== undefined) return;
      objectStore.put(value);
      inserted = true;
    };
    tx.oncomplete = () => resolve(inserted ? "inserted" : "conflict");
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error("Écriture locale impossible."));
  });
}

function insertConversation(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    const store = tx.objectStore("state");
    const request = store.get("conversations");
    let inserted = false;
    let invalid = false;
    request.onsuccess = () => {
      const list = request.result === undefined ? [] : request.result;
      if (!Array.isArray(list)) { invalid = true; tx.abort(); return; }
      if (list.some(item => item?.id === record.key)) return;
      const value = record.value && typeof record.value === "object" && !Array.isArray(record.value)
        ? { ...record.value, id: record.value.id || record.key } : null;
      if (!value) { invalid = true; tx.abort(); return; }
      store.put([...list, value], "conversations");
      inserted = true;
    };
    tx.oncomplete = () => resolve(inserted ? "inserted" : "conflict");
    tx.onabort = tx.onerror = () => reject(invalid ? new Error("Discussions locales invalides.") : tx.error || request.error || new Error("Écriture locale impossible."));
  });
}

function validateState(record) {
  const state = record.value?.rawState;
  const session = record.value?.secureSession;
  if (!state || typeof state !== "object" || Array.isArray(state) || Object.hasOwn(state, "session") || Object.hasOwn(state, "conversations") || (session !== null && session !== undefined && typeof session !== "string")) throw new Error("État de sauvegarde invalide.");
  return { state, session: session || null };
}

/**
 * `vault` exposes async read() / write(secret); call only while app writes are
 * paused. Conflicting values are never overwritten and require user review.
 */
export function createTauriDestination({ storage, conversationDb, previewDb, vault }) {
  if (!storage || !conversationDb || !previewDb || !vault) throw new Error("Stockage de destination indisponible.");
  async function inspect(record) {
    if (record.kind === "state") {
      const { state, session } = validateState(record);
      const existing = stateFrom(storage);
      for (const [key, value] of Object.entries(state)) if (Object.hasOwn(existing, key) && !same(existing[key], value)) return "conflict";
      const secure = await vault.read();
      const plain = typeof existing.session === "string" && existing.session ? existing.session : null;
      if ((secure && plain && secure !== plain) || (session && ((secure && secure !== session) || (plain && plain !== session)))) return "conflict";
      const missing = Object.keys(state).some(key => !Object.hasOwn(existing, key)) || (session && !secure);
      return missing ? "missing" : "same";
    }
    if (record.kind === "conversation") {
      const rows = await get(conversationDb, "state", "conversations");
      if (rows !== undefined && !Array.isArray(rows)) throw new Error("Discussions locales invalides.");
      const existing = (rows || []).find(value => value?.id === record.key);
      if (!existing) return "missing";
      const expected = record.value && typeof record.value === "object" ? { ...record.value, id: record.value.id || record.key } : record.value;
      return same(existing, expected) ? "same" : "conflict";
    }
    if (record.kind === "file") {
      const existing = await get(previewDb, "files", record.key);
      if (existing === undefined) return "missing";
      const { blob, ...metadata } = existing;
      return same(metadata, record.value) && await sameBlob(blob, record.blob) ? "same" : "conflict";
    }
    if (record.kind === "library") {
      const existing = await get(previewDb, "library", record.key);
      return existing === undefined ? "missing" : same(existing, record.value) ? "same" : "conflict";
    }
    throw new Error("Type de données non pris en charge.");
  }
  async function insertIfMissing(record) {
    const status = await inspect(record);
    if (status === "same") return "same";
    if (status === "conflict") return "conflict";
    if (record.kind === "state") {
      const { state, session } = validateState(record);
      if (session && !(await vault.read())) {
        await vault.write(session);
        if (await vault.read() !== session) throw new Error("Enregistrement sécurisé de la session non confirmé.");
      }
      // Recheck after async vault operations; never overwrite a concurrent edit.
      const existing = stateFrom(storage);
      for (const [key, value] of Object.entries(state)) if (Object.hasOwn(existing, key) && !same(existing[key], value)) return "conflict";
      storage.setItem(STATE_KEY, JSON.stringify({ ...state, ...existing }));
      return "inserted";
    }
    if (record.kind === "conversation") return insertConversation(conversationDb, record);
    if (record.kind === "file") return insertRow(previewDb, "files", record.key, { ...record.value, blob: record.blob });
    return insertRow(previewDb, "library", record.key, record.value);
  }
  return { inspect, insertIfMissing };
}
