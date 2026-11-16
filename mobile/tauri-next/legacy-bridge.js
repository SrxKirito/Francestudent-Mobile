"use strict";
// Transitional compatibility adapter. Network access is performed in Rust.
const tauriTransport = window.parent.__franceStudentTransport;

getAccessToken = async function(force = false) {
  if (!force && auth.accessToken && auth.expiresAt - Date.now() > TOKEN_MARGIN_MS) return auth.accessToken;
  if (!store.session) throw authError("Aucune session : colle ton cookie de session.");
  const data = await tauriTransport.exchange(store.session, store.deviceId);
  if (!data || typeof data.accessToken !== "string" || !data.accessToken) throw authError("Aucun jeton reçu : session expirée ?");
  auth.accessToken = data.accessToken;
  auth.expiresAt = data.expiresAt ? Number(data.expiresAt) * 1000 : Date.now() + (Number(data.expiresIn) || 300) * 1000;
  return auth.accessToken;
};

function tauriChatRequest(path, method, body) {
  if (path !== "/chats/stream" || method !== "POST" || typeof body !== "string") return { path, body };
  const old = JSON.parse(body);
  const common = { agentId: old.agentId, enableWebSearch: old.enableWebSearch, images: old.images, files: old.files };
  if (old.chatId) return { path: "/chats/" + encodeURIComponent(old.chatId), body: JSON.stringify({ ...common, content: old.initialContent }) };
  return { path, body: JSON.stringify({ ...common, initialContent: old.initialContent, projectId: old.projectId }) };
}

apiFetch = async function(path, { method = "GET", body, accept = "application/json", stream = false } = {}, retried = false) {
  if (typeof FormData !== "undefined" && body instanceof FormData) throw new Error("L'envoi de fichiers n'est pas encore disponible dans cette version de migration.");
  const token = await getAccessToken(retried);
  const request = tauriChatRequest(path, method, body);
  const response = await tauriTransport.request({ ...request, method, token, accept });
  if (response.status === 401 && !retried) {
    if (response.body) await response.body.cancel().catch(() => {});
    return apiFetch(path, { method, body, accept, stream }, true);
  }
  return response;
};
