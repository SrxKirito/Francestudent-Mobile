"use strict";
// Transitional compatibility adapter. Network access is performed in Rust.
const tauriTransport = window.parent.__franceStudentTransport;

getAccessToken = async function(force = false) {
  if (!force && auth.accessToken && auth.expiresAt - Date.now() > TOKEN_MARGIN_MS) return auth.accessToken;
  if (!store.session) throw authError("Aucune session : colle ton cookie de session.");
  let data;
  try { data = await tauriTransport.exchange(store.session, store.deviceId); }
  catch (error) {
    const message = String(error?.message || error);
    if (/HTTP (401|403)\b/.test(message)) throw authError("Session refusée ou expirée : reconnecte-toi.");
    throw new Error("Connexion au serveur impossible : " + message);
  }
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
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const kind = path === "/skills" && method === "POST" ? "skill" : path === "/filesv2" && method === "POST" ? "file" : "";
    const field = kind === "skill" ? "files" : "file";
    const entries = [...body.entries()];
    if (!kind || entries.length !== 1 || entries[0][0] !== field || typeof entries[0][1]?.slice !== "function") throw new Error("Ce formulaire de fichier ne peut pas encore être envoyé.");
    const token = await getAccessToken(retried);
    const result = await tauriTransport.upload(entries[0][1], token, new AbortController().signal, () => {}, kind);
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }
  const token = await getAccessToken(retried);
  const request = tauriChatRequest(path, method, body);
  const response = await tauriTransport.request({ ...request, method, token, accept });
  if (response.status === 401 && !retried) {
    if (response.body) await response.body.cancel().catch(() => {});
    return apiFetch(path, { method, body, accept, stream }, true);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter && /^\d{1,8}$/.test(retryAfter) ? Number(retryAfter) : null;
    if (response.body) await response.body.cancel().catch(() => {});
    const error = new Error("Limite de requêtes atteinte." + (seconds !== null ? " Réessaie dans " + seconds + " secondes." : " Réessaie plus tard."));
    error.status = 429;
    error.retryAfter = retryAfter;
    throw error;
  }
  return response;
};
