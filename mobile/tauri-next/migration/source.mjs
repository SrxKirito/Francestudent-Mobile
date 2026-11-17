/**
 * Reads the actual legacy stores, one cursor item at a time. The caller must
 * pause app writes and await any outstanding conversation transaction first.
 */
function nextRow(db, storeName, after) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const range = after === null ? null : IDBKeyRange.lowerBound(after, true);
    const request = tx.objectStore(storeName).openCursor(range);
    let row = null;
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) row = { key: cursor.key, value: cursor.value };
    };
    tx.oncomplete = () => resolve(row);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error("Lecture locale interrompue."));
  });
}

async function* rows(db, storeName) {
  if (!db || !db.objectStoreNames.contains(storeName)) return;
  let after = null;
  for (;;) {
    const row = await nextRow(db, storeName, after);
    if (!row) return;
    if (typeof row.key !== "string" || !row.key) throw new Error("Identifiant local non pris en charge ; les données sont conservées.");
    after = row.key;
    yield row;
  }
}

/**
 * `rawState` is the unmodified fs-chat-state string. `conversations` is the
 * currently loaded durable array after `conversationWrite` has completed.
 * `session` may be supplied from a secure vault; it stays encrypted in backup.
 */
export async function* capacitorRecords({ rawState, conversations, previewDb, session = null }) {
  let state;
  try { state = JSON.parse(rawState || "{}"); } catch { throw new Error("État local illisible ; aucune donnée n'a été modifiée."); }
  if (!state || Array.isArray(state) || typeof state !== "object") throw new Error("État local invalide.");
  if (!Array.isArray(conversations)) throw new Error("Discussions locales indisponibles.");
  if (!previewDb || !previewDb.objectStoreNames || typeof previewDb.transaction !== "function") throw new Error("Bibliothèque locale indisponible ; la sauvegarde est interrompue.");
  const oldSession = typeof state.session === "string" && state.session ? state.session : null;
  if (session && oldSession && session !== oldSession) throw new Error("Deux sessions locales différentes ont été trouvées ; aucune donnée n'a été modifiée.");
  if (session !== null && typeof session !== "string") throw new Error("Session locale invalide.");
  const fallback = state.conversations === undefined ? [] : state.conversations;
  if (!Array.isArray(fallback)) throw new Error("Anciennes discussions locales invalides.");
  const merged = new Map();
  for (const [origin, list] of [["actuelle", conversations], ["ancienne", fallback]]) {
    for (const [index, conversation] of list.entries()) {
      const key = typeof conversation?.id === "string" && conversation.id ? conversation.id : `sans-identifiant:${origin}:${index}`;
      if (merged.has(key) && JSON.stringify(merged.get(key)) !== JSON.stringify(conversation)) throw new Error("Deux versions différentes d'une discussion locale ont été trouvées ; aucune donnée n'a été modifiée.");
      merged.set(key, conversation);
    }
  }
  // Session and discussions are separated from preferences, but remain in the
  // encrypted archive. The original raw storage is never modified.
  delete state.session;
  delete state.conversations;
  yield { kind: "state", key: "state", value: { rawState: state, secureSession: session || oldSession } };
  for (const [key, conversation] of merged) yield { kind: "conversation", key, value: conversation };
  for await (const row of rows(previewDb, "files")) {
    const { blob, ...metadata } = row.value || {};
    if (!(blob instanceof Blob)) throw new Error("Un aperçu local est illisible ; aucune donnée n'a été supprimée.");
    yield { kind: "file", key: row.key, value: metadata, blob };
  }
  for await (const row of rows(previewDb, "library")) yield { kind: "library", key: row.key, value: row.value };
}
