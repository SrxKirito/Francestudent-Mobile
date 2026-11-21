/* Pont du chat entre l'ancienne interface (iframe) et l'interface Svelte.
 *
 * Injecté par prepare-legacy.cjs APRÈS app.js, à côté de svelte-engine.js (qui sert la coque : barre latérale, menus).
 * Même principe : l'ancienne interface reste le MOTEUR (authentification, réseau, stockage, construction des requêtes,
 * récupération iOS) ; ce fichier n'expose que ce dont le chat Svelte a besoin, sous `window.__fsChat`.
 *
 *  - Inerte tant que `attach(host)` n'est pas appelé : aucune fonction de l'ancienne interface n'est modifiée.
 *  - `state()` renvoie du JSON SANS données lourdes (pas de base64 de pièces jointes, pas de consigne interne, pas de session).
 *  - `detach()` restaure toutes les fonctions remplacées.
 *  - Le crochet de lecture du flux (`window.__fsStreamReader`) n'existe que si l'hôte fournit `readStream` ; il est lu
 *    par stream.js (patch posé par prepare-legacy.cjs) : sans lui, l'ancienne lecture du flux s'exécute comme avant.
 *
 * Les variables et fonctions de l'ancienne interface (store, currentId, busy, pendingFiles, renderMessages…) sont
 * lues par leur nom nu, comme dans svelte-engine.js : mêmes portées globales de scripts classiques.
 */
(function () {
  "use strict";

  const STUDY = ["fiches", "quiz", "cartes"];
  const OPTIONS = ["webSearch", "imageMode", "studyMode", "powerpointMode", "imageModel"];
  const PATCHED = ["renderMessages", "updateSendButton", "renderAttachments", "renderToggles", "renderModels", "saveStore"];

  let host = null;
  let restores = [];
  let queued = false;
  let draftSeq = 0;
  const pendingVotes = new Set();

  // ---------- accès à l'ancienne interface (tolérant : un nom absent donne une valeur neutre) ----------
  function currentConv() {
    if (typeof currentConversation === "function") {
      try { return currentConversation() || null; } catch { /* repli ci-dessous */ }
    }
    if (typeof store !== "object" || !store || !Array.isArray(store.conversations)) return null;
    return store.conversations.find(c => c && c.id === currentId) || null;
  }

  function promptBox() {
    return typeof document === "object" && document ? document.getElementById("prompt") : null;
  }

  function pending() {
    return typeof pendingFiles !== "undefined" && Array.isArray(pendingFiles) ? pendingFiles : [];
  }

  // Les pièces jointes sont téléversées dès leur sélection (tauri-files.js) : on transmet l'état d'envoi,
  // jamais les données du fichier. « done » et l'absence d'état (texte intégré au prompt) ne sont pas signalés.
  function attachmentView(file) {
    const view = { id: file.id, name: file.name, kind: file.kind };
    const state = file.uploadState;
    if (state === "queued" || state === "uploading" || state === "error") view.upload = state;
    if (state === "uploading") view.progress = typeof file.uploadProgress === "number" ? file.uploadProgress : 0;
    return view;
  }

  function retryUpload(id) {
    const entry = pending().find(file => file && file.id === id);
    if (!entry || entry.uploadState !== "error" || typeof beginTauriUpload !== "function") return;
    beginTauriUpload(entry);
  }

  function legacyOverlay() {
    if (typeof document !== "object" || !document) return false;
    try {
      if (document.querySelector("dialog[open]")) return true;
      return Boolean(document.body && document.body.classList.contains("settings-open"));
    } catch { return false; }
  }

  // ---------- notification groupée ----------
  function notify() {
    if (!host || queued) return;
    queued = true;
    Promise.resolve().then(() => {
      queued = false;
      if (!host) return;
      try { host.changed(); } catch (error) { console.error("svelte-chat-engine", error); }
    });
  }

  function patch(name, build) {
    const original = window[name];
    if (typeof original !== "function") return;
    window[name] = build(original);
    restores.push(() => { window[name] = original; });
  }

  function after(callback) {
    return original => function () {
      const result = original.apply(this, arguments);
      callback();
      return result;
    };
  }

  // ---------- instantané ----------
  function pickSources(list) {
    if (!Array.isArray(list)) return undefined;
    return list.filter(Boolean).map(source => ({ url: source.url, title: source.title, host: source.host }));
  }

  function pickImages(list) {
    if (!Array.isArray(list)) return undefined;
    return list.map((image, index) => {
      const item = image || {};
      return {
        index,
        id: item.id,
        messageId: item.messageId,
        chatId: item.chatId,
        url: typeof item.url === "string" ? item.url : undefined,
        inline: typeof item.data === "string" && item.data !== ""
      };
    });
  }

  function pickAttachments(list) {
    if (!Array.isArray(list) || !list.length) return undefined;
    return list.filter(Boolean).map(file => ({ name: file.name, kind: file.kind, mime: file.mime }));
  }

  function pickMessage(message, index) {
    const item = message || {};
    const out = { index, role: item.role, content: typeof item.content === "string" ? item.content : "" };
    if (item.serverMessageId) out.serverMessageId = item.serverMessageId;
    if (item.feedback) out.feedback = item.feedback;
    const sources = pickSources(item.sources);
    if (sources && sources.length) out.sources = sources;
    const images = pickImages(item.images);
    if (images && images.length) out.images = images;
    const attachments = pickAttachments(item.attachments);
    if (attachments) out.attachments = attachments;
    return out;
  }

  function snapshot() {
    const conversation = currentConv();
    const box = promptBox();
    const hasStore = typeof store === "object" && store !== null;
    return {
      ready: hasStore,
      id: conversation ? conversation.id : null,
      chatId: conversation ? conversation.chatId || null : null,
      title: conversation ? conversation.title || "" : "",
      busy: typeof busy !== "undefined" && busy === true,
      stopping: typeof stopRequested !== "undefined" && stopRequested === true,
      pending: Boolean(conversation && conversation.pendingResponse),
      legacyOverlay: legacyOverlay(),
      conversationAgent: conversation && conversation.agentId != null
        ? { id: conversation.agentId, name: conversation.agentName || "", provider: conversation.agentProvider || "" }
        : null,
      messages: conversation && Array.isArray(conversation.messages) ? conversation.messages.map(pickMessage) : [],
      composer: {
        agentId: hasStore ? store.agentId : null,
        webSearch: hasStore && store.webSearch === true,
        webSearchMode: hasStore ? store.webSearchMode || "auto" : "auto",
        imageMode: hasStore && store.imageMode === true,
        powerpointMode: hasStore && store.powerpointMode === true,
        studyMode: hasStore ? store.studyMode || "" : "",
        imageModel: hasStore ? store.imageModel || "" : "",
        attachments: pending().map(attachmentView)
      },
      draft: { seq: draftSeq, text: box && typeof box.value === "string" ? box.value : "" }
    };
  }

  // ---------- actions ----------
  function send(text, skillPrefix) {
    const box = promptBox();
    if (!box) return false;
    const conversation = currentConv();
    if ((typeof busy !== "undefined" && busy === true) || (conversation && conversation.pendingResponse)) return false;
    const value = String(text == null ? "" : text);
    const hadFiles = pending().length > 0;
    if (!value.trim() && !hadFiles) return false;
    box.value = value;
    // sendMessage() est asynchrone mais sa partie initiale (contrôles, vidage du champ et des pièces jointes) est synchrone.
    let started;
    try {
      started = sendMessage(skillPrefix);
    } catch (error) {
      console.error("sendMessage", error);
      return false;
    }
    if (started && typeof started.catch === "function") started.catch(error => console.error("sendMessage", error));
    const emptied = !String(box.value || "").trim();
    return emptied && (!hadFiles || pending().length === 0);
  }

  function stop() {
    if (typeof stopGeneration === "function") stopGeneration();
  }

  function regenerateLegacy(index) {
    return regenerate(index);
  }

  async function vote(index, isUpvoted) {
    const conversation = currentConv();
    const message = conversation && Array.isArray(conversation.messages) ? conversation.messages[index] : null;
    if (!message || pendingVotes.has(message)) return;
    if (!message.serverMessageId) {
      showToast("Vote indisponible : recharge cette conversation pour récupérer le message.");
      return;
    }
    const wanted = isUpvoted === true;
    if (message.feedback === (wanted ? "up" : "down")) return;
    const session = store.session;
    pendingVotes.add(message);
    try {
      const result = await settingsApi("/messages/" + encodeURIComponent(message.serverMessageId), { method: "PATCH", body: JSON.stringify({ isUpvoted: wanted }) });
      if (store.session !== session || !conversation.messages.includes(message)) return;
      if (!result || typeof result.isUpvoted !== "boolean") throw new Error("Le serveur n’a pas confirmé le vote.");
      message.feedback = result.isUpvoted ? "up" : "down";
      saveStore();
      notify();
    } catch (error) {
      if (store.session === session) showToast("Vote impossible : " + ((error && error.message) || "erreur réseau"));
    } finally {
      pendingVotes.delete(message);
      notify();
    }
  }

  function setOption(name, value) {
    if (!OPTIONS.includes(name) || typeof store !== "object" || !store) return;
    if (name === "webSearch") {
      if (store.webSearchMode === "disabled") return;
      store.webSearch = value === true;
    } else if (name === "imageMode") {
      store.imageMode = value === true;
      if (store.imageMode) store.powerpointMode = false;
    } else if (name === "powerpointMode") {
      store.powerpointMode = value === true;
      if (store.powerpointMode) {
        store.imageMode = false;
        store.studyMode = "";
      }
    } else if (name === "imageModel") {
      if (typeof value !== "string" || !Object.hasOwn(IMAGE_MODELS, value)) return;
      store.imageModel = value;
      store.imageToolSynced = null;
      if (typeof renderImageModel === "function") renderImageModel();
    } else {
      const mode = value == null ? "" : String(value);
      if (mode && !STUDY.includes(mode)) return;
      store.studyMode = mode;
      if (mode) store.powerpointMode = false;
    }
    saveStore();
    renderToggles();
  }

  function setAgent(id) {
    if (typeof agentById !== "function" || typeof store !== "object" || !store) return;
    const agent = agentById(id);
    if (!agent || agent.available === false) return;
    store.agentId = id;
    saveStore();
    renderModels();
  }

  function messageAt(index) {
    const conversation = currentConv();
    return conversation && Array.isArray(conversation.messages) ? conversation.messages[index] || null : null;
  }

  async function image(messageIndex, imageIndex) {
    const message = messageAt(messageIndex);
    const item = message && Array.isArray(message.images) ? message.images[imageIndex] : null;
    if (!item) return null;
    return resolveGeneratedImage(item);
  }

  function attachmentPreview(id) {
    const file = pending().find(entry => entry && entry.id === id);
    return file && file.kind === "image" && typeof file.data === "string" ? file.data : "";
  }

  function preview(json) {
    let target;
    try { target = JSON.parse(json); } catch { return; }
    if (!target || typeof target !== "object") return;
    if (typeof target.pending === "string") {
      target = pending().find(entry => entry && entry.id === target.pending) || null;
    } else if (Number.isInteger(target.messageIndex) && Number.isInteger(target.attachmentIndex)) {
      const message = messageAt(target.messageIndex);
      target = message && Array.isArray(message.attachments) ? message.attachments[target.attachmentIndex] || null : null;
    }
    if (!target) return;
    const done = previewAttachment(target);
    if (done && typeof done.catch === "function") done.catch(error => console.error("previewAttachment", error));
  }

  // ---------- import d'une conversation partagée (même contrat que conversation-import.js) ----------
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UNEXPECTED_IMPORT = "Réponse inattendue du serveur. Vérifie ton historique avant de réessayer : l’import a peut-être abouti.";

  function usableAgent(agent) {
    return Boolean(agent && agent.available && typeof agent.model === "string" && agent.model.trim() !== "");
  }

  function importAgents() {
    return typeof agents !== "undefined" && Array.isArray(agents) ? agents.filter(usableAgent) : [];
  }

  function importModels() {
    const models = importAgents().map(agent => ({
      id: agent.id,
      label: agentLabel(agent) + (agent.provider ? " · " + agent.provider : ""),
      model: agent.model
    }));
    return JSON.stringify({ models, currentId: typeof store === "object" && store ? store.agentId : null });
  }

  function importFindExisting(shareId) {
    const list = typeof store === "object" && store && Array.isArray(store.conversations) ? store.conversations : [];
    const found = list.find(conversation => {
      const origin = conversation && conversation.importedFrom;
      if (!origin || (origin.shareId !== shareId && origin.sourceConversationId !== shareId)) return false;
      // Une conversation verrouillée masquée n'est jamais révélée ni réutilisée.
      return !(typeof lockedChatIsHidden === "function" && lockedChatIsHidden(conversation));
    });
    return found ? JSON.stringify({ id: found.id, serverArchived: found.serverArchived === true }) : "null";
  }

  function recordImport(data, agent, shareId) {
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
      sourceConversationId: typeof data.sourceConversationId === "string" ? data.sourceConversationId.toLowerCase() : shareId,
      shareId
    };
    return conversation;
  }

  async function importErrorDetail(response) {
    let text = "";
    try { text = await response.text(); } catch { /* détail facultatif */ }
    try {
      const data = JSON.parse(text);
      const value = [data && data.message, data && data.detail, data && data.error, data && data.title].find(item => typeof item === "string" && item.trim());
      return value ? value.trim().slice(0, 200) : "";
    } catch { return ""; }
  }

  async function importRun(json) {
    let request;
    try { request = JSON.parse(json); } catch { return JSON.stringify({ ok: false, message: "Demande d’import invalide." }); }
    const session = typeof store === "object" && store ? store.session : null;
    if (!session) return JSON.stringify({ ok: false, noSession: true });
    const agent = importAgents().find(item => item.id === request.agentId);
    if (!agent) return JSON.stringify({ ok: false, noModel: true });
    const shareId = String(request.shareId || "");
    try {
      const response = await apiFetch("/conversation-imports/openai", {
        method: "POST",
        body: JSON.stringify({ link: request.link, model: agent.model })
      });
      if (!response || !response.ok) {
        const status = response ? response.status : undefined;
        return JSON.stringify({
          ok: false,
          status,
          message: "HTTP " + (status || "indisponible"),
          detail: response ? await importErrorDetail(response) : ""
        });
      }
      const data = await response.json().catch(() => null);
      if (!data || typeof data.chatId !== "string" || !UUID.test(data.chatId)) {
        if (typeof syncConversationsFromServer === "function") void Promise.resolve(syncConversationsFromServer()).catch(() => {});
        return JSON.stringify({ ok: false, unexpected: true, message: UNEXPECTED_IMPORT });
      }
      if (session !== store.session) return JSON.stringify({ ok: false, aborted: true });
      const conversation = recordImport(data, agent, shareId);
      saveStore();
      renderHistory();
      return JSON.stringify({
        ok: true,
        id: conversation.id,
        count: Number.isInteger(data.importedMessagesCount) ? data.importedMessagesCount : null
      });
    } catch (error) {
      if (session !== store.session) return JSON.stringify({ ok: false, aborted: true });
      return JSON.stringify({ ok: false, message: error && error.message ? String(error.message) : "" });
    }
  }

  // ---------- conversations verrouillables (panneau et verrou du chat Svelte) ----------
  // Confidentialité : tant que l'accès aux conversations verrouillées est fermé, les masquées ne sortent jamais d'ici.
  function lockedAccessOpen() {
    try {
      const api = window.FranceStudentLockedChats;
      return Boolean(api && typeof api.state === "function" && api.state().accessOpen === true);
    } catch { return false; }
  }

  function lockableConversations() {
    const list = typeof store === "object" && store && Array.isArray(store.conversations) ? store.conversations : [];
    const open = lockedAccessOpen();
    const hidden = conversation => typeof lockedChatIsHidden === "function" && lockedChatIsHidden(conversation);
    return JSON.stringify(list
      .filter(conversation => conversation && (open || !hidden(conversation)))
      .map(conversation => ({
        id: conversation.id,
        chatId: conversation.chatId,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        pendingResponse: conversation.pendingResponse === true
      })));
  }

  // ---------- partages d'une conversation (liste, droits : toujours décidés par le serveur) ----------
  function shareableConversation(localId) {
    const list = typeof store === "object" && store && Array.isArray(store.conversations) ? store.conversations : [];
    const found = list.find(conversation => conversation && conversation.id === localId);
    if (!found || typeof found.chatId !== "string" || !found.chatId) return null;
    if (typeof lockedChatIsHidden === "function" && lockedChatIsHidden(found)) return null;
    return found;
  }

  function sharesTarget(localId) {
    const found = shareableConversation(localId);
    if (!found) return "null";
    const profile = (typeof store === "object" && store && store.profile) || {};
    return JSON.stringify({
      chatId: found.chatId,
      me: {
        id: Number.isInteger(profile.id) ? profile.id : null,
        email: typeof profile.email === "string" ? profile.email : ""
      }
    });
  }

  async function sharesCall(json) {
    let request;
    try { request = JSON.parse(json); } catch { return JSON.stringify({ ok: false, message: "Demande de partage invalide." }); }
    const method = request && request.method;
    if (method !== "GET" && method !== "POST" && method !== "PATCH" && method !== "DELETE") {
      return JSON.stringify({ ok: false, message: "Opération de partage inconnue." });
    }
    const session = typeof store === "object" && store ? store.session : null;
    if (!session) return JSON.stringify({ ok: false, noSession: true });
    const found = shareableConversation(request.localId);
    if (!found) return JSON.stringify({ ok: false, notSynced: true });
    const path = "/chats/" + encodeURIComponent(found.chatId) + "/shares";
    try {
      const data = method === "GET"
        ? await settingsApi(path)
        : await settingsApi(path, { method, body: JSON.stringify(request.body == null ? {} : request.body) });
      if (session !== store.session) return JSON.stringify({ ok: false, aborted: true });
      return JSON.stringify({ ok: true, data: data === undefined ? null : data });
    } catch (error) {
      if (session !== store.session) return JSON.stringify({ ok: false, aborted: true });
      const status = error && Number.isInteger(error.status) ? error.status : undefined;
      return JSON.stringify({ ok: false, status, message: error && error.message ? String(error.message) : "" });
    }
  }

  // ---------- attache / détache ----------
  function attach(newHost) {
    detach();
    host = newHost;
    for (const name of PATCHED) patch(name, after(notify));
    patch("restoreFailedPrompt", original => function () {
      const result = original.apply(this, arguments);
      draftSeq += 1;
      notify();
      return result;
    });
    patch("editSentMessage", original => function () {
      const result = original.apply(this, arguments);
      draftSeq += 1;
      notify();
      return result;
    });
    patch("showToast", original => function (text, isError) {
      if (!host || document.querySelector("dialog[open]")) return original.apply(this, arguments);
      host.toast(String(text == null ? "" : text), isError === true);
    });
    // L'ouverture des réglages ou d'un <dialog> legacy ne passe par aucune fonction patchée :
    // sans observation du DOM, la surcouche resterait posée sur une fenêtre legacy invisible.
    if (typeof MutationObserver === "function" && document.body) {
      let overlay = legacyOverlay();
      const watcher = new MutationObserver(() => {
        const now = legacyOverlay();
        if (now === overlay) return;
        overlay = now;
        notify();
      });
      watcher.observe(document.body, { attributes: true, attributeFilter: ["class", "open"], subtree: true, childList: true });
      restores.push(() => watcher.disconnect());
    }
    if (typeof newHost.readStream === "function") {
      window.__fsStreamReader = options => host.readStream(options);
      restores.push(() => { delete window.__fsStreamReader; });
    }
    notify();
  }

  function detach() {
    while (restores.length) restores.pop()();
    host = null;
    queued = false;
  }

  window.__fsChat = {
    attach,
    detach,
    state: () => JSON.stringify(snapshot()),
    send,
    stop,
    // Appelle la fonction historique `regenerate` (nom nu : liaison globale de l'ancienne interface).
    regenerate: index => regenerateLegacy(index),
    removeAttachment: id => removeAttachment(id),
    retryUpload,
    addFiles: list => addFiles(list),
    editSent: index => editSentMessage(currentConv(), index),
    editFailed: index => restoreFailedPrompt(currentConv(), index),
    vote,
    setOption,
    setAgent,
    image,
    resolveImage: json => resolveGeneratedImage(JSON.parse(json)),
    attachmentPreview,
    downloadImage: src => downloadGeneratedImage(src),
    importModels,
    importFindExisting,
    importRun,
    lockableConversations,
    sharesTarget,
    sharesCall,
    preview
  };
})();
