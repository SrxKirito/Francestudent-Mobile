import { createTauriDestination } from "./destination.mjs";
import { inspectBackup } from "./backup.mjs";
import { exportLegacy, importLegacy } from "./orchestrate.mjs";

/**
 * The caller supplies a real exclusive lease and a native temporary-file writer.
 * A UI overlay alone is not a lease: it does not stop pending/background writes.
 */
export function createMigrationHost({ acquireExclusive, snapshot, openTemporary, storage, conversationDb, previewDb, vault }) {
  if (typeof acquireExclusive !== "function") throw new Error("Verrou exclusif de migration indisponible.");
  const destination = () => createTauriDestination({ storage, conversationDb, previewDb, vault });
  return {
    async export(password) {
      if (typeof snapshot !== "function" || typeof openTemporary !== "function") throw new Error("Export natif indisponible.");
      return exportLegacy({ password, acquireExclusive, snapshot, openTemporary });
    },
    async inspect(file, password) {
      const release = await acquireExclusive();
      try { return await inspectBackup({ file, password, destination: destination() }); }
      finally { await release(); }
    },
    async restore(file, password) {
      return importLegacy({ file, password, destination: destination(), acquireExclusive });
    }
  };
}
