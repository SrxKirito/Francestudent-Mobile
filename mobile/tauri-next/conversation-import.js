"use strict";

// Import of a public ChatGPT conversation.
// Contract (docs/api-audit/openapi.json): POST /conversation-imports/openai
// takes the JSON body {link, model} (two non-empty strings) and returns chatId,
// title, source, sourceConversationId, sourceModel, localModel,
// importedMessagesCount and importedAt. The service accepts a public link of the
// form /share/{uuid}. No other endpoint is used: the imported messages are read
// afterwards through the existing conversation loading (GET /chats/{chatId}).
// The POST is sent once per submit, never retried, and one at a time. A link that
// was already imported on this device opens the existing conversation instead.
(() => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const state = { importing: false, generation: 0, session: "" };
  const ui = {};

  function parseShareLink(value) {
    const text = String(value || "").trim();
    let url;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const match = /^\/share\/([^/]+)\/?$/.exec(url.pathname);
    if (!match || !UUID.test(match[1])) return null;
    return { link: text, shareId: match[1].toLowerCase() };
  }

  function usableAgents() {
    return (typeof agents !== "undefined" && Array.isArray(agents) ? agents : [])
      .filter(agent => agent && agent.available && typeof agent.model === "string" && agent.model.trim() !== "");
  }

  function setStatus(message, isError) {
    ui.status.textContent = message;
    ui.status.classList.toggle("is-error", isError === true);
  }

  function fillModels() {
    const list = usableAgents();
    ui.model.replaceChildren();
    for (const agent of list) {
      const option = document.createElement("option");
      option.value = String(agent.id);
      option.textContent = agentLabel(agent) + (agent.provider ? " · " + agent.provider : "");
      ui.model.append(option);
    }
    if (list.some(agent => agent.id === store.agentId)) ui.model.value = String(store.agentId);
    return list.length;
  }

  function selectedAgent() {
    const id = Number(ui.model.value);
    return usableAgents().find(agent => agent.id === id) || null;
  }

  function syncControls() {
    const hasModels = ui.model.options.length > 0;
    ui.link.disabled = state.importing;
    ui.model.disabled = state.importing || !hasModels;
    ui.submit.disabled = state.importing || !hasModels;
    ui.close.disabled = state.importing;
  }

  function findExisting(shareId) {
    return store.conversations.find(conversation => {
      const origin = conversation.importedFrom;
      if (!origin || (origin.shareId !== shareId && origin.sourceConversationId !== shareId)) return false;
      // A hidden locked conversation is never revealed or reused.
      return !(typeof lockedChatIsHidden === "function" && lockedChatIsHidden(conversation));
    }) || null;
  }

  async function openConversationSafely(conversation) {
    if (busy) {
      showToast("Conversation importée. Ouvre-la depuis l’historique quand la réponse en cours sera terminée.");
      return;
    }
    await openConversation(conversation.id);
  }

  async function errorDetail(response) {
    let text = "";
    try { text = await response.text(); } catch {}
    try {
      const data = JSON.parse(text);
      const value = [data?.message, data?.detail, data?.error, data?.title].find(item => typeof item === "string" && item.trim());
      return value ? value.trim().slice(0, 200) : "";
    } catch {
      return "";
    }
  }

  function describeFailure(error) {
    const status = error?.status;
    const detail = error?.detail ? " (" + error.detail + ")" : "";
    if (status === 400 || status === 422) return "Le serveur a refusé ce lien ou ce modèle" + detail + ". Vérifie que le lien est un lien de partage public ChatGPT.";
    if (status === 401) return "Session expirée. Reconnecte-toi puis réessaie.";
    if (status === 403) return "Import non autorisé pour ce compte" + detail + ".";
    if (status === 404) return "Conversation introuvable" + detail + ". Vérifie que le lien de partage est public.";
    if (status === 429) return error.message;
    if (status >= 500) return "Le serveur est momentanément indisponible. Vérifie ton historique avant de réessayer : l’import a peut-être abouti.";
    if (status) return "Import impossible (HTTP " + status + ")" + detail + ".";
    if (error?.unexpected) return error.message;
    return "Connexion impossible : " + (error?.message || "erreur inconnue") + ". Vérifie ton historique avant de réessayer : l’import a peut-être abouti.";
  }

  function recordImport(data, agent, parsed) {
    let conversation = store.conversations.find(item => item.chatId === data.chatId);
    if (!conversation) {
      conversation = {
        id: makeId(),
        chatId: data.chatId,
        projectId: null,
        title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 100) : "Conversation importée",
        agentId: agent.id,
        messages: [],
        updatedAt: Date.now(),
        pinned: false,
        needsLoad: true
      };
      store.conversations.push(conversation);
    }
    conversation.importedFrom = {
      source: typeof data.source === "string" ? data.source : "openai",
      sourceConversationId: typeof data.sourceConversationId === "string" ? data.sourceConversationId.toLowerCase() : parsed.shareId,
      shareId: parsed.shareId
    };
    return conversation;
  }

  async function submit() {
    if (state.importing) return;
    const session = store.session;
    if (!session) { setStatus("Connecte-toi pour importer une conversation.", true); return; }
    const parsed = parseShareLink(ui.link.value);
    if (!parsed) { setStatus("Saisis un lien public ChatGPT de la forme https://…/share/{identifiant}.", true); return; }
    const agent = selectedAgent();
    if (!agent) { setStatus("Choisis un modèle disponible.", true); return; }

    const existing = findExisting(parsed.shareId);
    if (existing) {
      if (existing.serverArchived) { setStatus("Cette conversation a déjà été importée, mais elle est archivée. Restaure-la depuis les conversations archivées.", true); return; }
      closeDialog();
      showToast("Cette conversation a déjà été importée : ouverture de la conversation existante.");
      await openConversationSafely(existing);
      return;
    }

    const generation = state.generation;
    state.importing = true;
    setStatus("Import en cours…");
    syncControls();
    let imported = null;
    try {
      const response = await apiFetch("/conversation-imports/openai", { method: "POST", body: JSON.stringify({ link: parsed.link, model: agent.model }) });
      if (!response?.ok) {
        const error = new Error("HTTP " + (response?.status || "indisponible"));
        error.status = response?.status;
        error.detail = response ? await errorDetail(response) : "";
        throw error;
      }
      const data = await response.json().catch(() => null);
      if (!data || typeof data.chatId !== "string" || !UUID.test(data.chatId)) {
        const error = new Error("Réponse inattendue du serveur. Vérifie ton historique avant de réessayer : l’import a peut-être abouti.");
        error.unexpected = true;
        void syncConversationsFromServer();
        throw error;
      }
      if (session !== store.session) return;
      imported = { conversation: recordImport(data, agent, parsed), count: Number.isInteger(data.importedMessagesCount) ? data.importedMessagesCount : null };
      saveStore();
      renderHistory();
    } catch (error) {
      if (generation === state.generation && session === store.session) setStatus(describeFailure(error), true);
      return;
    } finally {
      state.importing = false;
      if (generation === state.generation && ui.dialog.open) syncControls();
    }
    if (generation === state.generation) closeDialog();
    showToast("Conversation importée" + (imported.count !== null ? " (" + imported.count + " message" + (imported.count > 1 ? "s" : "") + ")" : "") + ".");
    await openConversationSafely(imported.conversation);
  }

  function closeDialog() {
    state.generation++;
    state.session = "";
    ui.link.value = "";
    ui.status.textContent = "";
    if (ui.dialog.open) ui.dialog.close();
  }

  function openDialog() {
    if (!store.session) { showToast("Connecte-toi pour importer une conversation.", true); return; }
    if (ui.dialog.open) return;
    state.generation++;
    state.session = store.session;
    ui.link.value = "";
    const count = fillModels();
    syncControls();
    setStatus(count ? "" : "Aucun modèle disponible pour l’import pour le moment.", !count);
    ui.dialog.showModal();
    ui.link.focus();
  }

  function setup() {
    const anchor = document.getElementById("library-open");
    if (!anchor || ui.dialog) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "conversation-import-open";
    button.className = "side-nav-item";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⇩";
    const label = document.createElement("span");
    label.textContent = "Importer une conversation";
    button.append(icon, label);
    anchor.after(button);

    const dialog = document.createElement("dialog");
    dialog.className = "project-editor conversation-import-dialog";
    dialog.setAttribute("aria-label", "Importer une conversation");
    const form = document.createElement("form");
    form.className = "conversation-import-body";
    form.noValidate = true;
    const heading = document.createElement("h2");
    heading.textContent = "Importer une conversation";
    const hint = document.createElement("p");
    hint.className = "settings-hint";
    hint.textContent = "Colle le lien d’une conversation ChatGPT partagée publiquement. Elle sera importée dans ton compte avec le modèle choisi.";
    const linkLabel = document.createElement("label");
    linkLabel.textContent = "Lien de partage";
    const link = document.createElement("input");
    link.type = "text";
    link.className = "settings-input";
    link.placeholder = "https://chatgpt.com/share/…";
    link.autocomplete = "off";
    link.spellcheck = false;
    link.inputMode = "url";
    link.maxLength = 2048;
    linkLabel.append(link);
    const modelLabel = document.createElement("label");
    modelLabel.textContent = "Modèle";
    const model = document.createElement("select");
    model.className = "settings-input";
    modelLabel.append(model);
    const status = document.createElement("p");
    status.className = "settings-hint conversation-import-status";
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "conversation-import-actions";
    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className = "settings-btn primary";
    submitButton.textContent = "Importer";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "settings-btn";
    close.textContent = "Fermer";
    actions.append(close, submitButton);
    form.append(heading, hint, linkLabel, modelLabel, status, actions);
    dialog.append(form);
    document.body.append(dialog);
    Object.assign(ui, { button, dialog, link, model, status, submit: submitButton, close });

    button.addEventListener("click", () => {
      if (typeof closeSidebar === "function") closeSidebar();
      openDialog();
    });
    form.addEventListener("submit", event => { event.preventDefault(); void submit(); });
    close.addEventListener("click", () => { if (!state.importing) closeDialog(); });
    dialog.addEventListener("cancel", event => { if (state.importing) event.preventDefault(); });
    dialog.addEventListener("close", () => { if (!state.importing) { state.generation++; ui.link.value = ""; } });
    document.getElementById("logout")?.addEventListener("click", closeDialog);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
