// @ts-check
/** @typedef {{ write: (data: Uint8Array) => Promise<number>, close: () => Promise<void> }} WritableFile */

/**
 * @param {(options: {defaultPath: string}) => Promise<string | null>} choose
 * @param {(path: string, options: {write: boolean, create: boolean, truncate: boolean}) => Promise<WritableFile>} open
 * @param {string} name
 * @param {Uint8Array} bytes
 */
export async function saveWithDialog(choose, open, name, bytes) {
  const cleanName = String(name || "fichier").split(/[\\/]/).pop() || "fichier";
  const path = await choose({ defaultPath: cleanName });
  if (!path) throw new Error("Enregistrement annulé.");
  const file = await open(path, { write: true, create: true, truncate: true });
  try {
    const blockSize = 128 * 1024;
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset, Math.min(offset + blockSize, bytes.length)));
      if (!Number.isInteger(written) || written <= 0 || written > Math.min(blockSize, bytes.length - offset)) throw new Error("Écriture du fichier interrompue.");
      offset += written;
    }
  } finally { await file.close(); }
  return path;
}

/**
 * Save a network response incrementally, without buffering its entire body.
 * @param {(options: {defaultPath: string}) => Promise<string | null>} choose
 * @param {(path: string, options: {write: boolean, create: boolean, truncate: boolean}) => Promise<WritableFile>} open
 * @param {string} name
 * @param {Response} response
 */
export async function saveResponseWithDialog(choose, open, name, response) {
  const cleanName = String(name || "fichier").split(/[\\/]/).pop() || "fichier";
  const path = await choose({ defaultPath: cleanName });
  if (!path) { await response.body?.cancel().catch(() => {}); throw new Error("Enregistrement annulé."); }
  let file;
  let reader;
  try {
    file = await open(path, { write: true, create: true, truncate: true });
    reader = response.body?.getReader();
    if (!reader) return path;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length) {
        const chunk = value.subarray(offset, Math.min(offset + 128 * 1024, value.length));
        const written = await file.write(chunk);
        if (!Number.isInteger(written) || written <= 0 || written > chunk.length) throw new Error("Écriture du fichier interrompue.");
        offset += written;
      }
    }
    return path;
  } catch (error) {
    if (reader) await reader.cancel().catch(() => {});
    else await response.body?.cancel().catch(() => {});
    throw error;
  } finally { if (file) await file.close(); }
}
