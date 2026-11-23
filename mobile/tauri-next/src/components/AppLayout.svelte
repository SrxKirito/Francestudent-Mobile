<script lang="ts">
  import { flushSync, onMount } from "svelte";
  import logo from "../../../www/image.png";
  import ConversationMenu from "./ConversationMenu.svelte";
  import Sidebar from "./Sidebar.svelte";
  import LegacyFrame from "./LegacyFrame.svelte";
  import { connectLegacyEngine } from "../lib/services/legacy-engine.ts";
  import Startup from "./Startup.svelte";
  import ChatPane from "./ChatPane.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import RenameDialog from "./RenameDialog.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import ArchivedChats from "./ArchivedChats.svelte";
  import { agentLabel } from "../lib/utils/agents.ts";
  import ToastHost from "./ToastHost.svelte";
  import { createRuntimeApiClient } from "../lib/services/api-runtime.ts";
  import { createStorageAccount } from "../lib/services/account-local.ts";
  import { loadProfile, profileFirstName, type Profile } from "../lib/services/account.ts";
  import { readAvatarImage } from "../lib/services/avatar-image.ts";
  import { saveBytes, saveResponse } from "../lib/services/file-saver.ts";
  import type { TokenProvider } from "../lib/services/auth.ts";
  import type { PreviewFile } from "../lib/services/file-preview.ts";
  import type { EngineAgent } from "../lib/services/legacy-engine.ts";
  import { resolveStartupOwner } from "../lib/services/startup-owner.ts";
  import { createConversationStorage } from "../lib/services/conversation-storage.ts";
  import { createGeneralSettingsService } from "../lib/services/general-settings.ts";
  import { createStorageSettings } from "../lib/services/local-settings.ts";
  import type { LocalSettingsGateway } from "../lib/services/local-settings.ts";
  import { createChatMemory, type ChatMemory } from "../lib/services/chat-memory.ts";
  import LocalMemoryPanel from "./LocalMemoryPanel.svelte";
  import { createNativeChatEngine } from "../lib/services/native-chat.ts";
  import { createNativeRequest } from "../lib/services/native-chat-network.ts";
  import { createNativeConversations } from "../lib/services/native-conversations.ts";
  import { createNativeFiles } from "../lib/services/native-files.ts";
  import { createNativeShell, loadAgentCatalog } from "../lib/services/native-shell.ts";
  import { createNativeWorkspaceEngine } from "../lib/services/native-workspace.ts";
  import { createPreviewStorage } from "../lib/services/preview-storage.ts";
  import { uploadFile } from "../lib/services/transport.ts";
  import { AccountStore } from "../lib/stores/account.svelte.ts";
  import { ChatStore } from "../lib/stores/chat.svelte.ts";
  import { SettingsStore } from "../lib/stores/settings.svelte.ts";
  import { ShellStore } from "../lib/stores/shell.svelte.ts";
  import { SkillsStore } from "../lib/stores/skills.svelte.ts";
  import { errorMessage } from "../lib/utils/errors.ts";
  import { applyInterface } from "../lib/utils/interface-choice.ts";
  import { parseStoredState, STORE_KEY } from "../lib/utils/state.ts";
  import { applyTheme } from "../lib/utils/theme.ts";

  interface Props {
    store?: ShellStore;
    legacyChat?: boolean;
    tokens?: TokenProvider;
    onlogout?: () => Promise<unknown>;
  }

  let {
    tokens,
    onlogout,
    legacyChat = false,
    store = new ShellStore({
      width: typeof window === "undefined" ? 390 : window.innerWidth,
      onTheme: theme => applyTheme(theme, document.documentElement)
    })
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const chat = new ChatStore(store, () => settings?.close());
  const avatarSrc = $derived(store.avatar && store.avatar !== "image.png" ? store.avatar : logo);
  let projects = $state.raw<{ editId?: string; target?: { id: string; projectId: string | null } } | null>(null);
  let libraryOpen = $state(false);
  let settings = $state.raw<SettingsStore | null>(null);
  let chatMemory = $state.raw<ChatMemory | null>(null);
  let preview = $state.raw<PreviewFile | null>(null);
  let renameRequest = $state.raw<{ initial: string; resolve: (title: string | null) => void } | null>(null);

  function answerRename(title: string | null) {
    const request = renameRequest;
    renameRequest = null;
    request?.resolve(title);
  }

  function askRename(initial: string): Promise<string | null> {
    answerRename(null);
    return new Promise(resolve => { renameRequest = { initial, resolve }; });
  }

  function openPreview(file: PreviewFile) {
    preview = file;
  }

  function onFrame(frameWindow: Window | null) {
    const engine = connectLegacyEngine(frameWindow);
    if (engine) store.connect(engine);
    else store.markUnavailable();
  }

  $effect(() => {
    if (legacyChat) store.engine?.setLayout(store.layout);
  });

  $effect(() => {
    if (legacyChat) store.syncSearch(store.conversations.query);
  });

  onMount(() => {
    if (legacyChat) return () => store.disconnect();
    if (!tokens) return;
    const sessionTokens = tokens;
    const storage = window.localStorage;
    const cached = parseStoredState(storage.getItem(STORE_KEY), () => "");
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    const api = createRuntimeApiClient(sessionTokens);
    const request = createNativeRequest(sessionTokens);
    const local = createStorageSettings(storage);
    const accountLocal = createStorageAccount(storage);
    const cachedEmail = accountLocal.read().profile.email;
    const ownerBindingKey = STORE_KEY + ":account-owner";
    let owner = "";
    let ownerTask: Promise<void> | null = null;
    let historyFailed = false;
    let ready = false;
    let agents: EngineAgent[] = [];
    const historyStorage = createConversationStorage({
      indexedDB: window.indexedDB, localStorage: storage, warn: text => chat.toast(text, true),
      reclaimSpace: () => workspace.releaseImageCacheSpace()
    });
    const repository = createNativeConversations({ api, owner: () => owner, cachedOwner: cachedEmail, storage: historyStorage });
    const memory = createChatMemory(storage, repository.owner);
    chatMemory = memory;
    const files = createNativeFiles(request);
    const previewStorage = createPreviewStorage(window.indexedDB);
    const engine = createNativeChatEngine({
      api, tokens: sessionTokens, repository, local, memory, agents: () => agents, files, previewStorage, openPreview,
      noteUploaded: data => workspace.noteUploaded(data)
    });
    const workspace = createNativeWorkspaceEngine({
      api, repository, local, files, previewStorage, openPreview,
      deviceOwner: cached.deviceId ? "device:" + cached.deviceId : undefined,
      resume: id => engine.resume(id), cancelPending: id => engine.cancelPending(id), busy: () => engine.busy(),
      openChat: id => store.open(id)
    });
    const syncSettings = () => {
      engine.settingsChanged();
      store.refresh();
    };
    const localGateway: LocalSettingsGateway = {
      ...local,
      busy: () => engine.busy(),
      update(patch) {
        local.update(patch);
        syncSettings();
      }
    };
    let editedProfile: Profile | undefined;
    const account = onlogout ? new AccountStore({
      api, showSessions: false,
      local: {
        ...accountLocal,
        saveProfile(profile) {
          accountLocal.saveProfile(profile);
          if (!owner && profile.email) {
            owner = profile.email;
            syncSettings();
            syncHistory();
          } else store.refresh();
        },
        // SessionFlow est l’unique responsable du trousseau et des données d’authentification.
        signOut: async () => { await onlogout?.(); }
      },
      signedOut: async () => {},
      saver: saveBytes,
      share: typeof navigator.share === "function" ? data => navigator.share(data) : null,
      readAvatar: readAvatarImage,
      now: () => new Date(),
      toast: (text, error) => chat.toast(text, error),
      avatarChanged: () => store.refresh(),
      profileChanged: profile => { editedProfile = profile; store.refresh(); },
      sessionSignal: signal
    }) : undefined;
    const skills = new SkillsStore(api, async (file, abort) => {
      const token = await sessionTokens.getAccessToken();
      if (abort.aborted) throw new DOMException("Import annulé.", "AbortError");
      const source = /\.md$/i.test(file.name) && file.name !== "SKILL.md" ? new File([file], "SKILL.md", { type: file.type }) : file;
      return uploadFile(source, token, abort, () => {}, "skill");
    });
    settings = new SettingsStore({
      api, workspace, service: createGeneralSettingsService(api), local: localGateway, account, skills,
      agents: () => store.agents,
      interfaceHost: {
        state: () => ({ ui: "svelte", chat: true }),
        apply: choice => applyInterface(choice, storage, window.location.href),
        reload: href => { void historyStorage.flush().finally(() => window.location.replace(href)); }
      },
      openClassic: () => chat.toast("Cet écran est indisponible dans la session actuelle.", true)
    });
    const shellEngine = createNativeShell({
      api, request, repository, ready: () => ready, agents: () => agents,
      profile() {
        const account = accountLocal.read();
        return { label: profileFirstName(editedProfile ?? account.profile) || "Compte", avatar: account.avatar };
      },
      theme: () => local.read().theme,
      refreshAgent: () => engine.settingsChanged(),
      confirm: text => chat.confirm(text),
      rename: askRename,
      notify: (text, error) => chat.toast(text, error),
      saveResponse, saveBytes
    });

    store.connect(shellEngine);
    chat.connect(engine);

    function resolveOwner(): Promise<void> {
      if (owner || signal.aborted) return Promise.resolve();
      if (ownerTask) return ownerTask;
      const confirmedScope = sessionTokens.localScope?.().catch(() => "") ?? Promise.resolve("");
      const profileEmail = (async () => {
        const profileRequest = new AbortController();
        const cancel = () => profileRequest.abort();
        signal.addEventListener("abort", cancel, { once: true });
        const timeout = setTimeout(cancel, 4500);
        try {
          const profile = await loadProfile(api, profileRequest.signal);
          if (signal.aborted) return "";
          if (profile.email && !editedProfile) {
            try { accountLocal.saveProfile(profile); } catch { /* Le compte reste connu en mémoire. */ }
            if (ready) store.refresh();
          }
          return profile.email || "";
        } catch {
          return "";
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", cancel);
        }
      })();
      const task = resolveStartupOwner(storage, ownerBindingKey, confirmedScope, profileEmail, signal).then(resolved => {
        if (!signal.aborted && !owner) owner = resolved;
      });
      ownerTask = task;
      void task.finally(() => { if (ownerTask === task) ownerTask = null; });
      return task;
    }

    function syncHistory() {
      if (signal.aborted || !ready) return;
      void resolveOwner().then(() => {
        if (signal.aborted || !owner) return;
        store.refresh();
        return repository.sync();
      }).then(() => { if (owner) historyFailed = false; }).catch(error => {
        if (signal.aborted || historyFailed) return;
        historyFailed = true;
        chat.toast("Synchronisation de l’historique indisponible : " + errorMessage(error), true);
      });
    }
    const foreground = () => {
      if (document.hidden) return;
      historyStorage.retry();
      syncHistory();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", syncHistory);

    void loadAgentCatalog(api, signal).then(result => {
      if (signal.aborted) return;
      agents = result;
      syncSettings();
    });
    void (async () => {
      try { await repository.load(resolveOwner()); }
      catch (error) { if (!signal.aborted) chat.toast("Historique local indisponible : " + errorMessage(error), true); }
      if (signal.aborted) return;
      ready = true;
      syncSettings();
      syncHistory();
      account?.prefetchMetrics();
      if (owner) void workspace.usage(false).catch(() => {});
    })();

    return () => {
      lifetime.abort();
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", syncHistory);
      settings?.close();
      account?.stop();
      skills.dispose();
      answerRename(null);
      chat.disconnect();
      store.disconnect();
      workspace.dispose();
      repository.dispose();
      previewStorage.close();
    };
  });

  function openProjects(edit = false) {
    if (!settings?.workspace || !settings.api) return;
    const editId = edit ? store.conversations.projectId ?? undefined : undefined;
    store.closeMenus();
    if (!store.wide) store.drawerOpen = false;
    projects = { editId };
  }

  function moveConversation() {
    const menu = store.menu;
    const target = menu ? settings?.workspace?.chatTarget(menu.id) : null;
    store.closeMenus();
    if (!target) { chat.toast("Seules les discussions synchronisées peuvent être déplacées.", true); return; }
    if (!store.wide) store.drawerOpen = false;
    projects = { target };
  }

  function openLibrary() {
    if (!settings?.workspace || !settings.api) return;
    store.closeMenus();
    if (!store.wide) store.drawerOpen = false;
    libraryOpen = true;
  }

  function openSettings() {
    if (!settings) return;
    store.closeMenus();
    if (!store.wide) store.drawerOpen = false;
    settings.show("general");
  }

  function importConversation() {
    chat.openImport();
  }

  $effect(() => {
    store.syncSearch(store.conversations.query);
  });
  function watchDrawer(app: HTMLDivElement) {
    type Drag = {
      id: number; x: number; y: number; width: number; open: boolean;
      position: number; active: boolean; lastX: number; lastTime: number; velocity: number;
    };
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let drag: Drag | undefined;
    let swallowClick: { until: number; x: number; y: number } | undefined;

    function finish(cancelled = false) {
      const current = drag;
      drag = undefined;
      if (!current?.active) return;
      swallowClick = { until: performance.now() + 350, x: current.lastX, y: current.y };
      const velocity = performance.now() - current.lastTime < 110 ? current.velocity : 0;
      const traveled = Math.abs(current.position - (current.open ? current.width : 0));
      const flick = traveled >= 20 && Math.abs(velocity) > .5;
      const open = flick ? velocity > 0 : current.position >= current.width / 2;

      app.classList.remove("drawer-finger");
      // Rétablit les transitions à la position courante avant de rejoindre la butée.
      app.querySelector("#sidebar")?.getBoundingClientRect();
      flushSync(() => {
        if (!store.wide && !cancelled && store.drawerOpen !== open) {
          if (open) store.menuToggle();
          else store.overlayClick();
        }
        app.removeAttribute("data-drawer-gesture");
        app.style.removeProperty("--drawer-offset");
        app.style.removeProperty("--drawer-progress");
      });
    }

    function startSwipe(event: TouchEvent) {
      finish(true);
      const target = event.target;
      if (legacyChat || !store.ready || store.wide || event.touches.length !== 1 || !(target instanceof Element)) return;
      if (document.querySelector("dialog[open]") || target.closest("input, textarea, select, label, [contenteditable], [role=option], pre, table, iframe, .visual, .map-surface, .carousel-frame, .preview-image-viewport, .settings-modal, .popover")) return;
      if (window.getSelection()?.isCollapsed === false) return;
      const open = store.drawerOpen;
      if (!target.closest(open ? "#sidebar, #overlay" : "#messages, .chat-pane .topbar")) return;
      if (!open && target.closest("button, a")) return;
      const touch = event.touches[0];
      if (!open && touch.clientX < 14) return;
      const width = app.querySelector("#sidebar")?.getBoundingClientRect().width;
      if (!width) return;
      drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, width, open,
        position: open ? width : 0, active: false, lastX: touch.clientX, lastTime: performance.now(), velocity: 0 };
    }

    function update(touch: Touch) {
      if (!drag) return;
      const dx = touch.clientX - drag.x, dy = touch.clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { drag = undefined; return; }
        if (Math.abs(dx) < 9 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (drag.open ? dx > 0 : dx < 0) { drag = undefined; return; }
        drag.active = true;
        store.closeMenus();
        app.classList.add("drawer-finger");
        app.setAttribute("data-drawer-gesture", "");
      }
      const now = performance.now();
      if (touch.clientX !== drag.lastX && now > drag.lastTime) {
        drag.velocity = (touch.clientX - drag.lastX) / (now - drag.lastTime);
        drag.lastX = touch.clientX;
        drag.lastTime = now;
      }
      drag.position = Math.max(0, Math.min(drag.width, (drag.open ? drag.width : 0) + dx));
      app.style.setProperty("--drawer-offset", (drag.position - drag.width) + "px");
      app.style.setProperty("--drawer-progress", String(drag.position / drag.width));
    }

    app.addEventListener("touchstart", startSwipe, { passive: true, signal });
    app.addEventListener("touchmove", event => {
      if (!drag) return;
      if (event.touches.length !== 1 || store.drawerOpen !== drag.open || store.wide) { finish(true); return; }
      const touch = event.touches[0];
      if (touch.identifier !== drag.id) return;
      update(touch);
      if (drag?.active && event.cancelable) event.preventDefault();
    }, { passive: false, signal });
    app.addEventListener("touchend", event => {
      if (!drag) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === drag?.id);
      if (touch && drag.active) update(touch);
      finish();
    }, { passive: true, signal });
    app.addEventListener("touchcancel", () => finish(true), { passive: true, signal });
    window.addEventListener("resize", () => finish(true), { signal });
    app.addEventListener("click", event => {
      if (!event.detail || !swallowClick || performance.now() >= swallowClick.until ||
          Math.abs(event.clientX - swallowClick.x) > 24 || Math.abs(event.clientY - swallowClick.y) > 24) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal });
    return { destroy: () => lifetime.abort() };
  }
</script>

<svelte:window onresize={() => store.resize(window.innerWidth)} />
<svelte:document onclick={() => store.closeMenus()} />

<div class="app" use:watchDrawer class:fs-native={!legacyChat} class:sidebar-collapsed={store.collapsed} class:booting={!store.ready}>
  {#if !store.unavailable}
    <Sidebar
      open={store.drawerOpen}
      bind:query={store.conversations.query}
      archive={legacyChat ? store.archive : undefined}
      remoteSearch={store.remoteSearch}
      onsearchcomposition={active => store.composition(active)}
      ontogglearchive={() => store.toggleArchive()}
      onrestorearchived={id => store.restoreArchived(id)}
      ondownloadarchived={id => store.downloadArchived(id)}
      onmorearchived={() => store.moreArchived()}
      onopenremote={index => store.openRemote(index)}
      project={store.project}
      projectStatus={store.projectStatus}
      userName={store.userName}
      {avatarSrc}
      settingsOpen={store.settingsOpen || (settings?.open ?? false)}
      groups={store.conversations.groups(Date.now())}
      currentId={store.conversations.currentId}
      menuId={store.menu?.id ?? null}
      markFor={store.markFor}
      onopen={id => store.open(id)}
      onmenu={(id, button) => store.toggleMenu(id, button.getBoundingClientRect())}
      onsearch={() => store.searched()}
      onhistoryscroll={() => store.historyScrolled()}
      onnewchat={() => store.newChat()}
      onprojects={() => legacyChat ? store.projects() : openProjects()}
      onlibrary={() => legacyChat ? store.library() : openLibrary()}
      onprojectsettings={() => legacyChat ? store.projectSettings() : openProjects(true)}
      onleaveproject={() => store.leaveProject()}
      onsettings={() => legacyChat ? store.settings() : openSettings()}
      oncollapse={() => store.collapse()}
    />
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div id="overlay" class="overlay" class:hidden={!store.drawerOpen} onclick={() => store.overlayClick()}></div>
    <ConversationMenu
      open={store.menu !== null}
      pinned={store.menuPinned}
      archivable={store.archive.available}
      anchor={store.menu?.anchor ?? null}
      onpin={() => store.menuAction("togglePin")}
      onrename={() => store.menuAction("renameConversation")}
      onarchive={() => store.menuAction("archiveConversation")}
      onexport={legacyChat ? undefined : () => {
        const id = store.menu?.id;
        store.closeMenus();
        if (id) store.engine?.exportConversation?.(id);
      }}
      ondelete={() => store.menuAction("deleteConversation")}
      onproject={settings?.workspace ? moveConversation : undefined}
    />
  {/if}
  <main class="main">
    {#if legacyChat}
      <LegacyFrame onframe={onFrame} />
    {:else}
      {#if !store.ready}<Startup />{/if}
      <ChatPane {chat} {openPreview} skills={settings?.skillsPanel} />
      <ToastHost {chat} />
      <ConfirmDialog {chat} />
      <ImportDialog {chat} />
    {/if}
  </main>
  {#if projects && settings?.workspace && settings.api}
    {@const workspace = settings.workspace}
    {@const api = settings.api}
    {#await import("./ProjectsDialog.svelte") then { default: ProjectsDialog }}
      <ProjectsDialog engine={workspace} {api} editId={projects?.editId} target={projects?.target}
        onconfirm={text => chat.confirm(text)} onclose={() => { projects = null; }} />
    {:catch}
      <p role="alert">Impossible d’ouvrir les projets.</p>
    {/await}
  {/if}
  {#if libraryOpen && settings?.workspace && settings.api}
    {@const workspace = settings.workspace}
    {@const api = settings.api}
    {#await import("./LibraryDialog.svelte") then { default: LibraryDialog }}
      <LibraryDialog engine={workspace} {api} katexReady={chat.katexReady}
        onopenmessage={async id => {
          const opened = await store.engine?.openServerConversation?.(id);
          if (opened) libraryOpen = false;
          return opened === true;
        }}
        onconfirm={text => chat.confirm(text)} onclose={() => { libraryOpen = false; }} ontoast={(text, error) => chat.toast(text, error)} />
    {:catch}
      <p role="alert">Impossible d’ouvrir la bibliothèque.</p>
    {/await}
  {/if}
  {#if settings?.open}
    {@const current = settings}
    {#await import("./SettingsDialog.svelte") then { default: SettingsDialog }}
      <SettingsDialog store={current} showChatToggle={false} onconfirm={text => chat.confirm(text)}
        onimport={importConversation} onarchives={store.archive.available ? () => { if (!store.archive.open) store.toggleArchive(); } : undefined}>
        {#snippet memoryPanel()}
          {#if chatMemory && store.ready}<LocalMemoryPanel memory={chatMemory} />{/if}
        {/snippet}
        {#snippet conversations()}
          {@const snapshot = chat.state}
          <section class="general-section" aria-labelledby="settings-conversations-title">
            <h3 id="settings-conversations-title" class="settings-section-title">Discussions</h3>
            {#if snapshot.conversationAgent && snapshot.messages.length}
              <p id="settings-conversation-model" class="settings-hint">Modèle de cette discussion · <strong>{agentLabel(snapshot.conversationAgent)}</strong></p>
              {#if snapshot.conversationAgent.id !== snapshot.composer.agentId}
                <p class="settings-hint">Envoyer avec un autre modèle démarrera une nouvelle discussion côté serveur.</p>
              {/if}
            {/if}
          </section>
        {/snippet}
        {#snippet archivePage()}
          <ArchivedChats archive={store.archive} standalone onrestore={id => store.restoreArchived(id)}
            ondownload={id => store.downloadArchived(id)} onmore={() => store.moreArchived()} />
        {/snippet}
      </SettingsDialog>
    {:catch}
      <p role="alert">Impossible d’ouvrir les paramètres.</p>
    {/await}
  {/if}
  {#if renameRequest}
    <RenameDialog initial={renameRequest.initial} onanswer={answerRename} />
  {/if}
  {#if preview}
    {#await import("./PreviewDialog.svelte") then { default: PreviewDialog }}
      <PreviewDialog file={preview} onclose={() => { preview = null; }}
        onAnalyze={chat.engine?.sendWithInteractiveContext ? selection => {
          chat.useInteractiveContext(chat.state.id, selection);
          preview = null;
          libraryOpen = false;
          settings?.close();
        } : undefined} />
    {:catch}
      <p role="alert">Impossible de charger l’aperçu.</p>
    {/await}
  {/if}
</div>

<style>
  /* La barre garde sa place pendant la lecture de l’historique local. */
  .booting :global(#sidebar) { visibility: hidden; }
</style>
