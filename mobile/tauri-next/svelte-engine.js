"use strict";

// Pont entre l'ancienne interface (iframe) et la coque Svelte (page parente, même origine, ?ui=svelte).
//
// Tant que le chat, les paramètres, les projets et la bibliothèque restent dans l'ancienne interface, la barre latérale
// est dessinée par Svelte et ce script la relie au moteur historique : lecture de l'état (discussions, projet, compte),
// actions (nouvelle discussion, ouvrir, épingler, renommer, supprimer) et notifications.
//
// INERTE par défaut : rien n'est modifié tant que la coque Svelte n'appelle pas `window.__fsEngine.attach(hôte)`.
// Sans cet appel (interface par défaut), l'application se comporte exactement comme avant.
//
// Les actions passent par les boutons historiques (`.click()`) ou les fonctions historiques : les gestionnaires et les
// greffes Tauri qui les enveloppent restent donc ceux qui s'exécutent. Les valeurs sont échangées en JSON (texte) pour
// que la page parente ne garde aucune référence vers des objets de l'iframe.
(function () {
  const STYLE_ID = "fs-engine-style";
  const STYLE = [
    "#sidebar { visibility: hidden; }",
    "@media (min-width: 769px) { #sidebar { display: none !important; } }",
    "html.fs-host-sidebar #menu-toggle { display: none !important; }"
  ].join("\n");
  const ACTIONS = {
    "new-chat": "new-chat",
    "projects": "projects-open",
    "library": "library-open",
    "project-settings": "project-settings-open",
    "leave-project": "project-leave",
    "settings": "user-button"
  };

  let host = null;
  let patched = [];
  let observer = null;
  let queued = false;
  let settingsHome = null;

  const byId = id => document.getElementById(id);

  function textOf(id) {
    const node = byId(id);
    return node ? node.textContent || "" : "";
  }

  function lightConversation(conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      pinned: conversation.pinned === true,
      projectId: conversation.projectId ?? null,
      agentId: conversation.agentId,
      agentName: conversation.agentName,
      agentProvider: conversation.agentProvider
    };
  }

  // Panneau « Conversations archivées » de l'ancienne interface (archived-chats.js), lu tel quel dans son DOM.
  function archiveState() {
    const toggle = document.querySelector(".archived-chat-toggle");
    const panel = document.querySelector(".archived-chats-panel");
    if (!toggle || !panel) return { available: false, open: false, status: "", rows: [], moreHidden: true, moreLabel: "", moreDisabled: false };
    const status = panel.querySelector("p");
    const more = panel.querySelector(":scope > button");
    return {
      available: true,
      open: !panel.hidden,
      status: status ? status.textContent || "" : "",
      rows: Array.from(panel.querySelectorAll(".archived-chat-row")).map(row => {
        const title = row.querySelector("span");
        const first = row.querySelector("button");
        return { id: row.dataset.chatId || "", title: title ? title.textContent || "" : "", busy: Boolean(first && first.disabled) };
      }),
      moreHidden: !more || more.hidden,
      moreLabel: more ? more.textContent || "" : "",
      moreDisabled: Boolean(more && more.disabled)
    };
  }

  // Résultats de la recherche sur le serveur (remote-chat-search.js), lus tels quels dans son DOM.
  function remoteSearchState() {
    const status = document.querySelector(".remote-chat-search-status");
    const results = document.querySelector(".remote-chat-search-results");
    return {
      status: status && !status.hidden ? status.textContent || "" : "",
      results: results && !results.hidden
        ? Array.from(results.querySelectorAll(".remote-chat-search-result")).map(button => button.textContent || "")
        : []
    };
  }

  // Les discussions sont envoyées SANS leurs messages (lourds) ; la recherche dans le contenu se fait ici (`matches`).
  // Sans recherche, seules les discussions que l'ancienne liste afficherait sont envoyées : archivées (archived-chats.js)
  // et verrouillées (locked-chats.js) restent donc invisibles, comme avant, car `conversationMatches` les écarte.
  function snapshot() {
    const profile = store.profile || {};
    const app = byId("app");
    const project = typeof currentProject === "undefined" ? null : currentProject;
    return JSON.stringify({
      ready: Boolean(app) && !app.classList.contains("hidden"),
      conversations: store.conversations.filter(conversation => conversationMatches(conversation, "")).map(lightConversation),
      archive: archiveState(),
      remoteSearch: remoteSearchState(),
      currentId: currentId,
      project: project ? { name: project.name || "", sharedWithMe: project.sharedWithMe === true } : null,
      projectId: project ? project.id : null,
      projectStatus: textOf("project-status"),
      userName: profile.name || profile.email || "Mon compte",
      avatar: store.avatar || profile.avatar || "",
      settingsOpen: document.body.classList.contains("settings-open"),
      theme: store.theme || "system",
      agents: agents.map(agent => ({ id: agent.id, name: agent.name, provider: agent.provider, available: agent.available !== false }))
    });
  }

  // Même règle que la recherche historique (titre + contenu des messages), via la fonction historique elle-même.
  function matches(query) {
    const text = String(query || "").trim().toLowerCase();
    return JSON.stringify(store.conversations.filter(conversation => conversationMatches(conversation, text)).map(conversation => conversation.id));
  }

  function notify() {
    if (!host || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!host) return;
      try {
        host.changed();
      } catch (error) {
        console.error("Coque Svelte : notification impossible", error);
      }
    });
  }

  function resetDrag() {
    const overlay = byId("overlay");
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.style.removeProperty("opacity");
    }
    const app = byId("app");
    if (app) app.classList.remove("sidebar-dragging");
    const sidebar = byId("sidebar");
    if (sidebar) sidebar.style.removeProperty("transform");
  }

  // Remplace une fonction globale historique ; les appels internes passent par la liaison globale et utilisent donc le remplaçant.
  function patch(name, build) {
    const original = window[name];
    if (typeof original !== "function") return;
    const replacement = build(original);
    window[name] = replacement;
    patched.push({ name, original, replacement });
  }

  function after(callback) {
    return original => function () {
      const result = original.apply(this, arguments);
      callback();
      return result;
    };
  }

  function onClick(event) {
    const target = event.target;
    if (target && typeof target.closest === "function" && target.closest("#menu-toggle")) {
      event.stopImmediatePropagation();
      event.preventDefault();
      host.menuToggle();
      return;
    }
    // L'ancienne interface ferme ses menus à chaque clic ; le menu des discussions est maintenant dans la page parente.
    host.closeMenus();
  }

  function moveSettingsToBody() {
    const modal = byId("settings-modal");
    if (!modal || modal.parentNode === document.body) return;
    settingsHome = { modal, parent: modal.parentNode, next: modal.nextSibling };
    document.body.appendChild(modal);
  }

  function restoreSettings() {
    if (!settingsHome) return;
    settingsHome.parent.insertBefore(settingsHome.modal, settingsHome.next);
    settingsHome = null;
  }

  function attach(nextHost) {
    detach();
    host = nextHost;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
    // Les paramètres vivent dans la barre latérale historique, désormais masquée : on les sort pour qu'ils restent visibles.
    moveSettingsToBody();
    for (const name of ["renderHistory", "renderProjectContext", "renderProfile", "applyTheme"]) patch(name, after(notify));
    patch("closeMenus", after(() => host && host.closeMenus()));
    // L'ancienne interface n'écrit qu'un avertissement console quand le serveur refuse une action : on prévient l'utilisateur.
    patch("syncConversation", original => async function (conversation, method, suffix) {
      const ok = await original.apply(this, arguments);
      if (ok === false && typeof showToast === "function") {
        const what = suffix === "/pins" ? "L'\u00E9pinglage" : method === "DELETE" ? "La suppression" : "Le renommage";
        showToast(what + " n'est pas synchronis\u00E9 avec le serveur.", true);
      }
      return ok;
    });
    patch("openSidebar", () => function () {
      resetDrag();
      host.openSidebar();
    });
    patch("closeSidebar", () => function () {
      resetDrag();
      host.closeSidebar();
    });
    document.addEventListener("click", onClick, true);
    observer = new MutationObserver(notify);
    const app = byId("app");
    if (app) observer.observe(app, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    const status = byId("project-status");
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true });
    // Panneau des archives et résultats de recherche sur le serveur : leur DOM est la source de l'état affiché par la coque.
    for (const selector of [".archived-chat-toggle", ".archived-chats-panel", ".remote-chat-search-status", ".remote-chat-search-results"]) {
      const node = document.querySelector(selector);
      if (node) observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    notify();
  }

  function detach() {
    if (!host) return;
    for (const item of patched) {
      if (window[item.name] === item.replacement) window[item.name] = item.original;
    }
    patched = [];
    document.removeEventListener("click", onClick, true);
    if (observer) observer.disconnect();
    observer = null;
    const style = byId(STYLE_ID);
    if (style) style.remove();
    restoreSettings();
    document.documentElement.classList.remove("fs-host-sidebar");
    host = null;
  }

  function toggleClass(node, name, on) {
    if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on);
  }

  function setLayout(layout) {
    toggleClass(document.documentElement, "fs-host-sidebar", layout.sidebarVisible === true);
    toggleClass(byId("app"), "sidebar-collapsed", layout.collapsed === true);
  }

  function act(action) {
    const id = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    const button = id ? byId(id) : null;
    if (button) button.click();
  }

  function originalConversationId(id) {
    return store.conversations.find(row => row.id === id)?.id ??
      store.conversations.find(row => typeof row.id === "number" && String(row.id) === id)?.id ?? id;
  }

  function run(task) {
    Promise.resolve().then(task).catch(error => console.error("Coque Svelte : action impossible", error));
  }

  // La recherche de la coque est recopiée dans le champ historique (masqué) : la recherche sur le serveur
  // (remote-chat-search.js, délai de 350 ms) et le filtre local historique réagissent alors comme avant.
  function search(query) {
    const input = byId("search-input");
    const value = String(query || "");
    if (!input || input.value === value) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Saisie en cours de composition (clavier japonais, etc.) : l'ancienne recherche distante attend la fin.
  function composition(active) {
    const input = byId("search-input");
    if (input) input.dispatchEvent(new CompositionEvent(active ? "compositionstart" : "compositionend", { bubbles: true }));
  }

  function archiveRow(chatId) {
    return Array.from(document.querySelectorAll(".archived-chats-panel .archived-chat-row")).find(row => row.dataset.chatId === chatId) || null;
  }

  function clickIn(chatId, index) {
    const row = archiveRow(chatId);
    const buttons = row ? row.querySelectorAll("button") : [];
    if (buttons[index]) buttons[index].click();
  }

  window.__fsEngine = {
    attach,
    detach,
    snapshot,
    matches,
    setLayout,
    act,
    closeMenus: () => closeMenus(),
    openConversation: id => run(() => openConversation(originalConversationId(id))),
    togglePin: id => run(() => togglePin(originalConversationId(id))),
    renameConversation: id => run(() => renameConversation(originalConversationId(id))),
    deleteConversation: id => run(() => deleteConversation(originalConversationId(id))),
    // Appelle directement la fonction historique : l'entrée « Archiver » de l'ancien menu lit `menuConversationId`,
    // que seul l'ancien menu renseigne.
    archiveConversation: id => run(() => archiveConversation(originalConversationId(id))),
    search,
    composition,
    toggleArchive: () => {
      const toggle = document.querySelector(".archived-chat-toggle");
      if (toggle) toggle.click();
    },
    restoreArchived: chatId => clickIn(chatId, 0),
    downloadArchived: chatId => clickIn(chatId, 1),
    moreArchived: () => {
      const more = document.querySelector(".archived-chats-panel > button");
      if (more && !more.disabled) more.click();
    },
    openRemote: index => {
      const buttons = document.querySelectorAll(".remote-chat-search-result");
      if (buttons[index]) buttons[index].click();
    }
  };
})();
