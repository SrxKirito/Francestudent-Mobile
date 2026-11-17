"use strict";

// La liste des accès et les droits restent déterminés par le serveur.
(() => {
  const menu = document.getElementById("conv-menu");
  const action = document.createElement("button");
  action.type = "button"; action.className = "menu-item"; action.setAttribute("role", "menuitem"); action.textContent = "Gérer les accès";
  menu.insertBefore(action, document.getElementById("conv-delete"));
  const dialog = document.createElement("dialog");
  dialog.className = "project-editor";
  dialog.setAttribute("aria-label", "Accès à la conversation");
  dialog.innerHTML = '<div style="padding:20px;max-width:480px"><h2>Accès à la conversation</h2><p class="settings-hint">Les droits sont vérifiés par France Student.</p><div data-list></div><p data-status class="settings-hint" role="status"></p><form data-form hidden><label>Adresse e-mail <input class="settings-input" name="email" type="email" required></label><label> Autorisation <select name="permission"><option value="View">Lecture</option><option value="Write">Écriture</option></select></label><button class="settings-btn" type="submit">Partager</button></form><button data-close class="settings-btn" type="button">Fermer</button></div>';
  document.body.append(dialog);
  const list = dialog.querySelector("[data-list]"), status = dialog.querySelector("[data-status]"), form = dialog.querySelector("[data-form]");
  let generation = 0, chatId = null, session = null, request = 0;
  const active = token => token === generation && session === store.session && !!session && dialog.open;
  const endpoint = () => "/chats/" + encodeURIComponent(chatId) + "/shares";
  function target(user) {
    if (Number.isInteger(user.userId)) return { userId: user.userId };
    if (typeof user.userEmail === "string" && user.userEmail) return { userEmail: user.userEmail };
    return null;
  }
  function isOwner(users) {
    const me = store.profile || {};
    return users.some(user => user.owner === true && ((Number.isInteger(me.id) && me.id === user.userId) || (me.email && user.userEmail && me.email.toLowerCase() === user.userEmail.toLowerCase())));
  }
  async function refresh(token) {
    const version = ++request;
    status.textContent = "Chargement des accès…";
    try {
      const users = await settingsApi(endpoint());
      if (!active(token) || version !== request) return;
      if (!Array.isArray(users)) throw new Error("Réponse inattendue du serveur.");
      const owner = isOwner(users);
      form.hidden = !owner;
      list.replaceChildren();
      for (const user of users) {
        const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0";
        const name = document.createElement("span"); name.textContent = (user.userEmail || (user.userId != null ? "Utilisateur " + user.userId : "Utilisateur")) + (user.owner ? " · Propriétaire" : " · " + (user.permission === "Write" ? "Écriture" : user.permission === "View" ? "Lecture" : "Droits inconnus")); row.append(name);
        const identifier = target(user);
        if (owner && !user.owner && identifier) {
          const change = document.createElement("button"); change.type = "button"; change.className = "settings-btn small"; change.textContent = user.permission === "Write" ? "Passer en lecture" : "Autoriser l’écriture";
          change.onclick = () => mutate("PATCH", { ...identifier, permission: user.permission === "Write" ? "View" : "Write" }, token, change);
          const remove = document.createElement("button"); remove.type = "button"; remove.className = "settings-btn small"; remove.textContent = "Retirer";
          remove.onclick = () => { if (window.confirm("Retirer cet accès à la conversation ?")) void mutate("DELETE", identifier, token, remove); };
          if (user.permission === "View" || user.permission === "Write") row.append(change);
          row.append(remove);
        }
        list.append(row);
      }
      status.textContent = users.length ? "" : "Aucun accès affiché.";
    } catch (error) { if (active(token) && version === request) { form.hidden = true; list.replaceChildren(); status.textContent = "Chargement impossible : " + error.message; } }
  }
  async function mutate(method, body, token, button) {
    button.disabled = true; status.textContent = "Enregistrement…";
    try { await settingsApi(endpoint(), { method, body: JSON.stringify(body) }); if (active(token)) await refresh(token); }
    catch (error) { if (active(token)) status.textContent = "Modification impossible : " + error.message; }
    finally { button.disabled = false; }
  }
  action.addEventListener("click", () => {
    const conversation = store.conversations.find(item => item.id === menuConversationId);
    closeMenus();
    if (!conversation?.chatId) { showToast("Cette conversation doit d’abord être synchronisée."); return; }
    generation++; request++; chatId = conversation.chatId; session = store.session;
    list.replaceChildren(); form.hidden = true; form.reset(); status.textContent = "";
    dialog.showModal(); void refresh(generation);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const email = form.elements.email.value.trim();
    if (!email) return;
    void mutate("POST", { userEmail: email, permission: form.elements.permission.value }, generation, form.querySelector('[type="submit"]'));
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { generation++; chatId = null; session = null; list.replaceChildren(); form.reset(); });
})();
