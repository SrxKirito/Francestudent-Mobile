<!-- Chat Svelte : barre du haut, messages, saisie. Posé par-dessus l'iframe historique, qui reste le moteur (voir ChatStore). -->
<script lang="ts">
  import { tick } from "svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import ChatSources from "./ChatSources.svelte";
  import logo from "../../../www/image.png";
  import { liveStatus, liveVisible } from "../lib/services/chat-view.ts";
  import type { PreviewFile } from "../lib/services/file-preview.ts";
  import { studyLoading } from "../lib/services/study-content.ts";
  import { renderMarkdown } from "../lib/services/markdown.ts";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";
  import { PROVIDER_LOGOS } from "../lib/data/provider-logos.ts";
  import { agentLabel, providerMark } from "../lib/utils/agents.ts";

  import type { SkillsStore } from "../lib/stores/skills.svelte.ts";

  interface Props {
    skills?: SkillsStore;
    chat: ChatStore;
    openPreview?: (file: PreviewFile) => void;
    saveMessage?: (chatId: string, messageId: string) => Promise<void>;
  }

  let { chat, skills, openPreview, saveMessage }: Props = $props();

  let messagesEl: HTMLElement | undefined = $state();
  let modelOpen = $state(false);
  let showScroll = $state(false);
  let stick = true;

  const snap = $derived(chat.state);
  const live = $derived(chat.live);
  const agents = $derived(chat.shell.agents);
  const currentAgent = $derived(agents.find(agent => agent.id === snap.composer.agentId) ?? null);
  const showLive = $derived(liveVisible(snap, live));
  const indicator = $derived(liveStatus(live));
  const hasMessages = $derived(snap.messages.length > 0);
  const liveHtml = $derived.by(() => {
    void chat.katexReady;
    return live.text ? renderMarkdown(live.text, true, { study: studyLoading }) : "";
  });
  const providers = $derived.by(() => {
    const groups = new Map<string, typeof agents>();
    for (const agent of agents) {
      const key = agent.provider || "Autres modèles";
      groups.set(key, [...(groups.get(key) ?? []), agent]);
    }
    return [...groups];
  });
  const conversationAgent = $derived(snap.conversationAgent);
  const nextAgentDiffers = $derived(
    hasMessages && conversationAgent !== null && conversationAgent.id !== snap.composer.agentId
  );

  $effect(() => {
    chat.loadKatex();
  });

  function distance(): number {
    const el = messagesEl;
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  }

  function onScroll() {
    const gap = distance();
    stick = gap < 80;
    showScroll = gap > 200;
  }

  function toBottom(smooth = false) {
    stick = true;
    showScroll = false;
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  // Une nouvelle conversation ou un message envoyé ramène en bas ; pendant le flux on suit tant que l'élève n'a pas remonté.
  let lastConversation: string | null = null;
  $effect(() => {
    const id = snap.id;
    if (id !== lastConversation) {
      lastConversation = id;
      stick = true;
    }
  });

  $effect(() => {
    const last = snap.messages[snap.messages.length - 1];
    if (last?.role === "user") stick = true;
    void snap.messages.length;
    void live.text;
    void live.sources.length;
    void showLive;
    void tick().then(() => {
      if (stick) toBottom();
    });
  });

  function chooseModel(id: number | string) {
    if (!agents.some(agent => agent.id === id && agent.available)) return;
    modelOpen = false;
    chat.engine?.setAgent(id);
    document.getElementById("model-button")?.focus();
  }

  function onDocumentClick(event: MouseEvent) {
    if (!(event.target as Element | null)?.closest(".model-picker")) modelOpen = false;
  }

  function onDocumentKey(event: KeyboardEvent) {
    if (event.key === "Escape") modelOpen = false;
  }

  function resume() {
    chat.engine?.regenerate(snap.messages.length);
  }
</script>

<svelte:document onclick={onDocumentClick} onkeydown={onDocumentKey} />

<div class="main chat-pane" class:chat-pane-hidden={!chat.visible}>
  <header class="topbar">
    <button id="menu-toggle" class="icon-button" type="button" aria-label="Afficher la barre latérale" title="Afficher la barre latérale" onclick={event => { event.stopPropagation(); chat.shell.menuToggle(); }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div class="model-picker">
      <button id="model-button" class="model-button" type="button" aria-haspopup="listbox" aria-expanded={modelOpen ? "true" : "false"} title={currentAgent ? "Modèle : " + agentLabel(currentAgent) : "Choisir le modèle"} onclick={event => { event.stopPropagation(); modelOpen = !modelOpen; }}>
        <span id="model-logo" class="model-logo" aria-hidden="true">{@html providerMark(currentAgent, PROVIDER_LOGOS)}</span>
        <span id="model-name" class="model-name"><span class="model-title">{currentAgent ? agentLabel(currentAgent) : "Modèle"}</span></span>
        <span class="model-caret" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
      </button>
      <div id="model-menu" class="popover model-menu" class:hidden={!modelOpen} role="listbox" aria-label="Modèles">
        {#each providers as [provider, list] (provider)}
          <div class="menu-label">{provider}</div>
          {#each list as agent (agent.id)}
            {@const selected = agent.id === snap.composer.agentId}
            <button type="button" class="model-option" role="option" aria-selected={selected ? "true" : "false"} aria-disabled={!agent.available} disabled={!agent.available} data-id={String(agent.id)} onclick={() => chooseModel(agent.id)}>
              <span class="model-logo" aria-hidden="true">{@html providerMark(agent, PROVIDER_LOGOS)}</span>
              <span class="model-option-text"><span class="model-option-name">{agentLabel(agent)}</span>{#if !agent.available}<span class="model-option-name">Indisponible</span>{/if}</span>
              {#if selected}<span class="model-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></span>{/if}
            </button>
          {/each}
        {/each}
      </div>
    </div>
    <span class="topbar-spacer"></span>
  </header>

  <div class="chat-area">
    <section id="messages" class="messages" bind:this={messagesEl} onscroll={onScroll}>
      <div id="conversation-model" class="conversation-model" class:hidden={!hasMessages || conversationAgent === null}>
        {#if conversationAgent}
          <span>Modèle de cette discussion : <strong>{agentLabel(conversationAgent)}</strong></span>
          {#if nextAgentDiffers}
            <div class="conversation-model-note">Le prochain message utilisera {currentAgent ? agentLabel(currentAgent) : "le modèle choisi"} et démarrera une nouvelle discussion côté serveur.</div>
          {/if}
        {/if}
      </div>
      <div id="empty-state" class="empty-state" class:hidden={hasMessages || showLive}>
        <img class="logo logo-img" src={logo} alt="FranceStudent">
        <h2>Comment puis-je t'aider ?</h2>
        <p class="empty-help">Pose une question, demande une explication ou fais relire un texte.</p>
      </div>
      <div id="thread" class="thread" aria-live="polite">
        {#each snap.messages as message (String(snap.id) + ":" + message.index)}
          <ChatMessage {message} {chat} {openPreview} {saveMessage} />
        {/each}
        {#if showLive}
          <div class="message assistant message-enter">
            {#if live.sources.length > 0}<ChatSources sources={live.sources} searching={live.searching} initiallyOpen />{/if}
            {#if live.tools?.length}
              <ul class="tool-progress" aria-label="Outils MCP" aria-live="polite">
                {#each live.tools as tool (tool.id)}
                  <li>{tool.label || "Outil MCP"} · {tool.status === "in_progress" ? "En cours" : tool.status === "completed" ? "Terminé" : "Échec"}</li>
                {/each}
              </ul>
            {/if}
            <div class="bubble pending" class:streaming={live.text !== ""} class:searching={indicator === "search"} class:image-generating={live.imageStarted}>
              {#if indicator === "typing"}
                <span class="typing-indicator" role="status" aria-label="Génération en cours"><span></span><span></span><span></span></span>
              {:else if indicator === "search"}
                <div class="web-search-indicator" role="status" aria-live="polite">
                  <div class="web-search-pill"><span class="web-search-globe" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span class="web-search-spinner"></span></span><span class="web-search-label">Recherche sur le web…</span></div>
                  <div class="web-search-grid" aria-hidden="true">
                    {#each [0, 1, 2, 3] as card (card)}
                      <div class="web-search-card"><span class="sk sk-line"></span><span class="sk sk-line short"></span><span class="sk-row"><span class="sk sk-dot"></span><span class="sk sk-line tiny"></span></span></div>
                    {/each}
                  </div>
                </div>
              {:else if indicator === "image"}
                <span class="typing-indicator" role="status" aria-label="Génération en cours"><span></span><span></span><span></span></span>
              {:else}
                {@html liveHtml}
              {/if}
            </div>
            {#if live.imageStarted}
              <div class="generated-images">
                <figure class="generated-image image-gen-placeholder">
                  <div class="image-gen-loader" role="status" aria-live="polite" aria-label="Création de l'image en cours">
                    <span class="image-gen-glow" aria-hidden="true"></span>
                    <span class="image-gen-frame" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg></span>
                    <span class="image-gen-label">Création de l'image<span class="image-gen-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
                    <span class="image-gen-bar" aria-hidden="true"><span></span></span>
                  </div>
                </figure>
              </div>
            {/if}
          </div>
        {/if}
        {#if snap.pending && !snap.busy}
          <div class="message error message-enter">
            <div class="bubble">Une réponse est restée interrompue.</div>
            <div class="message-actions error-actions">
              <button type="button" class="msg-action retry-action" onclick={resume}><span>Reprendre</span></button>
            </div>
          </div>
        {/if}
      </div>
    </section>
    <button id="scroll-bottom" class="scroll-bottom" class:hidden={!showScroll} type="button" aria-label="Aller en bas" title="Aller en bas" onclick={() => toBottom(true)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg></button>
  </div>

  <ChatComposer {chat} {skills} />
</div>
