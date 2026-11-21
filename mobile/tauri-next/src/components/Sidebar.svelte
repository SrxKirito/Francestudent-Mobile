<script lang="ts">
  import logo from "../../../www/image.png";
  import ArchivedChats from "./ArchivedChats.svelte";
  import HistoryList from "./HistoryList.svelte";
  import RemoteSearchResults from "./RemoteSearchResults.svelte";
  import { NO_ARCHIVE, NO_REMOTE_SEARCH } from "../lib/services/legacy-engine.ts";
  import type { ArchiveState, RemoteSearchState } from "../lib/services/legacy-engine.ts";
  import type { Conversation } from "../lib/types/conversation.ts";
  import type { SidebarProject } from "../lib/types/sidebar.ts";
  import type { HistoryGroup } from "../lib/utils/history.ts";

  interface Props {
    /** Tiroir ouvert (écrans étroits). */
    open: boolean;
    query?: string;
    archive?: ArchiveState;
    remoteSearch?: RemoteSearchState;
    onsearchcomposition?: (active: boolean) => void;
    ontogglearchive?: () => void;
    onrestorearchived?: (chatId: string) => void;
    ondownloadarchived?: (chatId: string) => void;
    onmorearchived?: () => void;
    onopenremote?: (index: number) => void;
    project: SidebarProject | null;
    projectStatus: string;
    userName: string;
    avatarSrc: string;
    settingsOpen: boolean;
    groups: HistoryGroup[];
    currentId: string | null;
    menuId: string | null;
    markFor: (conversation: Conversation) => { html: string; label: string };
    onopen: (id: string) => void;
    onmenu: (id: string, button: HTMLButtonElement) => void;
    onsearch: () => void;
    onhistoryscroll: () => void;
    onnewchat: () => void;
    onprojects: () => void;
    onlibrary: () => void;
    onprojectsettings: () => void;
    onleaveproject: () => void;
    onsettings: () => void;
    oncollapse: () => void;
  }

  let {
    open,
    query = $bindable(""),
    archive = NO_ARCHIVE,
    remoteSearch = NO_REMOTE_SEARCH,
    onsearchcomposition = () => {},
    ontogglearchive = () => {},
    onrestorearchived = () => {},
    ondownloadarchived = () => {},
    onmorearchived = () => {},
    onopenremote = () => {},
    project,
    projectStatus,
    userName,
    avatarSrc,
    settingsOpen,
    groups,
    currentId,
    menuId,
    markFor,
    onopen,
    onmenu,
    onsearch,
    onhistoryscroll,
    onnewchat,
    onprojects,
    onlibrary,
    onprojectsettings,
    onleaveproject,
    onsettings,
    oncollapse
  }: Props = $props();

  function onSearchKeydown(event: KeyboardEvent) {
    // Comme avant : Échap vide la recherche (la liste se recalcule seule, l'état est centralisé).
    if (event.key === "Escape") query = "";
  }
</script>

<aside id="sidebar" class="sidebar" class:open aria-label="Conversations">
  <div class="sidebar-brand">
    <img src={logo} class="brand-logo" alt="">
    <span class="brand-name">FRANCE STUDENT</span>
    <span class="brand-badge">BETA</span>
    <button id="sidebar-collapse" class="icon-button brand-collapse" type="button" aria-label="Masquer la barre latérale" title="Masquer la barre latérale" onclick={oncollapse}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg></button>
  </div>
  <div class="sidebar-top side-nav">
    <button id="new-chat" class="side-nav-item" type="button" onclick={onnewchat}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Nouvelle discussion</span></button>
    <label class="side-nav-item search-box"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="search-input" type="search" placeholder="Rechercher" autocomplete="off" spellcheck="false" aria-label="Rechercher dans les conversations" bind:value={query} oninput={onsearch} onkeydown={onSearchKeydown} oncompositionstart={() => onsearchcomposition(true)} oncompositionend={() => onsearchcomposition(false)}></label>
    {#if remoteSearch.status !== "" || remoteSearch.results.length > 0}<RemoteSearchResults search={remoteSearch} onopen={onopenremote} />{/if}
  </div>
  <button id="projects-open" class="side-nav-item" type="button" onclick={onprojects}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M7 10h10v7H7z"/></svg><span>Projets</span></button>
  <button id="library-open" class="side-nav-item" type="button" onclick={onlibrary}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4h6v16H4zM10 4h5v16h-5zM16 5l4-1 3 15-4 1z"/></svg><span>Bibliothèque</span></button>
  <div id="project-context" hidden={!project}><strong id="project-context-name">{project?.name ?? ""}</strong><button id="project-settings-open" class="side-nav-item" type="button" hidden={project?.sharedWithMe === true} onclick={onprojectsettings}>⚙ Paramètres du projet</button><button id="project-leave" class="side-nav-item" type="button" onclick={onleaveproject}>‹ Retour à la page principale</button><p id="project-status" class="settings-hint" role="status">{projectStatus}</p></div>
  {#if archive.available}<ArchivedChats {archive} ontoggle={ontogglearchive} onrestore={onrestorearchived} ondownload={ondownloadarchived} onmore={onmorearchived} />{/if}
  <HistoryList {groups} searching={query.trim() !== ""} {currentId} {menuId} {markFor} {onopen} {onmenu} onscroll={onhistoryscroll} />
  <div class="sidebar-bottom">
    <button id="user-button" class="user-button" type="button" aria-haspopup="dialog" aria-expanded={settingsOpen ? "true" : "false"} aria-controls="settings-modal" onclick={onsettings}>
      <img class="avatar avatar-img" src={avatarSrc} alt="" aria-hidden="true">
      <span class="user-name">{userName}</span>
      <span class="user-gear" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></span>
    </button>
  </div>
</aside>
