"use strict";

// Only confirmed server operations change the local archive marker. Local
// messages are retained so interrupted operations cannot erase offline data.
const archivedChats = { toggle: null, panel: null, status: null, list: null, more: null, cursor: "", generation: 0, loading: false };
const previousConversationMatches = conversationMatches;
const previousSendMessage = sendMessage;

conversationMatches = function(conversation, query) {
  return !conversation.serverArchived && previousConversationMatches(conversation, query);
};

sendMessage = async function(skillPrefix) {
  const conversation = currentConversation();
  if (!busy && conversation?.serverArchived) {
    showToast("Cette conversation est archivée. Restaure-la avant d’envoyer un message.", true);
    return;
  }
  return previousSendMessage(skillPrefix);
};

function archivedChatId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function archivedChatRoute(id, suffix) {
  if (!archivedChatId(id)) throw new Error("Identifiant de conversation invalide.");
  return "/chats/" + encodeURIComponent(id) + suffix;
}

function archiveStatus(message) {
  if (archivedChats.status) archivedChats.status.textContent = message;
}

function ensureArchiveResponse(response) {
  if (!response?.ok) throw new Error("HTTP " + (response?.status || "indisponible"));
  return response;
}

async function archiveConversation(localId) {
  const conversation = store.conversations.find(item => item.id === localId);
  if (!conversation) return;
  if (busy || conversation.pendingResponse) { showToast("Termine ou annule la réponse en cours avant d’archiver.", true); return; }
  if (!archivedChatId(conversation.chatId)) { showToast("Cette conversation n’est pas encore enregistrée sur le serveur.", true); return; }
  if (!confirm("Archiver « " + (conversation.title || "Sans titre") + " » ? Tu pourras la restaurer plus tard.")) return;
  const session = store.session;
  if (!session) { showToast("Connecte-toi pour archiver une conversation.", true); return; }
  if (conversation.archiveInProgress) return;
  conversation.archiveInProgress = true;
  try {
    const response = await apiFetch(archivedChatRoute(conversation.chatId, "/archive"), { method: "PUT" });
    ensureArchiveResponse(response);
    if (session !== store.session) return;
    conversation.serverArchived = true;
    delete conversation.archiveInProgress;
    saveStore();
    if (currentId === conversation.id) newConversation();
    else renderHistory();
    showToast("Conversation archivée.");
    if (archivedChats.panel && !archivedChats.panel.hidden) void refreshArchivedChats();
  } catch (error) {
    if (session === store.session) showToast("Archivage impossible : " + (error?.message || error), true);
  } finally { delete conversation.archiveInProgress; }
}

async function restoreArchivedChat(chat, row, session) {
  if (busy) { showToast("Attends la fin de la réponse en cours.", true); return; }
  if (session !== store.session) return;
  row.querySelectorAll("button").forEach(button => { button.disabled = true; });
  try {
    const response = await apiFetch(archivedChatRoute(chat.id, "/restore"), { method: "PUT" });
    ensureArchiveResponse(response);
    if (session !== store.session) return;
    let conversation = store.conversations.find(item => item.chatId === chat.id);
    if (!conversation) {
      conversation = {
        id: makeId(), chatId: chat.id, projectId: chat.projectId || null,
        title: typeof chat.title === "string" && chat.title ? chat.title : "Sans titre",
        agentId: chat.agent && Number.isInteger(chat.agent.id) ? chat.agent.id : store.agentId,
        messages: [], needsLoad: true, pinned: chat.isPinned === true,
        updatedAt: serverTime(chat.lastMessageAt) || serverTime(chat.createdAt) || Date.now()
      };
      store.conversations.push(conversation);
    }
    delete conversation.serverArchived;
    if (!conversation.pendingResponse) conversation.needsLoad = true;
    saveStore();
    row.remove();
    renderHistory();
    if (!archivedChats.list.childElementCount && archivedChats.more.hidden) archiveStatus("Aucune conversation archivée.");
    showToast("Conversation restaurée.");
  } catch (error) {
    if (session === store.session) archiveStatus("Restauration impossible : " + (error?.message || error));
  } finally { row.querySelectorAll("button").forEach(button => { button.disabled = false; }); }
}

async function downloadArchivedChat(chat, button, session) {
  if (session !== store.session) return;
  button.disabled = true;
  try {
    const response = ensureArchiveResponse(await apiFetch(archivedChatRoute(chat.id, "/archive/download"), { accept: "application/json" }));
    if (session !== store.session) { if (response.body?.cancel) await response.body.cancel().catch(() => {}); return; }
    if (typeof saveResponse !== "function") throw new Error("L’enregistrement de fichiers est indisponible.");
    await saveResponse("conversation-" + chat.id + ".json", response);
    showToast("Archive enregistrée.");
  } catch (error) {
    if (session === store.session && !/annul[ée]/i.test(String(error?.message || error))) {
      archiveStatus("Téléchargement impossible : " + (error?.message || error));
    }
  } finally { button.disabled = false; }
}

function addArchivedChatRow(chat, session) {
  if (!chat || !archivedChatId(chat.id)) return false;
  if ([...archivedChats.list.children].some(row => row.dataset.chatId === chat.id)) return false;
  const row = document.createElement("div"); row.className = "archived-chat-row"; row.dataset.chatId = chat.id;
  const title = document.createElement("span"); title.textContent = typeof chat.title === "string" && chat.title ? chat.title : "Sans titre";
  const restore = document.createElement("button"); restore.type = "button"; restore.textContent = "Restaurer";
  restore.setAttribute("aria-label", "Restaurer " + title.textContent);
  restore.addEventListener("click", () => { void restoreArchivedChat(chat, row, session); });
  const download = document.createElement("button"); download.type = "button"; download.textContent = "Télécharger";
  download.setAttribute("aria-label", "Télécharger " + title.textContent);
  download.addEventListener("click", () => { void downloadArchivedChat(chat, download, session); });
  row.append(title, restore, download); archivedChats.list.appendChild(row);
  const existing = store.conversations.find(item => item.chatId === chat.id);
  if (existing && !existing.serverArchived) {
    existing.serverArchived = true;
    saveStore(); renderHistory();
  }
  return true;
}

async function loadArchivedChats(generation, session) {
  if (archivedChats.loading || !session) return;
  archivedChats.loading = true; archivedChats.more.disabled = true;
  archiveStatus("Chargement des archives…");
  try {
    const query = "/chats/archived?limit=20" + (archivedChats.cursor ? "&cursor_chat_id=" + encodeURIComponent(archivedChats.cursor) : "");
    const response = await apiFetch(query);
    if (generation !== archivedChats.generation || session !== store.session) {
      if (response.body?.cancel) await response.body.cancel().catch(() => {});
      return;
    }
    ensureArchiveResponse(response);
    const page = await response.json();
    if (generation !== archivedChats.generation || session !== store.session) return;
    if (!page || !Array.isArray(page.chats)) throw new Error("Liste d’archives invalide.");
    page.chats.forEach(chat => addArchivedChatRow(chat, session));
    const last = page.chats.at(-1)?.id;
    if (page.hasMore === true && (!archivedChatId(last) || last === archivedChats.cursor)) throw new Error("Curseur de pagination indisponible.");
    archivedChats.cursor = archivedChatId(last) ? last : archivedChats.cursor;
    archivedChats.more.hidden = page.hasMore !== true;
    archivedChats.more.textContent = "Charger plus";
    archiveStatus(archivedChats.list.childElementCount ? "" : "Aucune conversation archivée.");
  } catch (error) {
    if (generation === archivedChats.generation && session === store.session) {
      archiveStatus("Chargement impossible : " + (error?.message || error));
      archivedChats.more.hidden = false; archivedChats.more.textContent = "Réessayer";
    }
  } finally {
    archivedChats.loading = false; archivedChats.more.disabled = false;
    if (generation !== archivedChats.generation && archivedChats.panel && !archivedChats.panel.hidden && store.session) {
      void loadArchivedChats(archivedChats.generation, store.session);
    }
  }
}

async function refreshArchivedChats() {
  archivedChats.generation++;
  archivedChats.cursor = "";
  archivedChats.list.replaceChildren();
  archivedChats.more.hidden = true;
  await loadArchivedChats(archivedChats.generation, store.session);
}

function setupArchivedChats() {
  const history = document.getElementById("history"), menu = document.getElementById("conv-menu");
  if (!history || !menu || archivedChats.toggle) return;
  const archive = document.createElement("button"); archive.type = "button"; archive.className = "menu-item";
  archive.setAttribute("role", "menuitem"); archive.textContent = "Archiver";
  archive.addEventListener("click", event => {
    event.stopPropagation();
    const id = menuConversationId;
    closeMenus();
    if (id) void archiveConversation(id);
  });
  menu.insertBefore(archive, document.getElementById("conv-delete"));

  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "side-nav-item archived-chat-toggle";
  toggle.textContent = "Conversations archivées"; toggle.setAttribute("aria-expanded", "false");
  const panel = document.createElement("section"); panel.className = "archived-chats-panel"; panel.hidden = true;
  panel.setAttribute("aria-label", "Conversations archivées");
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const list = document.createElement("div");
  const more = document.createElement("button"); more.type = "button"; more.textContent = "Charger plus"; more.hidden = true;
  panel.append(status, list, more);
  history.parentElement.insertBefore(toggle, history);
  history.parentElement.insertBefore(panel, history);
  Object.assign(archivedChats, { toggle, panel, status, list, more });
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) void refreshArchivedChats();
    else { archivedChats.generation++; archivedChats.cursor = ""; list.replaceChildren(); archiveStatus(""); }
  });
  more.addEventListener("click", () => { void loadArchivedChats(archivedChats.generation, store.session); });
  document.getElementById("logout")?.addEventListener("click", () => {
    archivedChats.generation++; archivedChats.cursor = "";
    list.replaceChildren(); panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); archiveStatus("");
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupArchivedChats, { once: true });
else setupArchivedChats();
