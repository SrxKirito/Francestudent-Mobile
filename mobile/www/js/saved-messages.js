"use strict";

// Les messages enregistrés sont conservés côté serveur, sans index local parallèle.
(() => {
  const root = "/user/@me/saved-messages";
  const originalActions = addMessageActions;
  addMessageActions = function (row, message, index) {
    originalActions(row, message, index);
    const bar = row.querySelector(".message-actions");
    const button = document.createElement("button");
    button.type = "button"; button.className = "msg-action"; button.textContent = "Enregistrer";
    button.title = "Enregistrer ce message"; button.setAttribute("aria-label", button.title);
    button.addEventListener("click", async event => {
      event.stopPropagation();
      const conversation = currentConversation();
      if (!conversation?.chatId || !message.serverMessageId) { showToast("Recharge cette conversation avant d’enregistrer le message."); return; }
      const session = store.session;
      button.disabled = true;
      try {
        await settingsApi(root + "/" + encodeURIComponent(conversation.chatId) + "/" + encodeURIComponent(message.serverMessageId), { method: "PUT" });
        if (session === store.session) showToast("Message enregistré dans la bibliothèque.");
      } catch (error) { if (session === store.session) showToast("Enregistrement impossible : " + error.message); }
      finally { button.disabled = false; }
    });
    bar.append(button);
  };

  const originalLibrary = openLibrary;
  openLibrary = function (...args) {
    const result = originalLibrary(...args);
    const dialog = document.getElementById("file-library");
    if (!dialog) return result;
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "settings-btn"; toggle.textContent = "Messages enregistrés"; toggle.setAttribute("aria-expanded", "false");
    const section = document.createElement("section"); section.hidden = true; section.setAttribute("aria-label", "Messages enregistrés"); section.style.padding = "12px";
    const status = document.createElement("p"); status.className = "settings-hint"; status.setAttribute("role", "status");
    const list = document.createElement("div");
    const more = document.createElement("button"); more.type = "button"; more.className = "settings-btn"; more.textContent = "Charger la suite"; more.hidden = true;
    section.append(status, list, more); dialog.querySelector("header").after(toggle, section);
    let cursor = null, loading = false, generation = 0, loaded = false;
    const session = store.session;
    const active = token => dialog.open && session === store.session && token === generation;
    async function loadPage(token) {
      if (loading) return;
      loading = true; more.disabled = true; status.textContent = "Chargement des messages…";
      try {
        const page = await settingsApi(root + "?limit=20" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
        if (!active(token)) return;
        if (!page || !Array.isArray(page.savedMessages)) throw new Error("Réponse inattendue du serveur.");
        for (const saved of page.savedMessages) {
          if (!saved.chatId || !saved.messageId) continue;
          const row = document.createElement("article"); row.style.cssText = "border-top:1px solid var(--border, #555);padding:10px 0";
          const text = document.createElement("p"); text.style.whiteSpace = "pre-wrap"; text.style.overflowWrap = "anywhere";
          text.textContent = typeof saved.message?.content === "string" ? saved.message.content : "Message sans texte";
          const open = document.createElement("button"); open.type = "button"; open.className = "settings-btn"; open.textContent = "Ouvrir la conversation";
          open.onclick = async () => {
            if (busy) { showToast("Attends la fin de la réponse en cours."); return; }
            open.disabled = true;
            try {
              let conversation = store.conversations.find(item => item.chatId === saved.chatId);
              if (!conversation) {
                const detail = await settingsApi("/chats/" + encodeURIComponent(saved.chatId));
                if (!active(token)) return;
                if (!detail?.id) throw new Error("Conversation introuvable.");
                conversation = { id: makeId(), chatId: detail.id, title: detail.title || "Sans titre", messages: [], needsLoad: true, projectId: detail.projectId || null, updatedAt: serverTime(detail.lastMessageAt) || Date.now(), agentId: detail.agent?.id || store.agentId };
                store.conversations.push(conversation); saveStore();
              }
              if (active(token)) { dialog.close(); void openConversation(conversation.id); }
            } catch (error) { if (active(token)) status.textContent = "Ouverture impossible : " + error.message; }
            finally { open.disabled = false; }
          };
          const remove = document.createElement("button"); remove.type = "button"; remove.className = "settings-btn"; remove.textContent = "Retirer";
          remove.onclick = async () => {
            remove.disabled = true;
            try { await settingsApi(root + "/" + encodeURIComponent(saved.chatId) + "/" + encodeURIComponent(saved.messageId), { method: "DELETE" }); if (active(token)) row.remove(); }
            catch (error) { if (active(token)) status.textContent = "Retrait impossible : " + error.message; }
            finally { remove.disabled = false; }
          };
          row.append(text, open, remove); list.append(row);
        }
        const next = typeof page.nextCursor === "string" && page.nextCursor !== cursor ? page.nextCursor : null;
        cursor = next; more.hidden = !(page.hasMore && next);
        status.textContent = list.children.length ? "" : "Aucun message enregistré.";
        if (page.hasMore && !next) status.textContent = "La suite des messages est indisponible : curseur manquant.";
        loaded = true;
      } catch (error) { if (active(token)) { status.textContent = "Chargement impossible : " + error.message; more.hidden = false; more.textContent = "Réessayer"; } }
      finally { loading = false; more.disabled = false; }
    }
    toggle.onclick = () => {
      section.hidden = !section.hidden; toggle.setAttribute("aria-expanded", String(!section.hidden));
      if (!section.hidden && !loaded) void loadPage(generation);
    };
    more.onclick = () => { more.textContent = "Charger la suite"; void loadPage(generation); };
    dialog.addEventListener("close", () => { generation++; }, { once: true });
    return result;
  };
})();
