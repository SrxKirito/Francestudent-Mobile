/**
 * Install synchronously before app scripts open their first transaction.
 * Only one WebView may access these origin stores while exporting. Native code
 * must enforce that precondition; this guard cannot police other WebViews.
 */
export function installExportGuard({ IDBDatabase, Storage, acquireGlobal, capture }) {
  if (typeof acquireGlobal !== "function" || typeof capture !== "function") throw new Error("Coordination et capture de l'état requises.");
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
    const releaseGlobal = await acquireGlobal();
    if (typeof releaseGlobal !== "function") throw new Error("Verrou global indisponible.");
    if (locked) { await releaseGlobal(); throw new Error("Une sauvegarde est déjà en cours."); }
    locked = true;
    try {
      const start = violations;
      if (active) await new Promise(resolve => waiters.add(resolve));
      const snapshot = capture();
      if (typeof snapshot !== "string") throw new Error("Capture synchrone de l'état indisponible.");
      let released = false;
      const release = async () => { if (!released) { released = true; locked = false; await releaseGlobal(); } };
      release.assertValid = async () => {
        if (released || violations !== start || capture() !== snapshot) throw new Error("Une modification a été tentée pendant la sauvegarde ; réessaie.");
      };
      return release;
    } catch (error) { locked = false; await releaseGlobal(); throw error; }
  };
}

/** Cooperative cross-window lock. Every participating writer must use it. */
export async function acquireWebLock(locks) {
  if (!locks || typeof locks.request !== "function") throw new Error("Coordination entre fenêtres indisponible.");
  let release;
  let ready;
  const acquired = new Promise(resolve => { ready = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const request = locks.request("francestudent-migration", { mode: "exclusive" }, async () => { ready(); await hold; });
  await Promise.race([acquired, request.then(() => { throw new Error("Verrou global indisponible."); })]);
  return async () => { release(); await request; };
}
