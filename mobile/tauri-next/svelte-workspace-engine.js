"use strict";

// Partage le cache Files V2 et les aperçus existants jusqu'au retrait du moteur historique.
(() => {
  function files() {
    return globalThis.tauriFilesStore.getShared({
      api: (path, options) => settingsApi(path, options),
      getSession: () => store.session
    });
  }

  function readRemote(id) {
    const row = files().get(id);
    if (!row) throw new Error("Fichier indisponible.");
    return { name: row.filename || "Fichier enregistré", remoteId: id, remoteKind: "file", size: row.bytes };
  }


  function restrictedConversation(row) {
    return row?.serverLocked === true || (row?.chatId && isChatLocked(row.chatId));
  }

  async function readLocal(id) {
    const owner = libraryOwner();
    const session = store.session;
    const record = await libraryRecord(id);
    const conversation = store.conversations.find(row => row.id === record?.conversationId);
    if (!session || session !== store.session || record?.owner !== owner || restrictedConversation(conversation)) {
      throw new Error("Fichier local indisponible.");
    }
    return record;
  }

  function pendingConversations() {
    return store.conversations.filter(row => row.pendingResponse && !restrictedConversation(row) && (!row.pendingResponse.owner || row.pendingResponse.owner === store.profile?.email));
  }

  const thumbnails = globalThis.tauriFileThumbnails.create({
    fetchBlob: (file, options) => tauriThumbnailBlob(file, options),
    createUrl: (blob, mime) => URL.createObjectURL(blob.type === mime ? blob : new Blob([blob], { type: mime })),
    revokeUrl: url => URL.revokeObjectURL(url)
  });
  let thumbnailSession = "";

  window.__fsWorkspace = {
    files: () => files().files().map(({ id, filename, bytes, created_at }) => ({ id, filename, bytes, created_at })),
    moreFiles: () => files().hasMore(),
    usage: force => files().fetchUsage({ force }),
    refreshFiles: () => files().reload(),
    loadFiles: () => files().ensureLoaded(),
    loadMore: () => files().loadMore(),
    removeFile: id => files().remove(id),
    watchFiles: listener => files().subscribe(listener),
    arrange: (rows, options) => globalThis.tauriFilesStore.arrange(rows, options),
    fileKind: name => globalThis.tauriFilesStore.fileKind(name),
    thumbnail(id, signal) {
      if (thumbnailSession !== store.session) {
        thumbnails.clear();
        thumbnailSession = store.session;
      }
      const file = files().get(id);
      if (!file) throw new Error("Fichier indisponible.");
      return thumbnails.request(file, { signal });
    },
    previewRemote: id => previewAttachment(readRemote(id)),
    saveRemote: id => downloadTauriRemoteFile(readRemote(id)),
    async localFiles() {
      const session = store.session;
      const hidden = new Set(store.conversations.filter(restrictedConversation).map(row => row.id));
      for (const row of store.conversations) {
        if (!session || session !== store.session) return [];
        if (!hidden.has(row.id)) await indexConversationFiles(row);
      }
      const rows = await libraryRecords();
      if (session !== store.session) return [];
      return rows.filter(row => !hidden.has(row.conversationId)).map(({ id, name, kind, direction, created, projectId, conversationId }) =>
        ({ id, name, kind, direction, created, projectId, conversationId }));
    },
    async localThumbnail(id, signal) {
      const session = store.session;
      const row = await readLocal(id);
      const icon = { type: "icon", release() {} };
      if (signal.aborted || session !== store.session) return icon;
      if (typeof row.code === "string") return { type: "text", text: row.code.slice(0, 1800), release() {} };
      if (row.kind !== "image" && !/\.(txt|md|csv|log)$/i.test(row.name)) return icon;
      const file = await libraryBlob(row);
      if (signal.aborted || session !== store.session) return icon;
      if (/^image\/(?:png|jpeg|webp|gif|avif)$/i.test(file.blob.type) && file.blob.size <= 1024 * 1024) {
        const url = URL.createObjectURL(file.blob);
        return { type: "image", url, release: () => URL.revokeObjectURL(url) };
      }
      if (/\.(txt|md|csv|log)$/i.test(row.name)) return { type: "text", text: await file.blob.slice(0, 1800).text(), release() {} };
      return icon;
    },
    async localFileAction(id, action) {
      const session = store.session;
      const row = await readLocal(id);
      if (action === "chat") {
        if (busy) throw new Error("Attends la fin de la réponse en cours.");
        if (!store.conversations.some(item => item.id === row.conversationId)) throw new Error("Le chat d’origine n’est plus disponible.");
        await openConversation(row.conversationId);
        return;
      }
      const file = await libraryBlob(row);
      if (session !== store.session) return;
      if (action === "preview") await previewBlob(file.name, file.blob);
      else if (action === "save") await saveFile(file.name, new Uint8Array(await file.blob.arrayBuffer()));
    },
    async classifyLocal(id, projectId) {
      const row = await readLocal(id);
      await libraryWrite({ ...row, projectId });
    },
    libraryColumns: () => store.libraryColumns || 3,
    projectReady: () => !busy && Boolean(store.session),
    enterProject(project, chats) {
      if (busy || !store.session) throw new Error("Attends la fin de la réponse en cours.");
      mergeProjectChats(project.id, chats);
      currentProject = { ...project };
      saveStore();
      newConversation();
      renderProjectContext();
    },
    updateProject(project) {
      if (currentProject?.id !== project.id) return;
      currentProject = { ...currentProject, ...project };
      renderProjectContext();
    },
    deleteProjectContext(id) {
      store.conversations = store.conversations.filter(row => row.projectId !== id);
      saveStore();
      if (currentProject?.id === id) leaveProject();
      else renderHistory();
    },
    chatTarget(id) {
      const conversation = store.conversations.find(row => row.id === id);
      return conversation?.chatId ? { id: conversation.chatId, projectId: conversation.projectId || null } : null;
    },
    movedChat(chatId, projectId) {
      const row = store.conversations.find(item => item.chatId === chatId);
      if (!row) return;
      row.projectId = projectId;
      saveStore();
      renderHistory();
    },
    pending: () => pendingConversations().map(row => ({
      id: row.id, title: row.title || "Discussion", resume: Boolean(row.chatId || row.pendingResponse.recentChatIds)
    })),
    async pendingAction(id, action) {
      if (busy) throw new Error("Attends la fin de la réponse en cours.");
      const row = pendingConversations().find(item => item.id === id);
      if (!row) return;
      if (action === "resume") {
        await resumeSavedResponse(row);
        return;
      }
      const session = store.session;
      if (row.chatId) {
        const response = await apiFetch("/chats/" + encodeURIComponent(row.chatId) + "/stream/cancel", { method: "POST" });
        if (!response.ok) throw new Error("Annulation non confirmée par le serveur.");
      }
      if (session !== store.session) return;
      delete row.pendingResponse;
      saveStore();
    }
  };
})();
