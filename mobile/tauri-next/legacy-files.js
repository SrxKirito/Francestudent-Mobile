"use strict";
// File objects remain browser-managed; only bounded chunks cross the bridge.
const tauriSelectedFiles = new Map();
const tauriUploads = new Map();
const originalRenderAttachments = renderAttachments;
const originalRemoveAttachment = removeAttachment;
const originalPreviewAttachment = previewAttachment;
const originalSendMessage = sendMessage;
const originalUpdateSendButton = updateSendButton;

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
  if (!file.remoteId || file.remoteKind !== "file") return originalPreviewAttachment(file);
  try {
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
    const token = await getAccessToken();
    const result = await tauriTransport.upload(file, token, controller.signal, (sent, total) => {
      entry.uploadProgress = total ? sent / total : 1;
      if (Date.now() - lastPaint > 120 || sent === total) { paintTauriUpload(entry); lastPaint = Date.now(); }
    });
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
