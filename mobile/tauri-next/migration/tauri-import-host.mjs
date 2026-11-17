import { createTauriDestination } from "./destination.mjs";
import { inspectBackup, restoreBackup } from "./backup.mjs";

/**
 * Integrates the existing destination adapter with a host-controlled barrier.
 * acquireImportBarrier must suspend and drain every ordinary writer, retain
 * exclusive access across all windows, and expose migration-only handles.
 * Its finish method must reload in-memory state before resuming ordinary writes
 * whenever writesMayHaveOccurred is true, including after an exception.
 * No application supplies this contract yet: do not connect it to the UI.
 */
export function createTauriImportHost({ acquireImportBarrier }) {
  if (typeof acquireImportBarrier !== "function") throw new Error("Import local indisponible : verrou exclusif absent.");

  async function useBarrier(operation) {
    const barrier = await acquireImportBarrier();
    if (!barrier || typeof barrier.finish !== "function") throw new Error("Import local indisponible : verrou invalide.");
    let writesMayHaveOccurred = false;
    try {
      if (typeof barrier.assertValid !== "function") throw new Error("Import local indisponible : validation du verrou absente.");
      const destination = createTauriDestination(barrier);
      await barrier.assertValid();
      return await operation(destination, async () => {
        await barrier.assertValid();
        // Restoration is deliberately treated as potentially partial even if
        // a later operation throws or reports a conflict.
        writesMayHaveOccurred = true;
      });
    } finally {
      await barrier.finish({ writesMayHaveOccurred });
    }
  }

  return {
    inspect(file, password) {
      return useBarrier(destination => inspectBackup({ file, password, destination }));
    },
    restore(file, password) {
      return useBarrier(async (destination, beginWrites) => {
        const inspection = await inspectBackup({ file, password, destination });
        if (inspection.conflicts.length) return { ...inspection, restored: false };
        await beginWrites();
        return restoreBackup({ file, password, destination });
      });
    }
  };
}
