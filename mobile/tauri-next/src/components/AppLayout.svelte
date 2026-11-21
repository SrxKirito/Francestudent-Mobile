<script lang="ts">
  import { onMount } from "svelte";
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
  import SharesDialog from "./SharesDialog.svelte";
  import ToastHost from "./ToastHost.svelte";
  import { createRuntimeApiClient } from "../lib/services/api-runtime.ts";
  import { createStorageAccount } from "../lib/services/account-local.ts";
  import { loadProfile, profileName } from "../lib/services/account.ts";
  import { readAvatarImage } from "../lib/services/avatar-image.ts";
  import { savedMessages } from "../lib/services/saved-messages.ts";
  import { saveBytes, saveResponse } from "../lib/services/file-saver.ts";
  import type { TokenProvider } from "../lib/services/auth.ts";
  import type { PreviewFile } from "../lib/services/file-preview.ts";
  import type { EngineAgent } from "../lib/services/legacy-engine.ts";
  import { createConversationStorage } from "../lib/services/conversation-storage.ts";
  import { createGeneralSettingsService } from "../lib/services/general-settings.ts";
  import { createStorageSettings } from "../lib/services/local-settings.ts";
  import type { LocalSettingsGateway } from "../lib/services/local-settings.ts";
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
  const chat = new ChatStore(store);
  const avatarSrc = $derived(store.avatar && store.avatar !== "image.png" ? store.avatar : logo);
  let projects = $state.raw<{ editId?: string; target?: { id: string; projectId: string | null } } | null>(null);
  let libraryOpen = $state(false);
  let saveMessage = $state.raw<((chatId: string, messageId: string) => Promise<void>) | undefined>(undefined);
  let settings = $state.raw<SettingsStore | null>(null);
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
    saveMessage = async (chatId, messageId) => {
      await savedMessages(api).set(chatId, messageId, true, signal);
      if (!signal.aborted) chat.toast("Message enregistré dans la bibliothèque.");
    };
    const request = createNativeRequest(sessionTokens);
    const local = createStorageSettings(storage);
    const accountLocal = createStorageAccount(storage);
    let owner = accountLocal.read().profile.email;
    let ready = false;
    let agents: EngineAgent[] = [];
    const historyStorage = createConversationStorage({
      indexedDB: window.indexedDB, localStorage: storage, warn: text => chat.toast(text, true)
    });
    const repository = createNativeConversations({ api, owner: () => owner, cachedOwner: owner, storage: historyStorage });
    const files = createNativeFiles(request);
    const previewStorage = createPreviewStorage(window.indexedDB);
    const engine = createNativeChatEngine({
      api, tokens: sessionTokens, repository, local, agents: () => agents, files, previewStorage, openPreview,
      noteUploaded: data => workspace.noteUploaded(data)
    });
    const workspace = createNativeWorkspaceEngine({
      api, repository, local, files, previewStorage, openPreview,
      upload: async (file, uploadSignal, progress) => uploadFile(file, await sessionTokens.getAccessToken(), uploadSignal, progress),
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
    const account = onlogout ? new AccountStore({
      api,
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
      avatarChanged: () => store.refresh()
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
      api, request, repository, ready: () => ready, busy: () => engine.busy(), agents: () => agents,
      profile() {
        const account = accountLocal.read();
        return { label: profileName(account.profile), avatar: account.avatar };
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

    function syncHistory() {
      if (!signal.aborted && ready && owner) void repository.sync().catch(() => {});
    }
    const foreground = () => { if (!document.hidden) syncHistory(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", syncHistory);

    void loadAgentCatalog(api, signal).then(result => {
      if (signal.aborted) return;
      agents = result;
      syncSettings();
    });
    void (async () => {
      try {
        const profile = await loadProfile(api, signal);
        if (signal.aborted) return;
        if (profile.email) {
          owner = profile.email;
          try { accountLocal.saveProfile(profile); } catch { /* Le compte reste connu en mémoire. */ }
        }
      } catch {
        // Même session que lors du dernier accès, si un profil existe encore sur l’appareil.
      }
      if (signal.aborted) return;
      try { await repository.load(); }
      catch (error) { if (!signal.aborted) chat.toast("Historique local indisponible : " + errorMessage(error), true); }
      if (signal.aborted) return;
      ready = true;
      syncSettings();
      syncHistory();
    })();

    return () => {
      lifetime.abort();
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", syncHistory);
      settings?.close();
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

  function shareMenuConversation() {
    const id = store.menu?.id;
    store.closeMenus();
    if (id) chat.openShares(id);
  }

  function importConversation() {
    if (store.drawerOpen) store.overlayClick();
    chat.openImport();
  }

  $effect(() => {
    store.syncSearch(store.conversations.query);
  });
</script>

<svelte:window onresize={() => store.resize(window.innerWidth)} />
<svelte:document onclick={() => store.closeMenus()} />

<div class="app" class:fs-native={!legacyChat} class:sidebar-collapsed={store.collapsed} class:booting={!store.ready}>
  {#if !store.unavailable}
    <Sidebar
      open={store.drawerOpen}
      bind:query={store.conversations.query}
      archive={store.archive}
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
      onimport={legacyChat ? undefined : importConversation}
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
      onshare={legacyChat ? undefined : shareMenuConversation}
      onproject={settings?.workspace ? moveConversation : undefined}
    />
  {/if}
  <main class="main">
    {#if legacyChat}
      <LegacyFrame onframe={onFrame} />
    {:else}
      {#if !store.ready}<Startup />{/if}
      <ChatPane {chat} {openPreview} {saveMessage} skills={settings?.skillsPanel} />
      <ToastHost {chat} />
      <ConfirmDialog {chat} />
      <ImportDialog {chat} />
      <SharesDialog {chat} />
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
      <LibraryDialog engine={workspace} {api}
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
      <SettingsDialog store={current} showChatToggle={false} onconfirm={text => chat.confirm(text)} />
    {:catch}
      <p role="alert">Impossible d’ouvrir les paramètres.</p>
    {/await}
  {/if}
  {#if renameRequest}
    <RenameDialog initial={renameRequest.initial} onanswer={answerRename} />
  {/if}
  {#if preview}
    {#await import("./PreviewDialog.svelte") then { default: PreviewDialog }}
      <PreviewDialog file={preview} onclose={() => { preview = null; }} />
    {:catch}
      <p role="alert">Impossible de charger l’aperçu.</p>
    {/await}
  {/if}
</div>

<style>
  /* La barre garde sa place pendant la lecture de l’historique local. */
  .booting :global(#sidebar) { visibility: hidden; }
</style>
