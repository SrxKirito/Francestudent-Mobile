"use strict";

// Locked Chats module for France Student.
// Locked conversations stay hidden from the history while access is closed.
// The local `serverLocked` marker only changes after a confirmed server answer,
// and access is closed locally first (fail-safe) whenever the app is hidden.
const lockedChats = { hasPin: null, accessOpen: false, lockedIds: new Set(), session: null, generation: 0, loaded: false };
const previousLockedConversationMatches = conversationMatches;

conversationMatches = function(conversation, query) {
  if (lockedChatIsHidden(conversation)) return false;
  return previousLockedConversationMatches(conversation, query);
};

function lockedChatIsHidden(conversation) {
  if (!conversation || lockedChats.accessOpen) return false;
  return conversation.serverLocked === true || (!!conversation.chatId && lockedChats.lockedIds.has(conversation.chatId));
}

function lockedChatValidId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function lockedChatRoute(chatId) {
  if (!lockedChatValidId(chatId)) throw new Error("Identifiant de conversation invalide.");
  return "/locked-chats/chats/" + encodeURIComponent(chatId);
}

function lockedChatValidPin(pin) {
  return typeof pin === "string" && /^[0-9]{4,12}$/.test(pin);
}

function requireLockedPin(pin, label = "Code PIN") {
  if (!lockedChatValidPin(pin)) throw new Error(label + " invalide : 4 à 12 chiffres attendus.");
  return pin;
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

async function lockedChatRequest(path, { method = "GET", body } = {}) {
  const response = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response?.ok) throw await lockedChatError(response);
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function lockedChatsSessionChanged() {
  if (lockedChats.session === store.session) return false;
  lockedChats.session = store.session;
  lockedChats.hasPin = null;
  lockedChats.accessOpen = false;
  lockedChats.lockedIds = new Set();
  lockedChats.loaded = false;
  lockedChats.generation++;
  return true;
}

function lockedChatItems(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["items", "chats", "data", "results"]) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function lockedChatItemId(item) {
  if (typeof item === "string") return item;
  return item?.chatId || item?.id || item?.chat?.id || null;
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

// GET /locked-chats/status
async function getLockedChatsStatus() {
  lockedChatsSessionChanged();
  const generation = lockedChats.generation;
  const data = await lockedChatRequest("/locked-chats/status");
  if (generation !== lockedChats.generation) return lockedChatsState();
  lockedChats.hasPin = Boolean(data?.hasPin ?? data?.pinSet ?? data?.isPinSet ?? data?.enabled ?? false);
  lockedChats.accessOpen = Boolean(data?.accessOpen ?? data?.isAccessOpen ?? data?.accessGranted ?? data?.unlocked ?? false);
  if (!lockedChats.accessOpen) leaveCurrentLockedConversation();
  emitLockedChatsChange();
  return lockedChatsState();
}

// POST /locked-chats/access { pin }
async function openLockedChatsAccess(pin) {
  requireLockedPin(pin);
  lockedChatsSessionChanged();
  const generation = lockedChats.generation;
  await lockedChatRequest("/locked-chats/access", { method: "POST", body: { pin } });
  if (generation !== lockedChats.generation) return lockedChatsState();
  lockedChats.accessOpen = true;
  try { await listLockedChats(); } catch {}
  if (typeof renderHistory === "function") renderHistory();
  emitLockedChatsChange();
  return lockedChatsState();
}

// DELETE /locked-chats/access
async function closeLockedChatsAccess({ silent = false } = {}) {
  // Hide locally first so locked chats never stay visible if the request fails.
  const wasOpen = lockedChats.accessOpen;
  lockedChats.accessOpen = false;
  leaveCurrentLockedConversation();
  emitLockedChatsChange();
  if (!store.session) return lockedChatsState();
  try {
    await lockedChatRequest("/locked-chats/access", { method: "DELETE" });
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

// POST /locked-chats/pin { pin }
async function createLockedChatsPin(pin) {
  requireLockedPin(pin);
  await lockedChatRequest("/locked-chats/pin", { method: "POST", body: { pin } });
  lockedChats.hasPin = true;
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

// DELETE /locked-chats/pin { pin }
async function removeLockedChatsPin(pin) {
  requireLockedPin(pin);
  await lockedChatRequest("/locked-chats/pin", { method: "DELETE", body: { pin } });
  lockedChats.hasPin = false;
  lockedChats.accessOpen = false;
  applyLockedIds([]);
  if (typeof renderHistory === "function") renderHistory();
  emitLockedChatsChange();
  return lockedChatsState();
}

function lockedChatsState() {
  return { hasPin: lockedChats.hasPin, accessOpen: lockedChats.accessOpen, lockedIds: [...lockedChats.lockedIds], loaded: lockedChats.loaded };
}

function isChatLocked(chatId) {
  return lockedChats.lockedIds.has(chatId);
}

// Close access as soon as the app goes to the background.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && lockedChats.accessOpen) void closeLockedChatsAccess({ silent: true });
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

// Initial sync, without blocking startup.
if (store?.session) {
  lockedChatsSessionChanged();
  getLockedChatsStatus().then(state => state.hasPin ? listLockedChats() : null).catch(() => {});
}
