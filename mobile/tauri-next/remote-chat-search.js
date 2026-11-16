"use strict";

// Search is an explicit, debounced user action. Results are just a local index
// of server chats; messages remain on the server until the chat is opened.
const remoteChatSearch = {
  generation: 0,
  timer: null,
  input: null,
  status: null,
  results: null,
  composing: false
};

function remoteSearchStillCurrent(generation, session) {
  return remoteChatSearch.generation === generation && store.session === session && Boolean(session);
}

function remoteSearchStatus(text) {
  if (!remoteChatSearch.status) return;
  remoteChatSearch.status.textContent = text;
  remoteChatSearch.status.hidden = !text;
}

async function openRemoteSearchChat(chat, session) {
  if (busy) { showToast("Attends la fin de la réponse en cours.", true); return; }
  if (store.session !== session) return;
  try {
    let local = store.conversations.find(item => item.chatId === chat.id);
    const projectId = Object.hasOwn(chat, "projectId") ? chat.projectId || null : local?.projectId || null;
    const currentProjectId = typeof currentProject !== "undefined" && currentProject ? currentProject.id : null;
    if (projectId && projectId !== currentProjectId) {
      await openProject(projectId);
      if (store.session !== session) return;
      if (!currentProject || currentProject.id !== projectId) throw new Error("Projet indisponible.");
    } else if (!projectId && currentProjectId) leaveProject();
    local = store.conversations.find(item => item.chatId === chat.id);
    if (!local) {
      const agentId = chat.agent && Number.isInteger(chat.agent.id) ? chat.agent.id : store.agentId;
      local = {
        id: makeId(), chatId: chat.id, projectId,
        title: typeof chat.title === "string" && chat.title ? chat.title : "Sans titre",
        agentId, messages: [], needsLoad: true, pinned: chat.isPinned === true,
        updatedAt: serverTime(chat.lastMessageAt) || serverTime(chat.createdAt) || Date.now()
      };
      store.conversations.push(local);
      saveStore();
    } else if (!local.pendingResponse) {
      local.needsLoad = true;
    }
    await openConversation(local.id);
  } catch (error) { showToast("Ouverture impossible : " + (error?.message || error), true); }
}

function showRemoteChatResults(chats, session) {
  const results = remoteChatSearch.results;
  results.replaceChildren();
  const seen = new Set();
  for (const chat of chats) {
    if (!chat || typeof chat.id !== "string" || !chat.id || seen.has(chat.id)) continue;
    seen.add(chat.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remote-chat-search-result";
    button.textContent = (typeof chat.title === "string" && chat.title ? chat.title : "Sans titre") + (chat.projectId ? " · Projet" : "");
    button.addEventListener("click", () => { void openRemoteSearchChat(chat, session); });
    results.appendChild(button);
  }
  results.hidden = !seen.size;
  return seen.size;
}

async function runRemoteChatSearch(query, generation, session) {
  try {
    const response = await apiFetch("/chats/search?query=" + encodeURIComponent(query) + "&limit=20");
    if (!remoteSearchStillCurrent(generation, session)) {
      if (response.body?.cancel) await response.body.cancel().catch(() => {});
      return;
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const page = await response.json();
    if (!remoteSearchStillCurrent(generation, session)) return;
    if (!page || !Array.isArray(page.chats)) throw new Error("Réponse de recherche invalide.");
    const count = showRemoteChatResults(page.chats, session);
    remoteSearchStatus("Résultats en ligne : " + count + (page.hasMore ? " · résultats limités" : ""));
  } catch (error) {
    if (!remoteSearchStillCurrent(generation, session)) return;
    remoteSearchStatus("Recherche en ligne indisponible : " + (error?.message || "erreur réseau") + ". Les résultats locaux restent accessibles.");
  }
}

function scheduleRemoteChatSearch() {
  remoteChatSearch.generation++;
  const generation = remoteChatSearch.generation;
  if (remoteChatSearch.timer !== null) clearTimeout(remoteChatSearch.timer);
  remoteChatSearch.timer = null;
  if (remoteChatSearch.results) { remoteChatSearch.results.replaceChildren(); remoteChatSearch.results.hidden = true; }
  const query = String(remoteChatSearch.input?.value || "").trim();
  const session = store.session;
  if (!query || !session || remoteChatSearch.composing) {
    remoteSearchStatus("");
    return;
  }
  remoteSearchStatus("Recherche en ligne…");
  remoteChatSearch.timer = setTimeout(() => {
    remoteChatSearch.timer = null;
    void runRemoteChatSearch(query, generation, session);
  }, 350);
}

function setupRemoteChatSearch() {
  const input = document.getElementById("search-input");
  const container = input?.closest(".search-box");
  if (!input || !container || remoteChatSearch.input) return;
  const status = document.createElement("div");
  status.className = "remote-chat-search-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const results = document.createElement("div");
  results.className = "remote-chat-search-results";
  results.setAttribute("aria-label", "Résultats de recherche en ligne");
  results.hidden = true;
  container.insertAdjacentElement("afterend", status);
  status.insertAdjacentElement("afterend", results);
  remoteChatSearch.input = input;
  remoteChatSearch.status = status;
  remoteChatSearch.results = results;
  input.addEventListener("input", scheduleRemoteChatSearch);
  input.addEventListener("compositionstart", () => { remoteChatSearch.composing = true; scheduleRemoteChatSearch(); });
  input.addEventListener("compositionend", () => { remoteChatSearch.composing = false; scheduleRemoteChatSearch(); });
  document.getElementById("logout")?.addEventListener("click", () => {
    remoteChatSearch.generation++;
    if (remoteChatSearch.timer !== null) clearTimeout(remoteChatSearch.timer);
    remoteChatSearch.timer = null;
    results.replaceChildren();
    results.hidden = true;
    remoteSearchStatus("");
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupRemoteChatSearch, { once: true });
else setupRemoteChatSearch();
