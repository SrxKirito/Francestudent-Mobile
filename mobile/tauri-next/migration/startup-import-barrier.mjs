/**
 * A fail-closed coordinator for a dedicated migration-only startup. The caller
 * must start it before loading the normal application scripts. `nativeLease`
 * must actually exclude every other process and WebView which can write the
 * same stores, and retain that exclusion until the old process exits.
 * No such native implementation is currently wired into the application.
 */
export function createStartupImportBarrier({ assertMigrationStartup, nativeLease, openDestination, restart }) {
  for (const fn of [assertMigrationStartup, nativeLease, openDestination, restart]) {
    if (typeof fn !== "function") throw new Error("Démarrage de migration indisponible.");
  }
  let inUse = false;
  let restartRequired = false;
  return async function acquireImportBarrier() {
    if (inUse || restartRequired) throw new Error("Une migration est déjà en cours ou nécessite un redémarrage.");
    inUse = true;
    let lease;
    let destination;
    try {
      await assertMigrationStartup();
      lease = await nativeLease();
      if (!lease || typeof lease.assertValid !== "function" || typeof lease.release !== "function") throw new Error("Verrou natif de migration invalide.");
      await lease.assertValid();
      await assertMigrationStartup();
      destination = await openDestination();
      if (!destination || typeof destination.close !== "function") throw new Error("Stockage de migration indisponible.");
      let finished = false;
      return {
        storage: destination.storage,
        conversationDb: destination.conversationDb,
        previewDb: destination.previewDb,
        vault: destination.vault,
        async assertValid() {
          if (finished) throw new Error("Verrou de migration fermé.");
          await assertMigrationStartup();
          await lease.assertValid();
        },
        async finish({ writesMayHaveOccurred }) {
          if (finished) throw new Error("Verrou de migration déjà fermé.");
          finished = true;
          if (writesMayHaveOccurred) {
            // Never resume the existing runtime after even a partial import.
            // Keep native exclusivity until the process actually exits.
            restartRequired = true;
            await destination.close();
            await restart();
            throw new Error("Redémarrage nécessaire avant de reprendre l'application.");
          }
          try { await destination.close(); }
          catch (error) { restartRequired = true; throw error; }
          try { await lease.release(); }
          catch (error) { restartRequired = true; throw error; }
          inUse = false;
        }
      };
    } catch (error) {
      // Startup failure is releasable only if any opened handles close safely.
      try {
        if (destination && typeof destination.close === "function") await destination.close();
        if (lease && typeof lease.release !== "function") throw new Error("Libération du verrou impossible.");
        if (lease) await lease.release();
        inUse = false;
      } catch { restartRequired = true; }
      throw error;
    }
  };
}
