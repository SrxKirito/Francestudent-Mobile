"use strict";
// File objects remain browser-managed; only bounded chunks cross the bridge.
const tauriSelectedFiles = new Map();
const tauriUploads = new Map();
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
  tauriUploads.delete(id);
  const file = pendingFiles.find(entry => entry.id === id);
  if (file?.data?.startsWith("blob:")) URL.revokeObjectURL(file.data);
  tauriSelectedFiles.delete(id);
  return originalRemoveAttachment(id);
};

previewAttachment = async function(file) {
  const original = tauriSelectedFiles.get(file.id);
  if (original) return previewBlob(file.name, original);
  if (!file.remoteId || !["file", "legacy"].includes(file.remoteKind)) return originalPreviewAttachment(file);
  try {
    if (file.remoteKind === "legacy") {
      const metadata = await settingsApi("/files/" + encodeURIComponent(file.remoteId));
      if (typeof metadata?.base64Data !== "string") throw new Error("Contenu du fichier historique non reconnu.");
      const decoded = atob(metadata.base64Data);
      const blob = new Blob([Uint8Array.from(decoded, c => c.charCodeAt(0))], { type: metadata.contentType || "application/octet-stream" });
      return await previewBlob(metadata.pathname || file.name, blob);
    }
    if (file.name === "Fichier enregistré") {
      const metadata = await settingsApi("/filesv2/" + encodeURIComponent(file.remoteId));
      if (typeof metadata?.filename === "string") file.name = metadata.filename;
    }
    const response = await apiFetch("/filesv2/" + encodeURIComponent(file.remoteId) + "/content", { accept: "*/*" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    let blob = await response.blob();
    if ((response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      const encoded = JSON.parse(await blob.text());
      if (typeof encoded !== "string") throw new Error("Contenu de fichier non reconnu.");
      const decoded = atob(encoded);
      blob = new Blob([Uint8Array.from(decoded, c => c.charCodeAt(0))], { type: file.mime || "application/octet-stream" });
    }
    return await previewBlob(file.name, blob);
  } catch (error) { showToast("Aperçu impossible : " + (error?.message || error), true); }
};

async function beginTauriUpload(entry) {
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
    tauriUploads.delete(entry.id); renderAttachments(); updateSendButton();
  }
}

addFiles = async function(fileList) {
  for (const file of Array.from(fileList || [])) {
    const entry = { id: makeId(), name: file.name || "fichier", kind: file.type.startsWith("image/") ? "image" : "file", mime: file.type, size: file.size, data: file.type.startsWith("image/") ? URL.createObjectURL(file) : "", uploadState: "uploading", uploadProgress: 0 };
    tauriSelectedFiles.set(entry.id, file);
    pendingFiles.push(entry);
    void beginTauriUpload(entry);
  }
  renderAttachments(); updateSendButton();
};
