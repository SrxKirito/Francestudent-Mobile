import { capacitorRecords } from "./source.mjs";
import { exportBackup, inspectBackup, restoreBackup } from "./backup.mjs";

// The host must prevent mutations in every app window until release() returns.
// The file host must write to a temporary file and publish it only on commit().
export async function exportLegacy({ password, acquireExclusive, snapshot, openTemporary }) {
  const release = await acquireExclusive();
  let temporary;
  let committed = false;
  try {
    const state = await snapshot();
    temporary = await openTemporary();
    if (!temporary?.sink?.write || !temporary.commit || !temporary.abort) throw new Error("Destination temporaire indisponible.");
    await exportBackup({ password, records: capacitorRecords(state), sink: temporary.sink });
    const result = await temporary.commit();
    committed = true;
    return result;
  } finally {
    try { if (temporary && !committed && temporary.abort) await temporary.abort(); }
    finally { await release(); }
  }
}

// Inspect and restore while the host holds the same exclusive mutation lease.
// Existing records are never overwritten; conflicts are returned for review.
export async function importLegacy({ file, password, destination, acquireExclusive }) {
  const release = await acquireExclusive();
  try {
    const inspection = await inspectBackup({ file, password, destination });
    if (inspection.conflicts.length) return { ...inspection, restored: false };
    return await restoreBackup({ file, password, destination });
  } finally { await release(); }
}
