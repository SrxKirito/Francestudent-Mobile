import { createTauriDestination } from "./destination.mjs";
import { inspectBackup, restoreBackup } from "./backup.mjs";

/**
        * Integrates the existing destination adapter with a host-controlled barrier.
        * acquireImportBarrier must suspend and drain every ordinary writer, retain
        * exclusive access across all windows, and expose migration-only handles.
        * Its finish method must reload in-memory state before resuming ordinary writes
        * whenever writesMayHaveOccurred is true, including after an exception.
        *
        * When the barrier requires a restart after writes (error.restartRequired),
        * the outcome of the operation is attached to that error so it is never lost:
        * error.result holds the restore report, error.operationError the original
        * failure when the restore was interrupted.
        */
export function createTauriImportHost({ acquireImportBarrier }) {
  if (typeof acquireImportBarrier !== "function") throw new Error("Import local indisponible : verrou exclusif absent.");

  async function useBarrier(operation) {
    const barrier = await acquireImportBarrier();
    if (!barrier || typeof barrier.finish !== "function") throw new Error("Import local indisponible : verrou invalide.");
    let writesMayHaveOccurred = false;
    let result;
    let failed = false;
    let failure;
    try {
      if (typeof barrier.assertValid !== "function") throw new Error("Import local indisponible : validation du verrou absente.");
      const destination = createTauriDestination(barrier);
      await barrier.assertValid();
      result = await operation(destination, async () => {
        await barrier.assertValid();
        // Restoration is deliberately treated as potentially partial even if
        // a later operation throws or reports a conflict. The flag is raised
        // first so a failing native notification can never hide a write.
        writesMayHaveOccurred = true;
        if (typeof barrier.beginWrites !== "function") throw new Error("Import local indisponible : notification d'écriture absente.");
        await barrier.beginWrites();
      });
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      await barrier.finish({ writesMayHaveOccurred });
    } catch (finishError) {
      if (finishError && typeof finishError === "object" && finishError.restartRequired) {
        finishError.result = failed ? undefined : result;
        finishError.operationError = failed ? failure : undefined;
        throw finishError;
      }
      throw failed ? failure : finishError;
    }
    if (failed) throw failure;
    return result;
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
