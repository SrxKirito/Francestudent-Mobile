/**
 * Install synchronously before app scripts open their first transaction.
 * Only one WebView may access these origin stores while exporting. Native code
 * must enforce that precondition; this guard cannot police other WebViews.
 */
export function installExportGuard({ IDBDatabase, Storage }) {
  const originalTransaction = IDBDatabase.prototype.transaction;
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;
  const watched = new Set(["francestudent-conversations", "francestudent-previews"]);
  let active = 0, locked = false, violations = 0;
  const waiters = new Set();
  function finished() { active--; if (!active) { for (const resolve of waiters) resolve(); waiters.clear(); } }
  function rejectWrite() { if (locked) { violations++; throw new Error("Sauvegarde en cours : écriture suspendue."); } }
  IDBDatabase.prototype.transaction = function(stores, mode, ...rest) {
    const tracked = watched.has(this.name) && mode === "readwrite";
    if (tracked) rejectWrite();
    const tx = originalTransaction.call(this, stores, mode, ...rest);
    if (tracked) { active++; let done = false; const once = () => { if (!done) { done = true; finished(); } }; tx.addEventListener("complete", once); tx.addEventListener("abort", once); }
    return tx;
  };
  Storage.prototype.setItem = function(key, value) { if (key === "fs-chat-state") rejectWrite(); return originalSet.call(this, key, value); };
  Storage.prototype.removeItem = function(key) { if (key === "fs-chat-state") rejectWrite(); return originalRemove.call(this, key); };
  Storage.prototype.clear = function() { rejectWrite(); return originalClear.call(this); };
  return async function acquireExclusive() {
    if (locked) throw new Error("Une sauvegarde est déjà en cours.");
    locked = true;
    const start = violations;
    if (active) await new Promise(resolve => waiters.add(resolve));
    const release = async () => { locked = false; };
    release.assertValid = async () => { if (violations !== start) throw new Error("Une modification a été tentée pendant la sauvegarde ; réessaie."); };
    return release;
  };
}
