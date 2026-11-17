"use strict";

// Locked Chats module for France Student.
// Locked conversations stay hidden from the history while access is closed.
// Contract (docs/api-audit/openapi.json): the PIN has exactly four digits;
// POST /locked-chats/pin and POST /locked-chats/access return `accessToken`.
// That token lives in memory only (never persisted, never logged, never put in
// the public state or events). It is sent in the X-Locked-Chats-Access header,
// through the Rust Tauri transport, to the locked routes and to locked chats.
// It is erased when access is closed, when the app goes to the background and
// when the session changes. A locked route without a token is refused by default.
// DELETE /locked-chats/pin is never called: it permanently deletes the locked
// conversations.
const lockedChats = { hasPin: null, accessOpen: false, accessToken: "", lockedIds: new Set(), session: null, generation: 0, loaded: false };
const previousLockedConversationMatches = conversationMatches;
const previousLockedApiFetch = apiFetch;

conversationMatches = function(conversation, query) {
  if (lockedChatIsHidden(conversation)) return false;
  return previousLockedConversationMatches(conversation, query);
};

// Access is open only while an access token is held in memory.
function lockedChatsHasAccess() {
  lockedChatsSessionChanged();
  return lockedChats.accessOpen && lockedChats.accessToken !== "";
}

function clearLockedAccess() {
  lockedChats.accessToken = "";
  lockedChats.accessOpen = false;
}

function storeLockedAccess(token) {
  lockedChats.accessToken = token;
  lockedChats.accessOpen = true;
}

function lockedChatIsHidden(conversation) {
  if (!conversation || lockedChatsHasAccess()) return false;
  return conversation.serverLocked === true || (!!conversation.chatId && lockedChats.lockedIds.has(conversation.chatId));
}

function lockedChatValidId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function lockedChatRoute(chatId) {
  if (!lockedChatValidId(chatId)) throw new Error("Identifiant de conversation invalide.");
  return "/locked-chats/chats/" + encodeURIComponent(chatId);
}

// The PIN has exactly four digits.
function lockedChatValidPin(pin) {
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin);
}

function requireLockedPin(pin, label = "Code PIN") {
  if (!lockedChatValidPin(pin)) throw new Error(label + " invalide : 4 chiffres attendus.");
  return pin;
}

// Returns the access token of a server answer, or "" when it is missing or malformed.
function lockedChatAccessToken(data) {
  const token = data?.accessToken;
  if (typeof token !== "string" || token.length > 4096) return "";
  return /^[\x21-\x7e]+$/.test(token) ? token : "";
}

async function lockedChatError(response) {
  let detail = "";
  try {
    const data = await response.clone().json();
    detail = data?.message || data?.error || data?.detail || "";
  } catch {}
  const error = new Error(typeof detail === "string" && detail ? detail : "HTTP " + (response?.status || "indisponible"));
  error.status = response?.status || 0;
  return error;
}

async function lockedChatRequest(path, { method = "GET", body, lockedAccess } = {}) {
  const options = { method, body: body === undefined ? undefined : JSON.stringify(body) };
  if (lockedAccess) options.lockedAccess = lockedAccess;
  const response = await apiFetch(path, options);
  if (!response?.ok) throw await lockedChatError(response);
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function lockedChatsSessionChanged() {
  if ((lockedChats.session || null) === (store.session || null)) return false;
  lockedChats.session = store.session || null;
  lockedChats.hasPin = null;
  clearLockedAccess();
  lockedChats.lockedIds = new Set();
  lockedChats.loaded = false;
  lockedChats.generation++;
  return true;
}

// ---- Access policy applied to every request (default: refuse) ----

function lockedChatsAccessError() {
  const error = new Error("Accès aux conversations verrouillées fermé : saisis ton code PIN.");
  error.status = 423;
  return error;
}

function lockedChatKnownLocked(chatId) {
  if (!lockedChatValidId(chatId)) return false;
  if (lockedChats.lockedIds.has(chatId)) return true;
  return (store.conversations || []).some(conversation => conversation.chatId === chatId && conversation.serverLocked === true);
}

function lockedChatBodyChatId(body) {
  if (typeof body !== "string") return null;
  try {
    const id = JSON.parse(body)?.chatId;
    return lockedChatValidId(id) ? id : null;
  } catch {
    return null;
  }
}

// "required": a token is mandatory (refused without it); "optional": sent when
// held; "none": never sent.
function lockedChatsAccessPolicy(path, method, body) {
  const route = String(path).split(/[?#]/)[0].replace(/\/+$/, "");
  if (method === "DELETE" && route === "/locked-chats/pin") {
    throw new Error("Opération interdite : DELETE /locked-chats/pin supprimerait définitivement les conversations verrouillées.");
  }
  if (route === "/locked-chats/pin") return "none";
  if (route === "/locked-chats/access") return method === "DELETE" ? "optional" : "none";
  if (route === "/locked-chats/status") return "optional";
  if (route === "/locked-chats" || route.startsWith("/locked-chats/")) return "required";
  const match = /^\/chats\/([^/]+)/.exec(route);
  const chatId = match && lockedChatValidId(match[1]) ? match[1] : lockedChatBodyChatId(body);
  return lockedChatKnownLocked(chatId) ? "required" : "none";
}

function expireLockedAccess() {
  if (!lockedChats.accessOpen && lockedChats.accessToken === "") return;
  clearLockedAccess();
  leaveCurrentLockedConversation();
  emitLockedChatsChange();
}

apiFetch = async function(path, options = {}, ...rest) {
  const method = String(options?.method || "GET").toUpperCase();
  const policy = lockedChatsAccessPolicy(path, method, options?.body);
  if (policy === "none" && !String(path).startsWith("/locked-chats")) return previousLockedApiFetch(path, options, ...rest);
  lockedChatsSessionChanged();
  if (policy === "none" || options?.lockedAccess) return previousLockedApiFetch(path, options, ...rest);
  const token = lockedChats.accessToken;
  if (!token) {
    if (policy === "required") throw lockedChatsAccessError();
    return previousLockedApiFetch(path, options, ...rest);
  }
  const response = await previousLockedApiFetch(path, { ...options, lockedAccess: token }, ...rest);
  // The server no longer accepts the token: close access locally.
  if (policy === "required" && (response?.status === 403 || response?.status === 423) && lockedChats.accessToken === token) expireLockedAccess();
  return response;
};

function lockedChatItems(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["items", "chats", "data", "results"]) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function lockedChatItemId(item) {
  if (typeof item === "string") return item;
  return item?.chatId || item?.id || item?.chat?.id || null;
}

// While access is open, locked chats unknown locally get a lightweight entry
// (loaded on demand) so they can be opened from the history. Nothing is removed.
function materializeLockedChats(items) {
  if (!lockedChatsHasAccess() || !Array.isArray(store.conversations)) return false;
  let changed = false;
  for (const item of items) {
    const chatId = lockedChatItemId(item);
    if (!lockedChatValidId(chatId) || store.conversations.some(conversation => conversation.chatId === chatId)) continue;
    const chat = item && typeof item === "object" ? (item.chat && typeof item.chat === "object" ? item.chat : item) : {};
    const agentId = Number(chat.agent?.id ?? chat.agentId);
    const time = typeof serverTime === "function" ? (serverTime(chat.lastMessageAt) || serverTime(chat.createdAt)) : 0;
    store.conversations.push({
      id: typeof makeId === "function" ? makeId() : "locked-" + chatId,
      chatId,
      projectId: chat.projectId || null,
      title: typeof chat.title === "string" && chat.title ? chat.title : "Conversation verrouillée",
      agentId: Number.isInteger(agentId) ? agentId : store.agentId,
      messages: [],
      needsLoad: true,
      pinned: chat.isPinned === true,
      serverLocked: true,
      updatedAt: time || Date.now()
    });
    changed = true;
  }
  return changed;
}

function applyLockedIds(ids) {
  lockedChats.lockedIds = new Set(ids.filter(lockedChatValidId));
  for (const conversation of store.conversations || []) {
    const locked = !!conversation.chatId && lockedChats.lockedIds.has(conversation.chatId);
    if (locked) conversation.serverLocked = true;
    else delete conversation.serverLocked;
  }
  saveStore();
}

function setLocalLock(chatId, locked) {
  if (locked) lockedChats.lockedIds.add(chatId);
  else lockedChats.lockedIds.delete(chatId);
  const conversation = (store.conversations || []).find(item => item.chatId === chatId);
  if (conversation) {
    if (locked) conversation.serverLocked = true;
    else delete conversation.serverLocked;
    saveStore();
  }
  return conversation || null;
}

function leaveCurrentLockedConversation() {
  const current = typeof currentConversation === "function" ? currentConversation() : null;
  if (current && lockedChatIsHidden(current) && typeof newConversation === "function") newConversation();
  else if (typeof renderHistory === "function") renderHistory();
}

function emitLockedChatsChange() {
  try {
    window.dispatchEvent(new CustomEvent("francestudent:locked-chats", {
      detail: { hasPin: lockedChats.hasPin, accessOpen: lockedChats.accessOpen, lockedIds: [...lockedChats.lockedIds] }
    }));
  } catch {}
}

// Revokes a token server-side, best effort; it is already erased locally.
function revokeLockedAccessOnServer(token) {
  if (!token || !store.session) return;
  lockedChatRequest("/locked-chats/access", { method: "DELETE", lockedAccess: token }).catch(() => {});
}

// GET /locked-chats/status
async function getLockedChatsStatus() {
  lockedChatsSessionChanged();
  const generation = lockedChats.generation;
  const data = await lockedChatRequest("/locked-chats/status");
  if (generation !== lockedChats.generation) return lockedChatsState();
  lockedChats.hasPin = Boolean(data?.hasPin ?? data?.pinSet ?? data?.isPinSet ?? data?.enabled ?? false);
  const serverOpen = Boolean(data?.accessOpen ?? data?.isAccessOpen ?? data?.accessGranted ?? data?.unlocked ?? false);
  // Without a token held in memory, access stays closed whatever the server says.
  if (!serverOpen) clearLockedAccess();
  lockedChats.accessOpen = lockedChats.accessToken !== "";
  if (!lockedChats.accessOpen) leaveCurrentLockedConversation();
  emitLockedChatsChange();
  return lockedChatsState();
}

// POST /locked-chats/access { pin } -> { accessToken }
async function openLockedChatsAccess(pin) {
  requireLockedPin(pin);
  lockedChatsSessionChanged();
  const generation = lockedChats.generation;
  const data = await lockedChatRequest("/locked-chats/access", { method: "POST", body: { pin } });
  if (generation !== lockedChats.generation) return lockedChatsState();
  const token = lockedChatAccessToken(data);
  if (!token) {
    clearLockedAccess();
    throw new Error("Le serveur n'a pas fourni de jeton d'accès valide : accès refusé.");
  }
  if (document.visibilityState === "hidden") {
    // The app went to the background while the request was running.
    revokeLockedAccessOnServer(token);
    return lockedChatsState();
  }
  storeLockedAccess(token);
  try { await listLockedChats(); } catch {}
  if (typeof renderHistory === "function") renderHistory();
  emitLockedChatsChange();
  return lockedChatsState();
}

// DELETE /locked-chats/access
async function closeLockedChatsAccess({ silent = false } = {}) {
  // Erase the token and hide locally first (synchronously), so locked chats
  // never stay reachable if the request fails.
  const token = lockedChats.accessToken;
  const wasOpen = lockedChats.accessOpen || token !== "";
  clearLockedAccess();
  leaveCurrentLockedConversation();
  emitLockedChatsChange();
  if (!store.session || !token) return lockedChatsState();
  try {
    await lockedChatRequest("/locked-chats/access", { method: "DELETE", lockedAccess: token });
  } catch (error) {
    if (!silent && wasOpen) showToast("Fermeture côté serveur impossible : " + (error?.message || error), true);
  }
  return lockedChatsState();
}

// GET /locked-chats
async function listLockedChats() {
  lockedChatsSessionChanged();
  const generation = lockedChats.generation;
  const data = await lockedChatRequest("/locked-chats");
  if (generation !== lockedChats.generation) return [];
  const items = lockedChatItems(data);
  materializeLockedChats(items);
  applyLockedIds(items.map(lockedChatItemId));
  lockedChats.loaded = true;
  if (typeof renderHistory === "function") renderHistory();
  emitLockedChatsChange();
  return items;
}

// PUT /locked-chats/chats/{chatId}
async function lockChat(chatId) {
  const route = lockedChatRoute(chatId);
  if (lockedChats.hasPin === false) throw new Error("Définis d’abord un code PIN pour verrouiller des conversations.");
  const session = store.session;
  await lockedChatRequest(route, { method: "PUT" });
  if (session !== store.session) return false;
  setLocalLock(chatId, true);
  leaveCurrentLockedConversation();
  emitLockedChatsChange();
  return true;
}

// DELETE /locked-chats/chats/{chatId}
async function unlockChat(chatId) {
  const route = lockedChatRoute(chatId);
  const session = store.session;
  await lockedChatRequest(route, { method: "DELETE" });
  if (session !== store.session) return false;
  setLocalLock(chatId, false);
  if (typeof renderHistory === "function") renderHistory();
  emitLockedChatsChange();
  return true;
}

// POST /locked-chats/pin { pin } -> { accessToken }
async function createLockedChatsPin(pin) {
  requireLockedPin(pin);
  lockedChatsSessionChanged();
  const generation = lockedChats.generation;
  const data = await lockedChatRequest("/locked-chats/pin", { method: "POST", body: { pin } });
  if (generation !== lockedChats.generation) return lockedChatsState();
  lockedChats.hasPin = true;
  const token = lockedChatAccessToken(data);
  if (token && document.visibilityState === "hidden") {
    revokeLockedAccessOnServer(token);
  } else if (token) {
    storeLockedAccess(token);
    try { await listLockedChats(); } catch {}
  }
  emitLockedChatsChange();
  return lockedChatsState();
}

// PUT /locked-chats/pin { currentPin, newPin }
async function changeLockedChatsPin(currentPin, newPin) {
  requireLockedPin(currentPin, "Code PIN actuel");
  requireLockedPin(newPin, "Nouveau code PIN");
  await lockedChatRequest("/locked-chats/pin", { method: "PUT", body: { currentPin, newPin } });
  lockedChats.hasPin = true;
  emitLockedChatsChange();
  return lockedChatsState();
}

// Disabled on purpose: DELETE /locked-chats/pin permanently deletes the locked
// conversations, so it is never called (also refused by the apiFetch policy
// above and by the Rust transport).
async function removeLockedChatsPin(pin) {
  throw new Error("Réinitialisation indisponible : elle supprimerait définitivement les conversations verrouillées.");
}

// Public state: never contains the access token.
function lockedChatsState() {
  return { hasPin: lockedChats.hasPin, accessOpen: lockedChats.accessOpen, lockedIds: [...lockedChats.lockedIds], loaded: lockedChats.loaded };
}

function isChatLocked(chatId) {
  return lockedChats.lockedIds.has(chatId);
}

// Erase the token and close access as soon as the app goes to the background.
function closeLockedChatsInBackground() {
  if (document.visibilityState === "hidden" && (lockedChats.accessOpen || lockedChats.accessToken !== "")) void closeLockedChatsAccess({ silent: true });
}

document.addEventListener("visibilitychange", closeLockedChatsInBackground);
if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("pagehide", () => {
  if (lockedChats.accessOpen || lockedChats.accessToken !== "") void closeLockedChatsAccess({ silent: true });
});

const lockedChatsApi = {
  getStatus: getLockedChatsStatus,
  openAccess: openLockedChatsAccess,
  closeAccess: closeLockedChatsAccess,
  list: listLockedChats,
  lockChat,
  unlockChat,
  createPin: createLockedChatsPin,
  changePin: changeLockedChatsPin,
  removePin: removeLockedChatsPin,
  isChatLocked,
  isHidden: lockedChatIsHidden,
  state: lockedChatsState
};

if (typeof window !== "undefined") window.FranceStudentLockedChats = lockedChatsApi;
if (typeof module !== "undefined" && module.exports) module.exports = lockedChatsApi;

// Initial sync, without blocking startup. After a restart the token is gone,
// so the list is only loaded if access is open (it is not): the PIN is asked again.
if (store?.session) {
  lockedChatsSessionChanged();
  getLockedChatsStatus().then(state => state.hasPin && state.accessOpen ? listLockedChats() : null).catch(() => {});
}
