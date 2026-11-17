/**
 * Portable, encrypted migration archive. The caller supplies a quiescent source
 * and an atomic, non-overwriting destination adapter; see README.md.
 * No local or server data is deleted by this module.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const CHUNK = 48 * 1024;
const MAX_LINE = 256 * 1024;
const MAX_JSON = 128 * 1024 * 1024;
const MAX_BLOB = 512 * 1024 * 1024;
const ITERATIONS = 310_000;
const KINDS = new Set(["state", "conversation", "file", "library"]);

function base64(bytes) {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(result);
}

function unbase64(value) {
  if (typeof value !== "string" || value.length > MAX_LINE || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Encodage de sauvegarde invalide.");
  const raw = atob(value);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function passwordBytes(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) throw new Error("La phrase de sauvegarde doit contenir entre 12 et 1024 caractères.");
  return encoder.encode(password);
}

async function keyFor(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", passwordBytes(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function iv(prefix, number) {
  const value = new Uint8Array(12);
  value.set(prefix);
  new DataView(value.buffer).setUint32(8, number, false);
  return value;
}

function aad(header, number) {
  return encoder.encode(`${header.format}:${header.version}:${header.iterations}:${header.salt}:${header.prefix}:${number}`);
}

function validateRecord(record) {
  if (!record || !KINDS.has(record.kind) || typeof record.key !== "string" || !record.key || record.key.length > 4096) throw new Error("Enregistrement de sauvegarde invalide.");
  if (record.kind === "state" && record.key !== "state") throw new Error("État local invalide.");
  if (record.kind === "file" && !(record.blob instanceof Blob)) throw new Error("Fichier local invalide.");
  if (record.kind === "file" && record.blob.size > MAX_BLOB) throw new Error("Un aperçu dépasse la limite locale de migration.");
  if (["file", "library", "conversation"].includes(record.kind) && (!record.value || typeof record.value !== "object" || Array.isArray(record.value))) throw new Error("Données locales invalides.");
  if (["file", "library"].includes(record.kind) && record.value.id !== record.key) throw new Error("Identifiant local incohérent.");
  if (record.kind === "conversation" && record.value.id && record.value.id !== record.key) throw new Error("Identifiant de discussion incohérent.");
  if (record.kind !== "file" && record.blob !== undefined) throw new Error("Enregistrement inattendu.");
}

/** `records` yields state, each conversation, each preview file and library row. */
export async function exportBackup({ password, records, sink }) {
  if (!sink || typeof sink.write !== "function") throw new Error("Destination de sauvegarde indisponible.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const header = { format: "francestudent-migration", version: 1, iterations: ITERATIONS, salt: base64(salt), prefix: base64(prefix) };
  const key = await keyFor(password, salt, ITERATIONS);
  await sink.write(encoder.encode(JSON.stringify(header) + "\n"));
  let sequence = 0;
  let count = 0;
  let stateCount = 0;
  const ids = new Set();

  async function frame(value) {
    if (sequence >= 0xffffffff) throw new Error("Sauvegarde trop volumineuse.");
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length > 2 * CHUNK) throw new Error("Bloc de sauvegarde trop volumineux.");
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv(prefix, sequence), additionalData: aad(header, sequence) }, key, bytes));
    await sink.write(encoder.encode(JSON.stringify({ n: sequence++, data: base64(encrypted) }) + "\n"));
  }

  for await (const record of records) {
    validateRecord(record);
    const id = `${record.kind}\u0000${record.key}`;
    if (ids.has(id)) throw new Error("Enregistrement dupliqué dans la sauvegarde.");
    ids.add(id);
    if (ids.size > 1_000_000) throw new Error("Trop d'enregistrements locaux.");
    if (record.kind === "state") stateCount++;
    const json = JSON.stringify(record.value);
    if (typeof json !== "string") throw new Error("Données locales non sérialisables.");
    const isFile = record.kind === "file" && typeof File !== "undefined" && record.blob instanceof File;
    await frame({ type: "start", kind: record.kind, key: record.key,
      ...(record.kind === "file" ? { blobType: record.blob.type, fileName: isFile ? record.blob.name : null, lastModified: isFile ? record.blob.lastModified : null } : {}) });
    let totalBytes = 0;
    for (let offset = 0; offset < json.length;) {
      let end = Math.min(offset + CHUNK / 4, json.length);
      const last = json.charCodeAt(end - 1);
      if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(json.slice(offset, end));
      totalBytes += bytes.length;
      if (totalBytes > MAX_JSON) throw new Error("Un élément local dépasse la limite de migration.");
      await frame({ type: "json", data: base64(bytes) });
      offset = end;
    }
    if (record.kind === "file") {
      for (let offset = 0; offset < record.blob.size; offset += CHUNK) {
        const part = new Uint8Array(await record.blob.slice(offset, offset + CHUNK).arrayBuffer());
        await frame({ type: "blob", data: base64(part) });
      }
    }
    await frame({ type: "finish" });
    count++;
  }
  if (stateCount !== 1) throw new Error("La sauvegarde doit contenir exactement un état local.");
  await frame({ type: "end", count });
  return { records: count };
}

async function* lines(file) {
  if (!file || typeof file.stream !== "function") throw new Error("Fichier de sauvegarde invalide.");
  const reader = file.stream().getReader();
  const text = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += text.decode(value, { stream: true });
      let pos;
      while ((pos = buffer.indexOf("\n")) !== -1) {
        if (pos > MAX_LINE) throw new Error("Ligne de sauvegarde trop volumineuse.");
        yield buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
      }
      if (buffer.length > MAX_LINE) throw new Error("Ligne de sauvegarde trop volumineuse.");
    }
    buffer += text.decode();
    if (buffer) throw new Error("Sauvegarde interrompue.");
  } finally { reader.releaseLock(); }
}

function parse(text) {
  try { return JSON.parse(text); } catch { throw new Error("Sauvegarde illisible."); }
}

/** Validates framing, AEAD tags, record order, duplicate identifiers and end marker. */
async function readBackup(file, password, visit) {
  let header, key, prefix, sequence = 0, count = 0, stateCount = 0, current = null, ended = false;
  const ids = new Set();
  for await (const line of lines(file)) {
    if (!header) {
      header = parse(line);
      if (header?.format !== "francestudent-migration" || header.version !== 1 || header.iterations !== ITERATIONS) throw new Error("Version de sauvegarde non prise en charge.");
      const salt = unbase64(header.salt); prefix = unbase64(header.prefix);
      if (salt.length !== 16 || prefix.length !== 8) throw new Error("En-tête de sauvegarde invalide.");
      key = await keyFor(password, salt, header.iterations);
      continue;
    }
    if (ended) throw new Error("Données après la fin de la sauvegarde.");
    const outer = parse(line);
    if (outer?.n !== sequence || sequence >= 0xffffffff) throw new Error("Ordre de sauvegarde invalide.");
    let plaintext;
    try { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv(prefix, sequence), additionalData: aad(header, sequence) }, key, unbase64(outer.data)); }
    catch { throw new Error("Phrase incorrecte ou sauvegarde endommagée."); }
    sequence++;
    const part = parse(decoder.decode(plaintext));
    if (!part || typeof part !== "object" || Array.isArray(part)) throw new Error("Bloc de sauvegarde invalide.");
    if (part.type === "start") {
      if (current || !KINDS.has(part.kind) || typeof part.key !== "string" || !part.key || part.key.length > 4096 || (part.kind === "state" && part.key !== "state")) throw new Error("Début d'enregistrement invalide.");
      const id = `${part.kind}\u0000${part.key}`;
      if (ids.has(id) || ids.size >= 1_000_000) throw new Error("Identifiant de sauvegarde dupliqué ou trop nombreux.");
      ids.add(id);
      if (part.kind === "file" && (typeof part.blobType !== "string" || part.blobType.length > 255 || (part.fileName !== null && (typeof part.fileName !== "string" || part.fileName.length > 4096)) || (part.lastModified !== null && !Number.isFinite(part.lastModified)))) throw new Error("Métadonnées du fichier invalides.");
      current = { kind: part.kind, key: part.key, blobType: part.blobType, fileName: part.fileName, lastModified: part.lastModified, json: [], jsonBytes: 0, blobs: [], blobBytes: 0, readingBlob: false };
    } else if (part.type === "json") {
      if (!current || current.readingBlob) throw new Error("Contenu JSON inattendu.");
      const bytes = unbase64(part.data);
      if (bytes.length > CHUNK || (current.jsonBytes += bytes.length) > MAX_JSON) throw new Error("Données JSON trop volumineuses.");
      current.json.push(bytes);
    } else if (part.type === "blob") {
      if (!current || current.kind !== "file") throw new Error("Contenu de fichier inattendu.");
      current.readingBlob = true;
      const bytes = unbase64(part.data);
      current.blobBytes += bytes.length;
      if (bytes.length > CHUNK || current.blobBytes > MAX_BLOB) throw new Error("Aperçu local trop volumineux.");
      current.blobs.push(bytes);
    } else if (part.type === "finish") {
      if (!current || !current.json.length) throw new Error("Fin d'enregistrement inattendue.");
      const json = new Uint8Array(current.jsonBytes);
      let offset = 0;
      for (const bytes of current.json) { json.set(bytes, offset); offset += bytes.length; }
      const record = { kind: current.kind, key: current.key, value: parse(decoder.decode(json)) };
      if (current.kind === "file") record.blob = current.fileName !== null && typeof File !== "undefined"
        ? new File(current.blobs, current.fileName, { type: current.blobType, lastModified: current.lastModified })
        : new Blob(current.blobs, { type: current.blobType });
      validateRecord(record);
      if (record.kind === "state") stateCount++;
      await visit(record);
      current = null;
      count++;
    } else if (part.type === "end") {
      if (current || part.count !== count || stateCount !== 1) throw new Error("Sauvegarde incomplète.");
      ended = true;
    } else throw new Error("Bloc de sauvegarde inconnu.");
  }
  if (!header || !ended) throw new Error("Sauvegarde incomplète.");
  return { records: count };
}

/** No destination method is called until a full cryptographic validation succeeds. */
export async function inspectBackup({ file, password, destination }) {
  const verified = await readBackup(file, password, async () => {});
  const conflicts = [];
  await readBackup(file, password, async record => {
    const result = await destination.inspect(record);
    if (!["missing", "same", "conflict"].includes(result)) throw new Error("Résultat de comparaison invalide.");
    if (result === "conflict") conflicts.push({ kind: record.kind, key: record.key });
  });
  return { ...verified, conflicts };
}

/** The adapter must compare and insert atomically, never overwrite, and be idempotent. */
export async function restoreBackup({ file, password, destination }) {
  const inspection = await inspectBackup({ file, password, destination });
  if (inspection.conflicts.length) return { ...inspection, restored: false };
  await readBackup(file, password, async record => {
    const outcome = await destination.insertIfMissing(record);
    if (outcome !== "inserted" && outcome !== "same") throw new Error("Conflit pendant la restauration ; les données existantes ont été conservées.");
  });
  return { ...inspection, restored: true };
}
