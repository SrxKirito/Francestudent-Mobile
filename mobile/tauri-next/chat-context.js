"use strict";

// Context usage and manual compaction of a chat.
// Contract (docs/api-audit/openapi.json): GET and POST /chats/{chatId}/context
// both return ChatContextUsageDto and take no request body. The POST is reserved
// to the owner of the chat: 409 means a generation is running or the chat is
// empty, 422 means the model is not compatible.
// The compaction is never automatic: it is sent once per explicit confirmation
// made in the dialog, it is never retried, and local messages are never changed.
// Requests go through apiFetch, so locked chats keep requiring their access token.
(() => {
  const LABELS = {
    system_prompt: "Instructions système",
    tools: "Outils",
    rules: "Règles",
    skills: "Compétences",
    mcp: "MCP",
    conversation: "Conversation"
  };
  const numbers = new Intl.NumberFormat("fr-FR");
  const state = { generation: 0, request: 0, chatId: "", conversationId: "", session: "", compacting: false, usage: null };
  const ui = {};

  function validChatId(id) {
    return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  function tokenCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  function formatTokens(value) {
    return numbers.format(value) + " tokens";
  }

  function parseUsage(data) {
    const used = tokenCount(data?.usedTokens);
    if (!data || typeof data !== "object" || used === null) throw new Error("Réponse inattendue du serveur.");
    const windowSize = tokenCount(data.contextWindow);
    const free = tokenCount(data.freeTokens);
    // The percentage is computed from the window when it is known, so the scale
    // of usagePercent never has to be guessed.
    let percent = null;
    if (windowSize) percent = used / windowSize * 100;
    else if (typeof data.usagePercent === "number" && Number.isFinite(data.usagePercent)) percent = data.usagePercent;
    const categories = Array.isArray(data.categories)
      ? data.categories.filter(item => item && typeof item.key === "string" && tokenCount(item.tokens) !== null).map(item => ({ key: item.key, tokens: tokenCount(item.tokens) }))
      : [];
    return {
      modelName: typeof data.modelName === "string" && data.modelName ? data.modelName : typeof data.model === "string" ? data.model : "",
      contextWindow: windowSize,
      used,
      free,
      percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
      threshold: tokenCount(data.compactThreshold),
      measured: data.measured === true,
      categories
    };
  }

  function currentConversation() {
    return store.conversations.find(item => item.id === state.conversationId) || null;
  }

  // Returns the reason why the chat cannot be queried, or an empty string.
  function blockedReason(conversation, forCompaction) {
    if (!conversation) return "Conversation introuvable.";
    if (!store.session) return "Connecte-toi pour consulter le contexte.";
    if (!validChatId(conversation.chatId)) return "Cette conversation n’est pas encore enregistrée sur le serveur.";
    if (typeof lockedChatIsHidden === "function" && lockedChatIsHidden(conversation)) return "Conversation verrouillée : saisis ton code PIN pour y accéder.";
    if (forCompaction && (busy || conversation.pendingResponse)) return "Attends la fin de la réponse en cours, ou annule-la, avant de compacter.";
    return "";
  }

  function describeError(error, compaction) {
    const status = error?.status;
    if (status === 423) return "Conversation verrouillée : saisis ton code PIN pour y accéder.";
    if (status === 401) return "Session expirée. Reconnecte-toi puis réessaie.";
    if (status === 403) return "Accès refusé par le serveur.";
    if (status === 404) return "Conversation introuvable sur le serveur.";
    if (status === 409 && compaction) return "Compaction impossible : une réponse est en cours de génération ou la conversation est vide. Réessaie quand la réponse est terminée.";
    if (status === 422 && compaction) return "Compaction impossible : le modèle de cette conversation n’est pas compatible avec la compaction.";
    if (status === 429) return "Trop de requêtes. Réessaie dans quelques instants.";
    if (status >= 500) return "Le serveur est momentanément indisponible. Réessaie plus tard.";
    if (status) return "Opération impossible (HTTP " + status + ").";
    return "Connexion impossible : " + (error?.message || "erreur inconnue");
  }

  async function requestContext(method) {
    const response = await apiFetch("/chats/" + encodeURIComponent(state.chatId) + "/context", { method });
    if (!response?.ok) {
      try { await response?.body?.cancel(); } catch {}
      const error = new Error("HTTP " + (response?.status || "indisponible"));
      error.status = response?.status;
      throw error;
    }
    return parseUsage(await response.json());
  }

  function active(generation) {
    return generation === state.generation && state.session === store.session && !!store.session && ui.dialog.open;
  }

  function setStatus(message, isError) {
    ui.status.textContent = message;
    ui.status.classList.toggle("is-error", isError === true);
  }

  function row(label, value) {
    const line = document.createElement("div");
    line.className = "chat-context-row";
    const name = document.createElement("span");
    name.textContent = label;
    const amount = document.createElement("strong");
    amount.textContent = value;
    line.append(name, amount);
    return line;
  }

  function renderUsage(usage) {
    state.usage = usage;
    ui.details.replaceChildren();
    ui.bar.hidden = usage.percent === null;
    if (usage.percent !== null) {
      ui.barFill.style.width = usage.percent.toFixed(1) + "%";
      ui.bar.setAttribute("aria-valuenow", String(Math.round(usage.percent)));
    }
    if (usage.modelName) ui.details.append(row("Modèle", usage.modelName));
    ui.details.append(row("Utilisé", formatTokens(usage.used) + (usage.percent !== null ? " (" + usage.percent.toFixed(usage.percent < 10 ? 1 : 0) + " %)" : "")));
    if (usage.free !== null) ui.details.append(row("Disponible", formatTokens(usage.free)));
    if (usage.contextWindow !== null) ui.details.append(row("Fenêtre de contexte", formatTokens(usage.contextWindow)));
    if (usage.threshold !== null) ui.details.append(row("Seuil de compaction", formatTokens(usage.threshold)));
    for (const category of usage.categories) ui.details.append(row(LABELS[category.key] || category.key, formatTokens(category.tokens)));
    ui.note.textContent = usage.measured ? "" : "Valeurs estimées : elles seront mesurées après un prochain échange avec le modèle.";
    ui.note.hidden = usage.measured;
  }

  function syncControls() {
    const conversation = currentConversation();
    const loading = state.request > 0;
    const blocked = !!blockedReason(conversation, true);
    ui.refresh.disabled = loading || state.compacting;
    ui.compact.disabled = loading || state.compacting || blocked || !state.usage;
    ui.confirmYes.disabled = loading || state.compacting || blocked;
    ui.confirmNo.disabled = state.compacting;
  }

  function hideConfirmation() {
    ui.confirm.hidden = true;
    ui.compact.hidden = false;
  }

  async function loadUsage() {
    const generation = state.generation;
    const conversation = currentConversation();
    const reason = blockedReason(conversation, false);
    if (reason) { setStatus(reason, true); syncControls(); return; }
    state.request++;
    setStatus("Chargement du contexte…");
    syncControls();
    try {
      const usage = await requestContext("GET");
      if (!active(generation)) return;
      renderUsage(usage);
      setStatus("");
    } catch (error) {
      if (!active(generation)) return;
      setStatus(describeError(error, false), true);
    } finally {
      state.request--;
      if (active(generation)) syncControls();
    }
  }

  async function compact() {
    // Single flight: a second confirmation cannot start another POST.
    if (state.compacting) return;
    const generation = state.generation;
    const conversation = currentConversation();
    const reason = blockedReason(conversation, true);
    if (reason) { hideConfirmation(); setStatus(reason, true); syncControls(); return; }
    state.compacting = true;
    hideConfirmation();
    setStatus("Compaction en cours…");
    syncControls();
    try {
      const usage = await requestContext("POST");
      if (!active(generation)) return;
      renderUsage(usage);
      setStatus("Contexte compacté.");
      showToast("Contexte compacté.");
    } catch (error) {
      if (!active(generation)) return;
      setStatus(describeError(error, true), true);
    } finally {
      state.compacting = false;
      if (active(generation)) syncControls();
    }
  }

  function closeDialog() {
    state.generation++;
    state.chatId = "";
    state.conversationId = "";
    state.session = "";
    state.usage = null;
    ui.details.replaceChildren();
    ui.status.textContent = "";
    hideConfirmation();
    if (ui.dialog.open) ui.dialog.close();
  }

  function openFor(localId) {
    const conversation = store.conversations.find(item => item.id === localId);
    if (!conversation) return;
    const reason = blockedReason(conversation, false);
    if (reason) { showToast(reason, true); return; }
    state.generation++;
    state.request = 0;
    state.compacting = false;
    state.usage = null;
    state.conversationId = conversation.id;
    state.chatId = conversation.chatId;
    state.session = store.session;
    ui.title.textContent = conversation.title || "Sans titre";
    ui.details.replaceChildren();
    ui.bar.hidden = true;
    ui.note.hidden = true;
    hideConfirmation();
    setStatus("");
    syncControls();
    if (!ui.dialog.open) ui.dialog.showModal();
    void loadUsage();
  }

  // A locked chat must not stay on screen once access is closed or the app is in the background.
  function closeIfLockedHidden() {
    if (!ui.dialog.open) return;
    const conversation = currentConversation();
    if (!conversation || state.session !== store.session || (typeof lockedChatIsHidden === "function" && lockedChatIsHidden(conversation))) closeDialog();
  }

  function setup() {
    const menu = document.getElementById("conv-menu");
    if (!menu || ui.dialog) return;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Contexte et compaction";
    item.addEventListener("click", event => {
      event.stopPropagation();
      const id = menuConversationId;
      closeMenus();
      if (id) openFor(id);
    });
    menu.insertBefore(item, document.getElementById("conv-delete"));

    const dialog = document.createElement("dialog");
    dialog.className = "project-editor chat-context-dialog";
    dialog.setAttribute("aria-label", "Contexte de la conversation");
    const body = document.createElement("div");
    body.className = "chat-context-body";
    const heading = document.createElement("h2");
    heading.textContent = "Contexte de la conversation";
    const title = document.createElement("p");
    title.className = "settings-hint chat-context-title";
    const bar = document.createElement("div");
    bar.className = "chat-context-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Occupation du contexte");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.hidden = true;
    const barFill = document.createElement("span");
    bar.append(barFill);
    const details = document.createElement("div");
    details.className = "chat-context-details";
    const note = document.createElement("p");
    note.className = "settings-hint";
    note.hidden = true;
    const status = document.createElement("p");
    status.className = "settings-hint chat-context-status";
    status.setAttribute("role", "status");

    const confirm = document.createElement("div");
    confirm.className = "chat-context-confirm";
    confirm.hidden = true;
    const warning = document.createElement("p");
    warning.textContent = "Compacter réduit le contexte conservé par le serveur pour cette conversation. Cette action ne peut pas être annulée depuis l’application. Les messages affichés ici ne sont pas modifiés.";
    const confirmYes = document.createElement("button");
    confirmYes.type = "button";
    confirmYes.className = "settings-btn primary";
    confirmYes.textContent = "Confirmer la compaction";
    const confirmNo = document.createElement("button");
    confirmNo.type = "button";
    confirmNo.className = "settings-btn";
    confirmNo.textContent = "Annuler";
    confirm.append(warning, confirmYes, confirmNo);

    const actions = document.createElement("div");
    actions.className = "chat-context-actions";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "settings-btn";
    refresh.textContent = "Actualiser";
    const compactButton = document.createElement("button");
    compactButton.type = "button";
    compactButton.className = "settings-btn";
    compactButton.textContent = "Compacter…";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "settings-btn";
    close.textContent = "Fermer";
    actions.append(refresh, compactButton, close);

    body.append(heading, title, bar, details, note, status, confirm, actions);
    dialog.append(body);
    document.body.append(dialog);
    Object.assign(ui, { dialog, title, bar, barFill, details, note, status, confirm, confirmYes, confirmNo, refresh, compact: compactButton, close });

    refresh.addEventListener("click", () => { hideConfirmation(); void loadUsage(); });
    // The first click only asks for confirmation; nothing is sent to the server.
    compactButton.addEventListener("click", () => {
      if (compactButton.disabled) return;
      ui.confirm.hidden = false;
      compactButton.hidden = true;
    });
    confirmNo.addEventListener("click", () => { if (!state.compacting) hideConfirmation(); });
    confirmYes.addEventListener("click", () => { void compact(); });
    close.addEventListener("click", closeDialog);
    dialog.addEventListener("cancel", event => { if (state.compacting) event.preventDefault(); });
    dialog.addEventListener("close", () => { if (state.chatId) closeDialog(); });

    window.addEventListener("francestudent:locked-chats", closeIfLockedHidden);
    document.addEventListener("visibilitychange", () => { if (document.hidden) closeIfLockedHidden(); });
    document.getElementById("logout")?.addEventListener("click", closeDialog);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
