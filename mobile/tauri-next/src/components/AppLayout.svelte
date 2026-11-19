<script lang="ts">
  import { onDestroy } from "svelte";
  import logo from "../../../www/image.png";
  import ConversationMenu from "./ConversationMenu.svelte";
  import LegacyFrame from "./LegacyFrame.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ChatPane from "./ChatPane.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import PinDialog from "./PinDialog.svelte";
  import SharesDialog from "./SharesDialog.svelte";
  import ToastHost from "./ToastHost.svelte";
  import { connectChatEngine } from "../lib/services/chat-engine.ts";
  import { ChatStore } from "../lib/stores/chat.svelte.ts";
  import { connectLegacyEngine } from "../lib/services/legacy-engine.ts";
  import { ShellStore } from "../lib/stores/shell.svelte.ts";
  import { applyTheme } from "../lib/utils/theme.ts";

  interface Props {
    /** Magasin de la coque ; créé ici par défaut (les tests en fournissent un déjà rempli). */
    store?: ShellStore;
    /** Chat Svelte (?chat=svelte) : la zone de conversation est dessinée ici ; l'iframe reste le moteur (auth, transport, persistance). */
    chatMode?: boolean;
  }

  let {
    chatMode = false,
    store = new ShellStore({
      width: typeof window === "undefined" ? 390 : window.innerWidth,
      onTheme: theme => applyTheme(theme, document.documentElement)
    })
  }: Props = $props();

  // « image.png » est l'avatar par défaut de l'ancienne interface : ici, le même logo, fourni par le bundle.
  const avatarSrc = $derived(store.avatar === "" || store.avatar === "image.png" ? logo : store.avatar);

  // Chat Svelte : créé une seule fois ; sans pont de chat dans l'iframe, la surcouche reste absente (le chat historique sert).
  // svelte-ignore state_referenced_locally
  const chat = chatMode ? new ChatStore(store) : null;

  function onFrame(frameWindow: Window | null) {
    const engine = connectLegacyEngine(frameWindow);
    if (engine) store.connect(engine);
    else store.markUnavailable();
    const chatEngine = chat ? connectChatEngine(frameWindow) : null;
    if (chat && chatEngine) chat.connect(frameWindow, chatEngine);
  }

  function shareMenuConversation() {
    const id = store.menu?.id;
    store.closeMenus();
    if (id && chat) chat.openShares(id);
  }

  function importConversation() {
    if (store.drawerOpen) store.overlayClick();
    chat?.openImport();
  }

  // La mise en page (barre fixe ou non, repliée ou non) est communiquée à l'ancienne interface, qui en dépend pour
  // masquer son propre bouton « Afficher la barre latérale » et sa propre barre.
  $effect(() => {
    store.engine?.setLayout(store.layout);
  });

  // La recherche (saisie ou Échap) est recopiée dans l'ancien champ : recherche sur le serveur et filtre historique suivent.
  $effect(() => {
    store.syncSearch(store.conversations.query);
  });

  onDestroy(() => {
    chat?.disconnect();
    store.disconnect();
  });
</script>

<svelte:window onresize={() => store.resize(window.innerWidth)} />
<!-- Les clics dans l'iframe n'arrivent pas ici : le pont les signale (hôte.closeMenus). -->
<svelte:document onclick={() => store.closeMenus()} />

<div class="app" class:sidebar-collapsed={store.collapsed} class:booting={!store.ready}>
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
      settingsOpen={store.settingsOpen}
      groups={store.conversations.groups(Date.now())}
      currentId={store.conversations.currentId}
      menuId={store.menu?.id ?? null}
      markFor={store.markFor}
      onopen={id => store.open(id)}
      onmenu={(id, button) => store.toggleMenu(id, button.getBoundingClientRect())}
      onsearch={() => store.searched()}
      onhistoryscroll={() => store.historyScrolled()}
      onnewchat={() => store.newChat()}
      onprojects={() => store.projects()}
      onlibrary={() => store.library()}
      onprojectsettings={() => store.projectSettings()}
      onleaveproject={() => store.leaveProject()}
      onsettings={() => store.settings()}
      oncollapse={() => store.collapse()}
      onimport={chat ? importConversation : undefined}
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
      ondelete={() => store.menuAction("deleteConversation")}
      onshare={chat ? shareMenuConversation : undefined}
    />
  {/if}
  <main class="main">
    <LegacyFrame onframe={onFrame} inert={chat?.visible ?? false} />
    {#if chat}
      <ChatPane {chat} />
      <ToastHost {chat} />
      <ConfirmDialog {chat} />
      <PinDialog {chat} />
      <ImportDialog {chat} />
      <SharesDialog {chat} />
    {/if}
  </main>
</div>

<style>
  /* Tant que l'ancienne interface n'est pas prête, la barre reste invisible mais garde sa place (pas de saut de mise en page). */
  .booting :global(#sidebar) { visibility: hidden; }
</style>
