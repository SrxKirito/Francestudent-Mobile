"use strict";

// Locked Chats — interface: sidebar entry, PIN dialog, locked-chat navigation,
// conversation menu entry and account settings. All network calls go through
// window.FranceStudentLockedChats (locked-chats.js), hence through apiFetch.
(function setupLockedChatsUi() {
  const api = typeof window !== "undefined" ? window.FranceStudentLockedChats : null;
  if (!api) return;

  const ui = {
    toggle: null, badge: null, panel: null, status: null, list: null, closeButton: null,
    menuItem: null, settings: null, settingsHint: null, settingsButtons: {}, dialog: null, busy: false
  };
  // Above the settings window (settings.css / modern.css) and the startup screen,
  // below the document preview (12000).
  const PIN_OVERLAY_Z_INDEX = "10001";
  const PIN_PATTERN = /^[0-9]{4}$/;
  const SHACKLE_CLOSED = "M8 11V7a4 4 0 0 1 8 0v4";
  const SHACKLE_OPEN = "M8 11V7a4 4 0 0 1 7.75-1.4";
  const coarsePointer = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const errorText = error => String(error?.message || error || "Erreur inconnue");

  function lockIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path class="locked-chats-shackle" d="' + SHACKLE_CLOSED + '"/></svg>';
  }

  // ---------------------------------------------------------------------------
  // PIN dialog
  // ---------------------------------------------------------------------------

  // Opens a modal PIN dialog. `submit(pin)` may throw: its message is displayed
  // and the dialog stays open. Resolves to true on success, false on cancel.
  function askPin({ title, description = "", confirmLabel = "Valider", submit }) {
    if (ui.dialog) ui.dialog.cancel();
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = document.createElement("div");
      overlay.className = "locked-pin-overlay";
      overlay.style.zIndex = PIN_OVERLAY_Z_INDEX;
      const dialog = document.createElement("div");
      dialog.className = "locked-pin-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.tabIndex = -1;
      const titleId = "locked-pin-title-" + Date.now();
      dialog.setAttribute("aria-labelledby", titleId);

      const heading = document.createElement("h2");
      heading.className = "locked-pin-title";
      heading.id = titleId;
      heading.textContent = title;
      const text = document.createElement("p");
      text.className = "locked-pin-description";
      text.textContent = description;

      const input = document.createElement("input");
      input.className = "locked-pin-input";
      input.type = "password";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.maxLength = 4;
      input.spellcheck = false;
      input.setAttribute("pattern", "[0-9]*");
      input.setAttribute("aria-label", "Code PIN (4 chiffres)");
      // On touch screens the keypad replaces the system keyboard.
      if (coarsePointer()) {
        input.readOnly = true;
        input.inputMode = "none";
      }

      const error = document.createElement("p");
      error.className = "locked-pin-error";
      error.setAttribute("role", "alert");
      error.setAttribute("aria-live", "assertive");

      const keypad = document.createElement("div");
      keypad.className = "locked-pin-keypad";
      keypad.setAttribute("role", "group");
      keypad.setAttribute("aria-label", "Pavé numérique");
      const addKey = (label, value, secondary, aria) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "locked-pin-key" + (secondary ? " locked-pin-key-secondary" : "");
        button.textContent = label;
        button.dataset.key = value;
        if (aria) button.setAttribute("aria-label", aria);
        keypad.appendChild(button);
      };
      for (const digit of "123456789") addKey(digit, digit);
      addKey("Effacer", "clear", true, "Effacer tout le code");
      addKey("0", "0");
      addKey("⌫", "back", true, "Supprimer le dernier chiffre");

      const actions = document.createElement("div");
      actions.className = "locked-pin-actions";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "locked-pin-btn";
      cancelButton.textContent = "Annuler";
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "locked-pin-btn primary";
      confirmButton.textContent = confirmLabel;
      actions.append(cancelButton, confirmButton);

      dialog.append(heading, text, input, error, keypad, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let finished = false;
      let pending = false;

      const sync = () => {
        confirmButton.disabled = pending || !PIN_PATTERN.test(input.value);
      };
      const setValue = value => {
        input.value = value.replace(/\D/g, "").slice(0, 4);
        sync();
      };
      const setPending = value => {
        pending = value;
        dialog.classList.toggle("busy", value);
        dialog.setAttribute("aria-busy", String(value));
        for (const button of dialog.querySelectorAll("button")) button.disabled = value;
        if (!value) sync();
      };
      const showError = message => {
        error.textContent = message;
        dialog.classList.remove("has-error");
        void dialog.offsetWidth; // restart the shake animation
        dialog.classList.add("has-error");
      };

      function finish(result) {
        if (finished) return;
        finished = true;
 document.removeEventListener("keydown", onKeydown, true);
        if (ui.dialog?.overlay === overlay) ui.dialog = null;
        input.value = "";
        overlay.classList.remove("open");
        setTimeout(() => overlay.remove(), 220);
        if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
   previousFocus.focus();
        }
 resolve(result);
      }

      async function submitPin() {
        if (pending || finished) return;
        const pin = input.value;
        if (!PIN_PATTERN.test(pin)) {
   showError("Le code doit contenir exactement 4 chiffres.");
          return;
 }
        setPending(true);
        error.textContent = "";
        try {
   await submit(pin);
   finish(true);
        } catch (failure) {
   if (finished) return;
          setPending(false);
   setValue("");
          showError(failure?.status === 401 || failure?.status === 403 ? "Code PIN incorrect." : errorText(failure));
          if (!input.readOnly) input.focus();
        }
      }

      function onKeydown(event) {
        if (finished) return;
 if (event.key === "Escape") {
   event.preventDefault();
   if (!pending) finish(false);
   return;
        }
 if (event.key === "Tab") {
          const focusable = [...dialog.querySelectorAll("button:not(:disabled), input:not([readonly])")];
   if (!focusable.length) return;
   const first = focusable[0];
          const last = focusable[focusable.length - 1];
   if (event.shiftKey && document.activeElement === first) {
     event.preventDefault();
     last.focus();
   } else if (!event.shiftKey && document.activeElement === last) {
     event.preventDefault();
     first.focus();
   }
   return;
        }
 if (pending || (event.target === input && !input.readOnly)) return;
 if (/^[0-9]$/.test(event.key)) {
   event.preventDefault();
   setValue(input.value + event.key);
        } else if (event.key === "Backspace") {
   event.preventDefault();
   setValue(input.value.slice(0, -1));
        } else if (event.key === "Enter" && event.target?.tagName !== "BUTTON") {
   event.preventDefault();
   void submitPin();
 }
      }

      input.addEventListener("input", () => setValue(input.value));
      input.addEventListener("keydown", event => {
 if (event.key === "Enter") {
   event.preventDefault();
   void submitPin();
 }
      });
      keypad.addEventListener("click", event => {
        const button = event.target.closest?.(".locked-pin-key");
        if (!button || pending) return;
        const value = button.dataset.key;
        if (value === "clear") setValue("");
        else if (value === "back") setValue(input.value.slice(0, -1));
        else setValue(input.value + value);
        dialog.classList.remove("has-error");
      });
      cancelButton.addEventListener("click", () => { if (!pending) finish(false); });
      confirmButton.addEventListener("click", () => { void submitPin(); });
      overlay.addEventListener("click", event => {
 if (event.target === overlay && !pending) finish(false);
      });
      document.addEventListener("keydown", onKeydown, true);

      ui.dialog = { overlay, cancel: () => finish(false) };
      sync();
      requestAnimationFrame(() => {
        overlay.classList.add("open");
        (input.readOnly ? dialog : input).focus();
      });
    });
  }

  // Asks for a new PIN twice, then calls `save(pin)`.
  async function askNewPin({ title, intro, save }) {
    let first = "";
    const chosen = await askPin({
      title,
      description: intro,
      confirmLabel: "Continuer",
      submit: async pin => { first = pin; }
    });
    if (!chosen) return false;
    try {
      return await askPin({
        title,
 description: "Saisis le même code pour confirmer.",
 confirmLabel: "Enregistrer",
        submit: async pin => {
          if (pin !== first) throw new Error("Les deux codes ne correspondent pas.");
   await save(pin);
 }
      });
    } finally {
      first = "";
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function run(task) {
    if (ui.busy) return undefined;
    ui.busy = true;
    if (ui.toggle) ui.toggle.setAttribute("aria-busy", "true");
    try {
      return await task();
    } finally {
      ui.busy = false;
      if (ui.toggle) ui.toggle.removeAttribute("aria-busy");
      render();
    }
  }

  async function refreshStatus() {
    if (!store.session) throw new Error("Connecte-toi pour utiliser les conversations verrouillées.");
    return api.getStatus();
  }

  async function createPinFlow() {
    const created = await askNewPin({
      title: "Créer un code PIN",
      intro: "Ce code (4 chiffres) protège tes conversations verrouillées.",
      save: pin => api.createPin(pin)
    });
    if (created) showToast("Code PIN créé.");
    return created;
  }

  async function unlockFlow() {
    const opened = await askPin({
      title: "Conversations verrouillées",
      description: "Saisis ton code PIN pour afficher tes conversations verrouillées.",
      confirmLabel: "Déverrouiller",
      submit: pin => api.openAccess(pin)
    });
    if (opened) {
      setPanel(true);
      // openAccess already refreshed the list; show a clear state if it failed.
      if (!api.state().loaded) setStatus("Liste indisponible.");
    }
    return opened;
  }

  function onToggleClick() {
    void run(async () => {
      if (api.state().accessOpen) {
        setPanel(ui.panel.hidden);
        return;
      }
      let state;
      try {
        state = await refreshStatus();
      } catch (error) {
        showToast("Conversations verrouillées indisponibles : " + errorText(error), true);
        return;
      }
      if (state.accessOpen) {
        setPanel(true);
 try { await api.list(); }
 catch (error) { setStatus("Chargement impossible : " + errorText(error)); }
        return;
      }
      if (!state.hasPin) {
 if (await createPinFlow()) { if (api.state().accessOpen) setPanel(true); else await unlockFlow(); }
 return;
      }
      await unlockFlow();
    });
  }

  function closeAccessNow() {
    void run(async () => {
      await api.closeAccess();
      setPanel(false);
      showToast("Conversations verrouillées masquées.");
    });
  }

  async function toggleConversationLock(localId) {
    const conversation = store.conversations.find(item => item.id === localId);
    if (!conversation) return;
    if (!conversation.chatId) {
      showToast("Cette conversation n’est pas encore enregistrée sur le serveur.", true);
      return;
    }
    if (busy || conversation.pendingResponse) {
      showToast("Termine ou annule la réponse en cours d’abord.", true);
      return;
    }
    await run(async () => {
      try {
 if (api.isChatLocked(conversation.chatId)) {
   const question = "Déverrouiller définitivement « " + (conversation.title || "Sans titre") + " » ? Elle réapparaîtra dans l’historique normal.";
   if (!window.confirm(question)) return;
   await api.unlockChat(conversation.chatId);
          showToast("Conversation déverrouillée.");
          return;
 }
        let state = api.state();
        if (state.hasPin === null) state = await refreshStatus();
 if (!state.hasPin && !(await createPinFlow())) return;
        if (!api.state().accessOpen && !(await unlockFlow())) return;
        await api.lockChat(conversation.chatId);
        showToast(api.state().accessOpen ? "Conversation verrouillée." : "Conversation verrouillée et masquée.");
      } catch (error) {
 showToast("Opération impossible : " + errorText(error), true);
      }
    });
  }

  function unlockFromPanel(conversation, button) {
    if (!window.confirm("Déverrouiller définitivement « " + (conversation.title || "Sans titre") + " » ?")) return;
    button.disabled = true;
    void run(async () => {
      try {
 await api.unlockChat(conversation.chatId);
        showToast("Conversation déverrouillée.");
      } catch (error) {
        setStatus("Déverrouillage impossible : " + errorText(error));
 button.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function setStatus(message) {
    if (ui.status) ui.status.textContent = message || "";
  }

  function setPanel(open) {
    if (!ui.panel) return;
    ui.panel.hidden = !open;
    ui.toggle.setAttribute("aria-expanded", String(open));
    renderPanel();
  }

  function renderPanel() {
    if (!ui.panel || ui.panel.hidden) return;
    const state = api.state();
    if (!state.accessOpen) {
      ui.panel.hidden = true;
      ui.toggle.setAttribute("aria-expanded", "false");
      return;
    }
    const conversations = state.lockedIds
      .map(chatId => store.conversations.find(item => item.chatId === chatId))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    ui.list.replaceChildren();
    for (const conversation of conversations) {
      const row = document.createElement("div");
      row.className = "archived-chat-row locked-chat-row";
      row.dataset.chatId = conversation.chatId;
      const title = document.createElement("span");
      title.textContent = conversation.title || "Sans titre";
      if (conversation.id === currentId) title.setAttribute("aria-current", "page");
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "Ouvrir";
      open.setAttribute("aria-label", "Ouvrir " + title.textContent);
      open.addEventListener("click", () => { void openConversation(conversation.id); });
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.textContent = "Déverrouiller";
      unlock.setAttribute("aria-label", "Déverrouiller définitivement " + title.textContent);
      unlock.addEventListener("click", () => unlockFromPanel(conversation, unlock));
      row.append(title, open, unlock);
      ui.list.appendChild(row);
    }
    if (!state.loaded) setStatus(ui.busy ? "Chargement…" : "Liste indisponible.");
    else setStatus(conversations.length ? "" : "Aucune conversation verrouillée.");
  }

  function render() {
    const state = api.state();
    if (ui.toggle) {
      ui.toggle.classList.toggle("is-open", state.accessOpen);
      ui.toggle.querySelector(".locked-chats-shackle")?.setAttribute("d", state.accessOpen ? SHACKLE_OPEN : SHACKLE_CLOSED);
      ui.toggle.title = state.accessOpen ? "Conversations verrouillées (accès ouvert)" : "Conversations verrouillées";
      if (!state.accessOpen) ui.toggle.setAttribute("aria-expanded", "false");
      // The count is only revealed while access is open.
      const count = state.accessOpen ? state.lockedIds.length : 0;
      ui.badge.hidden = !count;
      ui.badge.textContent = String(count);
    }
    renderPanel();
    if (ui.settings) {
      const known = state.hasPin !== null;
      ui.settingsHint.textContent = !store.session ? "Connecte-toi pour gérer le code PIN."
 : !known ? "État du code PIN non chargé."
        : state.hasPin ? "Un code PIN protège tes conversations verrouillées."
        : "Aucun code PIN défini.";
      ui.settingsButtons.create.hidden = !known || state.hasPin;
      ui.settingsButtons.change.hidden = !state.hasPin;
      ui.settingsButtons.reset.hidden = true;
      ui.settingsButtons.lockNow.hidden = !state.accessOpen;
    }
  }

  // ---------------------------------------------------------------------------
  // Mounting
  // ---------------------------------------------------------------------------

  // La catégorie « Conversations verrouillées » de la barre latérale et l'entrée
  // « Verrouiller » du menu ⋯ d'une conversation ne sont plus montées.
  function mountSettings() {
    const panel = document.getElementById("panel-account");
    if (!panel || ui.settings) return;
    const section = document.createElement("section");
    section.className = "locked-chats-settings";
    section.setAttribute("aria-label", "Conversations verrouillées");
    const heading = document.createElement("h3");
    heading.className = "settings-section-title";
    heading.textContent = "Conversations verrouillées";
    const hint = document.createElement("p");
    hint.className = "settings-hint";
    hint.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "locked-chats-settings-actions";
    const addButton = (text, extra, handler) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "settings-btn small" + (extra ? " " + extra : "");
      element.textContent = text;
      element.hidden = true;
      element.addEventListener("click", () => { void run(handler); });
      actions.appendChild(element);
      return element;
    };

    const create = addButton("Créer un code PIN", "", async () => {
      try {
        await refreshStatus();
        if (!api.state().hasPin) await createPinFlow();
      } catch (error) {
 showToast(errorText(error), true);
      }
    });
    const change = addButton("Changer le code PIN", "", async () => {
      let current = "";
      const entered = await askPin({
        title: "Changer le code PIN",
        description: "Saisis ton code PIN actuel.",
        confirmLabel: "Continuer",
 submit: async pin => { current = pin; }
      });
      if (!entered) return;
      try {
        const changed = await askNewPin({
   title: "Nouveau code PIN",
          intro: "Choisis un nouveau code (4 chiffres).",
   save: pin => api.changePin(current, pin)
        });
 if (changed) showToast("Code PIN modifié.");
      } finally {
        current = "";
      }
    });
    const reset = addButton("Réinitialiser le code PIN", "danger", async () => {
      const question = "Réinitialiser le code PIN supprimerait définitivement toutes les conversations verrouillées. Cette action est indisponible.";
      if (!window.confirm(question)) return;
      const done = await askPin({
 title: "Réinitialiser le code PIN",
        description: "Confirme avec ton code PIN actuel.",
        confirmLabel: "Réinitialiser",
        submit: pin => api.removePin(pin)
      });
      if (done) {
 setPanel(false);
        showToast("Code PIN réinitialisé.");
      }
    });
    const lockNow = addButton("Verrouiller maintenant", "", async () => {
      await api.closeAccess();
      setPanel(false);
    });

    section.append(heading, hint, actions);
    const before = panel.querySelector(".settings-actions");
    if (before) before.parentElement.insertBefore(section, before);
    else panel.appendChild(section);
    Object.assign(ui, { settings: section, settingsHint: hint, settingsButtons: { create, change, reset, lockNow } });
    // Refresh the PIN state when the account panel is displayed.
    document.getElementById("user-button")?.addEventListener("click", () => {
      if (store.session && !ui.busy) api.getStatus().catch(() => {}).finally(render);
    });
  }

  // Locked conversations are loaded with the normal bearer token; if the server
  // refuses because access expired, resynchronise the status (which hides them).
  function wrapOpenConversation() {
    const previousOpen = openConversation;
    openConversation = async function(id) {
      const result = await previousOpen(id);
      const conversation = store.conversations.find(item => item.id === id);
      const loadFailed = currentId === id
        && conversation?.chatId
        && !conversation.pendingResponse
        && api.isChatLocked(conversation.chatId)
        && conversation.needsLoad
        && !conversation.messages?.length;
      if (loadFailed) {
        try {
          const state = await api.getStatus();
          if (!state.accessOpen) showToast("Accès aux conversations verrouillées expiré : saisis à nouveau ton code PIN.", true);
          else showToast("Chargement de la conversation verrouillée impossible.", true);
        } catch {
          // Status unavailable: the normal error handling of openConversation applies.
 }
      }
      renderPanel();
      return result;
    };
  }

  function onLogout() {
    if (ui.dialog) ui.dialog.cancel();
    if (ui.panel) {
      ui.panel.hidden = true;
      ui.list.replaceChildren();
      setStatus("");
    }
    void api.closeAccess({ silent: true }).finally(render);
  }

  function mount() {
    mountSettings();
    wrapOpenConversation();
    document.getElementById("logout")?.addEventListener("click", onLogout);
    // Never leave a half-filled PIN prompt when the app goes to the background
    // (locked-chats.js closes access at the same moment).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && ui.dialog) ui.dialog.cancel();
    });
    window.addEventListener("francestudent:locked-chats", () => {
      if (!api.state().accessOpen && ui.panel) ui.panel.hidden = true;
      render();
    });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
