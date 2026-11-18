"use strict";
// File objects remain browser-managed; only bounded chunks cross the bridge.
const tauriSelectedFiles = new Map();
const tauriUploads = new Map();
// Le sélecteur iOS autorise plusieurs fichiers : limiter les transferts
// simultanés évite de multiplier les buffers et les requêtes réseau.
const tauriUploadQueue = [];
const tauriQueuedIds = new Set();
const tauriMaxConcurrentUploads = 2;

function scheduleTauriUploads() {
  while (tauriUploads.size < tauriMaxConcurrentUploads && tauriUploadQueue.length) {
    const entry = tauriUploadQueue.shift();
    tauriQueuedIds.delete(entry.id);
    if (!tauriSelectedFiles.has(entry.id)) continue;
    void runTauriUpload(entry);
  }
}

function beginTauriUpload(entry) {
  if (!tauriSelectedFiles.has(entry.id) || tauriUploads.has(entry.id) || tauriQueuedIds.has(entry.id)) return;
  entry.uploadState = "queued";
  tauriQueuedIds.add(entry.id);
  tauriUploadQueue.push(entry);
  renderAttachments(); updateSendButton();
  scheduleTauriUploads();
}
const originalRenderAttachments = renderAttachments;
const originalRemoveAttachment = removeAttachment;
const originalPreviewAttachment = previewAttachment;
const originalSendMessage = sendMessage;
const originalUpdateSendButton = updateSendButton;

function tauriMessageFiles(message) {
  const files = [];
  const seen = new Set();
  for (const [ids, kind, name] of [[message.usedFilesV2Ids, "file", "Fichier enregistré"], [message.usedFileIds, "legacy", "Fichier historique"]]) {
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== "string" || !id || seen.has(kind + ":" + id)) continue;
      seen.add(kind + ":" + id);
      files.push({ id: kind + ":" + id, name, kind: "file", remoteKind: kind, remoteId: id });
    }
  }
  return files;
}

function tauriMergeMessageFiles(remote, local) {
  const result = Array.isArray(local) ? local.slice() : [];
  const keys = new Set(result.filter(file => file.remoteId).map(file => (file.remoteKind || "file") + ":" + file.remoteId));
  for (const file of remote || []) if (!keys.has(file.remoteKind + ":" + file.remoteId)) result.push(file);
  return result;
}

function tauriFindLocalMessage(server, messages, position) {
  if (server.serverMessageId) {
    const exact = messages.find(message => message.serverMessageId === server.serverMessageId);
    if (exact) return exact;
  }
  const candidate = messages[position];
  if (!candidate || candidate.serverMessageId) return null;
  return candidate.content === server.content || candidate.prompt === server.content ? candidate : null;
}

function paintTauriUpload(file) {
  const remove = [...document.querySelectorAll("#attachments .attachment-remove")].find(button => button.dataset.id === file.id);
  if (!remove) return;
  const chip = remove.parentElement;
  let status = chip.querySelector(".tauri-upload-status");
  if (!status) { status = document.createElement("span"); status.className = "tauri-upload-status"; status.setAttribute("role", "status"); chip.insertBefore(status, remove); }
  status.replaceChildren();
  if (file.uploadState === "queued") status.textContent = "En attente d’envoi";
  if (file.uploadState === "uploading") status.textContent = "Envoi « " + Math.round((file.uploadProgress || 0) * 100) + " % »";
  if (file.uploadState === "error") {
    status.textContent = "Échec · ";
    const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Réessayer";
    retry.addEventListener("click", event => { event.stopPropagation(); void beginTauriUpload(file); });
    status.append(retry);
  }
}

renderAttachments = function() {
  originalRenderAttachments();
  for (const file of pendingFiles) if (file.uploadState && file.uploadState !== "done") paintTauriUpload(file);
};

updateSendButton = function() {
  originalUpdateSendButton();
  if (!busy && pendingFiles.some(file => file.uploadState && file.uploadState !== "done")) $("send").disabled = true;
};

sendMessage = async function() {
  if (busy) return originalSendMessage();
  if (pendingFiles.some(file => file.uploadState && file.uploadState !== "done")) { showToast("Attends la fin des envois ou retire les fichiers en échec.", true); return; }
  const sent = pendingFiles.slice();
  try { return await originalSendMessage(); }
  finally {
    for (const file of sent) {
      if (pendingFiles.some(entry => entry.id === file.id)) continue;
      if (file.data?.startsWith("blob:")) URL.revokeObjectURL(file.data);
      tauriSelectedFiles.delete(file.id);
    }
  }
};

removeAttachment = function(id) {
  tauriUploads.get(id)?.abort();
  tauriQueuedIds.delete(id);
  const queued = tauriUploadQueue.findIndex(entry => entry.id === id);
  if (queued !== -1) tauriUploadQueue.splice(queued, 1);
  const file = pendingFiles.find(entry => entry.id === id);
  if (file?.data?.startsWith("blob:")) URL.revokeObjectURL(file.data);
  tauriSelectedFiles.delete(id);
  return originalRemoveAttachment(id);
};

// Limite de l’aperçu, distincte des limites d’envoi et de téléchargement.
const tauriPreviewMaxBytes = 6 * 1024 * 1024;
const tauriPreviewTooLarge = "Fichier trop volumineux pour l’aperçu. Utilise Télécharger dans les fichiers enregistrés.";

async function tauriBoundedBlob(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Contenu du fichier indisponible.");
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(tauriPreviewTooLarge);
      parts.push(value);
    }
    return new Blob(parts, { type: response.headers.get("content-type") || "application/octet-stream" });
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

// Files v2 peut renvoyer un JSON contenant une chaîne base64 (format byte).
// Décodage par blocs pour ne pas matérialiser le fichier entier en mémoire.
function tauriDecodedFileResponse(response) {
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) return response;
  const decoder = new TextDecoder();
  let phase = "before", group = "", escape = false, padded = false;
  const transform = new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const output = [];
      for (const char of text) {
        if (phase === "before") { if (/\s/.test(char)) continue; if (char !== '"') throw new Error("Contenu du fichier non reconnu."); phase = "data"; continue; }
        if (phase === "after") { if (!/\s/.test(char)) throw new Error("Contenu du fichier non reconnu."); continue; }
        if (escape) { if (char !== "/") throw new Error("Contenu du fichier non reconnu."); escape = false; }
        else if (char === "\\") { escape = true; continue; }
        else if (char === '"') { if (group) throw new Error("Fichier encodé incomplet."); phase = "after"; continue; }
        if (padded || !/[A-Za-z0-9+/=]/.test(char)) throw new Error("Contenu du fichier non reconnu.");
        group += char;
        if (group.length === 4) {
          if (!/^(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/.test(group)) throw new Error("Fichier encodé invalide.");
          const decoded = atob(group); for (let i = 0; i < decoded.length; i++) output.push(decoded.charCodeAt(i));
          padded = group.includes("="); group = "";
        }
      }
      if (output.length) controller.enqueue(Uint8Array.from(output));
    },
    flush() { if (decoder.decode() || phase !== "after" || escape || group) throw new Error("Fichier encodé incomplet."); }
  });
  return new Response(response.body.pipeThrough(transform), { headers: { "content-type": "application/octet-stream" } });
}

// Lecture bornée pour les vignettes : ne garde jamais plus de `limit` octets en mémoire.
// `truncate` garde le début du fichier (texte) ; sinon un dépassement est une erreur « too-large ».
// Le transport Tauri n'accepte pas de signal d'annulation : l'annulation arrête la lecture et ferme le flux.
async function tauriThumbnailBlob(file, { signal, limit, truncate = false } = {}) {
  const aborted = () => Object.assign(new Error("Annulé"), { name: "AbortError" });
  if (signal?.aborted) throw aborted();
  const response = await apiFetch("/filesv2/" + encodeURIComponent(file.id) + "/content", { accept: "*/*" });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error("HTTP " + response.status); }
  const decoded = tauriDecodedFileResponse(response);
  const reader = decoded.body?.getReader();
  if (!reader) throw new Error("Contenu du fichier indisponible.");
  const parts = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) throw aborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        if (!truncate) throw Object.assign(new Error("Fichier trop volumineux pour une miniature."), { code: "too-large" });
        parts.push(value.subarray(0, limit - size));
        size = limit;
        break;
      }
      parts.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (signal?.aborted) throw aborted();
  return new Blob(parts, { type: decoded.headers.get("content-type") || "application/octet-stream" });
}

async function downloadTauriRemoteFile(file) {
  try {
    const response = await apiFetch("/filesv2/" + encodeURIComponent(file.remoteId) + "/content", { accept: "*/*" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const path = await tauriTransport.saveResponse(file.name, tauriDecodedFileResponse(response));
    showToast("Fichier enregistré.");
    if (await tauriTransport.canOpenSavedFile() && confirm("Fichier enregistré. L’ouvrir maintenant ?")) {
      try { await tauriTransport.openSavedFile(path); }
      catch (error) { showToast("Ouverture impossible : " + (error?.message || error), true); }
    }
  } catch (error) { showToast("Téléchargement impossible : " + (error?.message || error), true); }
}

previewAttachment = async function(file) {
  const original = tauriSelectedFiles.get(file.id);
  if (original) { if (original.size > tauriPreviewMaxBytes) { showToast(tauriPreviewTooLarge, true); return; } return previewBlob(file.name, original); }
  if (!file.remoteId || !["file", "legacy"].includes(file.remoteKind)) return originalPreviewAttachment(file);
  try {
    if (file.remoteKind === "legacy") {
      const response = await apiFetch("/files/" + encodeURIComponent(file.remoteId), { accept: "application/json" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const metadata = JSON.parse(await (await tauriBoundedBlob(response, Math.ceil(tauriPreviewMaxBytes * 4 / 3) + 4096)).text());
      if (typeof metadata?.base64Data !== "string") throw new Error("Contenu du fichier historique non reconnu.");
      const decoded = atob(metadata.base64Data);
      const blob = new Blob([Uint8Array.from(decoded, c => c.charCodeAt(0))], { type: metadata.contentType || "application/octet-stream" });
      if (blob.size > tauriPreviewMaxBytes) throw new Error(tauriPreviewTooLarge);
      return await previewBlob(metadata.pathname || file.name, blob);
    }
    if (Number.isFinite(file.size) && file.size > tauriPreviewMaxBytes) throw new Error(tauriPreviewTooLarge);
    if (file.name === "Fichier enregistré") {
      const metadata = await settingsApi("/filesv2/" + encodeURIComponent(file.remoteId));
      if (typeof metadata?.filename === "string") file.name = metadata.filename;
      if (Number.isFinite(metadata?.bytes) && metadata.bytes > tauriPreviewMaxBytes) throw new Error(tauriPreviewTooLarge);
    }
    const response = await apiFetch("/filesv2/" + encodeURIComponent(file.remoteId) + "/content", { accept: "*/*" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    let blob = await tauriBoundedBlob(response, Math.ceil(tauriPreviewMaxBytes * 4 / 3) + 1024);
    if ((response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      const encoded = JSON.parse(await blob.text());
      if (typeof encoded !== "string") throw new Error("Contenu de fichier non reconnu.");
      const decoded = atob(encoded);
      blob = new Blob([Uint8Array.from(decoded, c => c.charCodeAt(0))], { type: file.mime || "application/octet-stream" });
    }
    if (blob.size > tauriPreviewMaxBytes) throw new Error(tauriPreviewTooLarge);
    return await previewBlob(file.name, blob);
  } catch (error) { showToast("Aperçu impossible : " + (error?.message || error), true); }
};

async function runTauriUpload(entry) {
  const file = tauriSelectedFiles.get(entry.id);
  if (!file || tauriUploads.has(entry.id)) return;
  const controller = new AbortController();
  tauriUploads.set(entry.id, controller);
  entry.uploadState = "uploading"; entry.uploadProgress = 0;
  renderAttachments(); updateSendButton();
  let lastPaint = 0;
  try {
    const send = async force => tauriTransport.upload(file, await getAccessToken(force), controller.signal, (sent, total) => {
      entry.uploadProgress = total ? sent / total : 1;
      if (Date.now() - lastPaint > 120 || sent === total) { paintTauriUpload(entry); lastPaint = Date.now(); }
    });
    let result;
    try { result = await send(false); }
    catch (error) {
      if (!controller.signal.aborted && /HTTP 401\b/.test(String(error?.message || error))) result = await send(true);
      else throw error;
    }
    if (controller.signal.aborted) return;
    if (!result || typeof result.id !== "string" || !result.id) throw new Error("Identifiant de fichier absent dans la réponse du serveur.");
    entry.remoteId = result.id; entry.remoteKind = "file"; entry.uploadState = "done";
  } catch (error) {
    if (!controller.signal.aborted) { entry.uploadState = "error"; showToast("Envoi de " + entry.name + " : " + (error?.message || error), true); }
  } finally {
    // Une annulation peut encore se terminer après une nouvelle tentative.
    if (tauriUploads.get(entry.id) === controller) tauriUploads.delete(entry.id);
    renderAttachments(); updateSendButton(); scheduleTauriUploads();
  }
}

addFiles = async function(fileList) {
  for (const file of Array.from(fileList || [])) {
    const entry = { id: makeId(), name: file.name || "fichier", kind: file.type.startsWith("image/") ? "image" : "file", mime: file.type, size: file.size, data: file.type.startsWith("image/") ? URL.createObjectURL(file) : "", uploadState: "uploading", uploadProgress: 0 };
    tauriSelectedFiles.set(entry.id, file);
    pendingFiles.push(entry);
    beginTauriUpload(entry);
  }
  renderAttachments(); updateSendButton();
};
