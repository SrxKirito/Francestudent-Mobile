<!-- Fenêtre Paramètres Svelte. Les styles communs sont chargés par la coque. -->
<script lang="ts">
  import { tick } from "svelte";
  import type { Snippet } from "svelte";
  import ApiKeyPanel from "./ApiKeyPanel.svelte";
  import StoragePanel from "./StoragePanel.svelte";
  import McpPanel from "./McpPanel.svelte";
  import SkillsPanel from "./SkillsPanel.svelte";
  import AccountPanel from "./AccountPanel.svelte";
  import type { SettingsStore } from "../lib/stores/settings.svelte.ts";
  import { COMPRESSION_LEVELS, REASONING_LEVELS, WEB_MODES } from "../lib/services/general-settings.ts";
  import type { LibraryColumns, Theme } from "../lib/types/state.ts";
  import { PROVIDER_LOGOS } from "../lib/data/provider-logos.ts";
  import { agentLabel, providerMark } from "../lib/utils/agents.ts";
  import { applyTheme } from "../lib/utils/theme.ts";
  import { revealFocus } from "../lib/utils/reveal-focus.ts";

  interface Props {
    store: SettingsStore;
    showChatToggle?: boolean;
    onarchives?: () => void;
    onimport?: () => void;
    conversations?: Snippet;
    onconfirm?: (text: string) => Promise<boolean>;
  }

  type MenuId = "default" | "reasoning";

  const AUTO_MODEL_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const BUTTON_IDS: Record<MenuId, string> = { default: "default-model-button", reasoning: "gpt-reasoning-button" };
  const MENU_IDS: Record<MenuId, string> = { default: "default-model-menu", reasoning: "gpt-reasoning-menu" };
  const THEMES: readonly { id: Theme; label: string }[] = [
    { id: "system", label: "Système" },
    { id: "light", label: "Clair" },
    { id: "dark", label: "Sombre" }
  ];
  const COLUMNS: readonly LibraryColumns[] = [1, 2, 3, 4];
  const UNAVAILABLE = "Ce modèle est indisponible pour le moment.";

  let { store, showChatToggle = true, onarchives, onimport, conversations, onconfirm = async () => false }: Props = $props();

  let menu: MenuId | null = $state(null);
  let webDialog: HTMLDialogElement | undefined = $state();
  let opener: HTMLElement | null = null;

  const groups = $derived(store.groups);
  const valid = $derived(store.defaultValid);
  const current = $derived(valid ? groups.flatMap(group => group.agents).find(agent => agent.id === store.settings.defaultAgentId) ?? null : null);
  const reasoningLabel = $derived(REASONING_LEVELS.find(level => level.value === store.reasoning)?.label ?? REASONING_LEVELS[0].label);

  // Ouverture : bloque le défilement de la page, mémorise l'élément focalisé, met le focus sur « Fermer ».
  $effect(() => {
    if (!store.open) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("settings-open");
    void tick().then(() => document.getElementById("settings-close")?.focus());
    return () => {
      document.body.classList.remove("settings-open");
      menu = null;
      const back = opener;
      opener = null;
      if (back && back.isConnected && back.getClientRects().length > 0) back.focus();
    };
  });

  // Sous-dialogue « Recherche web » : piloté par le store.
  $effect(() => {
    const el = webDialog;
    if (!el) return;
    if (store.webOpen && !el.open) el.showModal();
    else if (!store.webOpen && el.open) el.close();
  });

  function focusButton(id: MenuId) {
    document.getElementById(BUTTON_IDS[id])?.focus();
  }

  async function toggleMenu(id: MenuId) {
    if (menu === id) {
      menu = null;
      return;
    }
    menu = id;
    await tick();
    const list = document.getElementById(MENU_IDS[id]);
    const target = list?.querySelector<HTMLElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? list?.querySelector<HTMLElement>('.model-option:not([aria-disabled="true"])');
    target?.focus();
  }

  function pickDefault(id: number | null, available: boolean) {
    if (!available) return;
    store.setDefaultAgent(id);
    menu = null;
    focusButton("default");
  }

  function pickReasoning(value: (typeof REASONING_LEVELS)[number]["value"]) {
    store.reasoning = value;
    menu = null;
    focusButton("reasoning");
  }

  function chooseTheme(theme: Theme) {
    store.setTheme(theme);
    applyTheme(theme, document.documentElement);
  }

  function columnKey(event: KeyboardEvent, columns: LibraryColumns) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = ((columns - 1 + step + COLUMNS.length) % COLUMNS.length + 1) as LibraryColumns;
    store.setLibraryColumns(next);
    void tick().then(() => document.querySelector<HTMLElement>('[data-library-columns="' + next + '"]')?.focus());
  }

  function tabKey(event: KeyboardEvent, index: number) {
    const last = store.tabs.length - 1;
    let next = -1;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    document.getElementById("tab-" + store.tabs[next].id)?.focus();
  }

  function focusables(): HTMLElement[] {
    const root = document.getElementById("settings-menu");
    if (!root) return [];
    const list = root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]");
    return [...list].filter(el => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
  }

  function trap(event: KeyboardEvent) {
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && items.includes(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function navigate(event: KeyboardEvent) {
    if (!menu || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const list = document.getElementById(MENU_IDS[menu]);
    const items = [...(list?.querySelectorAll<HTMLElement>('.model-option:not([aria-disabled="true"])') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
    else if (event.key === "ArrowUp") next = at <= 0 ? items.length - 1 : at - 1;
    else if (event.key === "End") next = items.length - 1;
    event.preventDefault();
    items[next].focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!store.open) return;
    if (event.key === "Escape") {
      if (menu) {
        const id = menu;
        menu = null;
        event.preventDefault();
        focusButton(id);
        return;
      }
      if (store.webOpen || (event.target instanceof Element && event.target.closest("dialog[open]"))) return;
      event.preventDefault();
      store.close();
      return;
    }
    if (store.webOpen || (event.target instanceof Element && event.target.closest("dialog[open]"))) return;
    if (event.key === "Tab") trap(event);
    else navigate(event);
  }

  function onDocumentClick(event: MouseEvent) {
    if (!menu) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".default-model-field")) return;
    menu = null;
  }

  function submitPreferences(event: Event) {
    event.preventDefault();
    void store.savePreferences();
  }

  function submitWeb(event: Event) {
    event.preventDefault();
    void store.saveWeb();
  }

  function cancelWeb(event: Event) {
    event.preventDefault();
    store.closeWeb();
  }
</script>

<svelte:document onkeydown={onKeydown} onclick={onDocumentClick} />

{#snippet caret()}
  <span class="model-caret" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
{/snippet}

{#snippet check()}
  <span class="model-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></span>
{/snippet}

{#if store.open}
  <div id="settings-modal" class="settings-modal">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="settings-backdrop" data-settings-close onclick={() => store.close()}></div>
    <div id="settings-menu" class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" use:revealFocus>
      <header class="settings-header">
        <h2 id="settings-title">Paramètres</h2>
        <button type="button" id="settings-close" class="settings-icon-btn" data-settings-close aria-label="Fermer les paramètres" title="Fermer" onclick={() => store.close()}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </header>
      <div class="settings-body">
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role : balisage identique à l'écran classique (testé) -->
        <nav id="settings-tablist" class="settings-tabs" role="tablist" aria-label="Sections des paramètres">
          {#each store.tabs as tab, index (tab.id)}
            {@const selected = store.tab === tab.id}
            <button type="button" class="settings-tab" class:active={selected} role="tab" id={"tab-" + tab.id} data-tab={tab.id} aria-controls={"panel-" + tab.id} aria-selected={selected ? "true" : "false"} tabindex={selected ? undefined : -1} onclick={() => store.selectTab(tab.id)} onkeydown={event => tabKey(event, index)}>
              {#if tab.id === "account"}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
              {:else if tab.id === "general"}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
              {:else if tab.id === "mcp"}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4"/></svg>
              {/if}
              <span>{tab.label}</span>
            </button>
          {/each}
        </nav>
        <div class="settings-panels">
          {#if store.tab === "general"}
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role : balisage identique à l'écran classique (testé) -->
            <section id="panel-general" class="settings-panel" data-panel="general" role="tabpanel" aria-labelledby="tab-general">
              {@render conversations?.()}
              {#if onimport}
                <button id="conversation-import-open" type="button" class="settings-btn" onclick={onimport}>Importer une conversation</button>
              {/if}
              <h3 class="settings-section-title">Apparence</h3>
              <div class="theme-choices" role="radiogroup" aria-label="Thème">
                {#each THEMES as theme (theme.id)}
                  <button type="button" class="theme-choice" data-theme-choice={theme.id} role="radio" aria-checked={store.settings.theme === theme.id ? "true" : "false"} onclick={() => chooseTheme(theme.id)}><span class={"theme-swatch swatch-" + theme.id} aria-hidden="true"></span><span>{theme.label}</span></button>
                {/each}
              </div>
              <h3 class="settings-section-title" id="library-layout-label">Affichage de la bibliothèque</h3>
              <div class="library-layout-choices" role="radiogroup" aria-labelledby="library-layout-label">
                {#each COLUMNS as columns (columns)}
                  {@const active = store.settings.libraryColumns === columns}
                  <button type="button" class="theme-choice library-layout-choice" data-library-columns={String(columns)} role="radio" aria-checked={active ? "true" : "false"} tabindex={active ? 0 : -1} onclick={() => store.setLibraryColumns(columns)} onkeydown={event => columnKey(event, columns)}><span class="library-layout-sample" style={"--sample-columns:" + columns} aria-hidden="true">{#each { length: columns * 3 } as _, cell (cell)}<i></i>{/each}</span><span>{columns === 1 ? "1 colonne" : columns + " colonnes"}</span></button>
                {/each}
              </div>
              <section class="tauri-interface-choice">
                <h3 class="settings-section-title" id="tauri-interface-label">Interface</h3>
                <div class="theme-choices tauri-interface-choices" style="grid-template-columns: repeat(2, 1fr)" role="radiogroup" aria-labelledby="tauri-interface-label">
                  <button type="button" class="theme-choice" data-ui-choice="legacy" role="radio" aria-checked={store.interfaceChoice.ui === "legacy" ? "true" : "false"} onclick={() => store.chooseUi("legacy")}><span>Interface classique</span></button>
                  <button type="button" class="theme-choice" data-ui-choice="svelte" role="radio" aria-checked={store.interfaceChoice.ui === "svelte" ? "true" : "false"} onclick={() => store.chooseUi("svelte")}><span>Interface Svelte 5 (bêta)</span></button>
                </div>
                {#if showChatToggle}<button type="button" class="settings-btn small" data-ui-chat role="switch" aria-checked={store.interfaceChoice.chat ? "true" : "false"} hidden={store.interfaceChoice.ui !== "svelte"} onclick={() => store.toggleChat()}>Utiliser aussi le nouveau chat (bêta)</button>{/if}
                <p class="settings-hint" data-ui-status role="status">{store.interfaceStatus}</p>
              </section>
              <h3 class="settings-section-title">Notifications</h3>
              <button id="completion-notifications" type="button" class="settings-btn" disabled={!store.catalog.notificationsSupported || store.notificationsBusy} onclick={() => void store.toggleNotifications()}>{store.settings.completionNotifications ? "Désactiver les notifications" : "Activer les notifications"}</button>
              <p id="completion-notifications-status" class="settings-hint" role="status">{store.notificationsStatus}</p>
              <h3 class="settings-section-title" id="default-model-label">Modèle par défaut</h3>
              <h4 class="settings-subtitle">Texte</h4>
              <p class="settings-hint">Utilisé pour toute nouvelle conversation.</p>
              <div class="settings-field default-model-field">
                <button id="default-model-button" class="model-button default-model-button" type="button" aria-haspopup="listbox" aria-expanded={menu === "default" ? "true" : "false"} aria-labelledby="default-model-label" title={"Modèle par défaut : " + (current ? agentLabel(current) : "automatique (dernier utilisé)")} onclick={() => void toggleMenu("default")}>
                  <span id="default-model-logo" class="model-logo" aria-hidden="true">{@html current ? providerMark(current, PROVIDER_LOGOS) : AUTO_MODEL_MARK}</span>
                  <span id="default-model-name" class="model-name"><span class="model-title">{current ? agentLabel(current) : "Automatique"}</span></span>
                  {@render caret()}
                </button>
                <div id="default-model-menu" class="popover model-menu default-model-menu" class:hidden={menu !== "default"} role="listbox" aria-label="Modèle par défaut">
                  <button type="button" class="model-option" role="option" data-id="" aria-selected={valid ? "false" : "true"} onclick={() => pickDefault(null, true)}>
                    <span class="model-logo" aria-hidden="true">{@html AUTO_MODEL_MARK}</span>
                    <span class="model-option-text"><span class="model-option-name">Automatique (dernier utilisé)</span></span>
                    {#if !valid}{@render check()}{/if}
                  </button>
                  {#each groups as group (group.provider)}
                    <div class="menu-label">{group.provider}</div>
                    {#each group.agents as agent (agent.id)}
                      {@const selected = valid && agent.id === store.settings.defaultAgentId}
                      {@const available = agent.available !== false}
                      <button type="button" class="model-option" class:unavailable={!available} role="option" data-id={String(agent.id)} aria-selected={selected ? "true" : "false"} aria-disabled={available ? undefined : "true"} title={available ? undefined : UNAVAILABLE} onclick={() => pickDefault(agent.id, available)}>
                        <span class="model-logo" aria-hidden="true">{@html providerMark(agent, PROVIDER_LOGOS)}</span>
                        <span class="model-option-text"><span class="model-option-name">{agentLabel(agent)}</span></span>
                        {#if !available}<span class="model-badge">Indisponible</span>{:else if selected}{@render check()}{/if}
                      </button>
                    {/each}
                  {/each}
                </div>
              </div>
              <div class="settings-image-section">
                <h4 class="settings-subtitle">Génération d'images</h4>
                <label class="settings-toggle-row" for="image-tool-toggle">
                  <span class="settings-switch-text">
                    <span class="settings-switch-title">Générer des images dans le chat</span>
                    <span class="settings-hint">Le modèle crée une image dès que vous la demandez, sans passer par l'icône image.</span>
                  </span>
                  <span class="settings-switch"><input type="checkbox" id="image-tool-toggle" role="switch" checked={store.settings.imageTool} aria-checked={store.settings.imageTool ? "true" : "false"} onchange={event => store.setImageTool(event.currentTarget.checked)}>
                    <span class="settings-switch-track" aria-hidden="true"></span></span>
                </label>
              </div>
              <div class="general-section">
                <h3 class="settings-section-title">Outils</h3>
                <button id="web-settings-open" class="general-setting-link" type="button" disabled={store.loadState !== "ready"} onclick={() => store.openWeb()}><strong>Recherche web</strong><span><span id="web-settings-summary">{store.webSummary}</span> <span aria-hidden="true">›</span></span></button>
              </div>
              <form id="personalization-form" class="settings-form general-section" onsubmit={submitPreferences}>
                <fieldset id="personalization-fields" disabled={store.fieldsDisabled}>
                  <div class="general-section-head"><h3 class="settings-section-title">Paramètres ChatGPT</h3></div>
                  <div class="general-setting-row">
                    <div><label id="gpt-reasoning-title" for="gpt-reasoning-button"><strong>Niveau de réflexion</strong></label><p class="settings-hint">Préférence héritée pour les modèles GPT.</p></div>
                    <div class="settings-field default-model-field reasoning-field">
                      <input id="gpt-reasoning" type="hidden" value={store.reasoning}>
                      <button id="gpt-reasoning-button" class="model-button default-model-button" type="button" aria-haspopup="listbox" aria-controls="gpt-reasoning-menu" aria-expanded={menu === "reasoning" ? "true" : "false"} aria-labelledby="gpt-reasoning-title gpt-reasoning-label" onclick={() => void toggleMenu("reasoning")}><span class="model-name"><span id="gpt-reasoning-label" class="model-title">{reasoningLabel}</span></span>{@render caret()}</button>
                      <div id="gpt-reasoning-menu" class="popover model-menu default-model-menu" class:hidden={menu !== "reasoning"} role="listbox" aria-labelledby="gpt-reasoning-title">
                        {#each REASONING_LEVELS as level (level.value)}
                          <button type="button" class="model-option" role="option" data-reasoning={level.value} aria-selected={store.reasoning === level.value ? "true" : "false"} onclick={() => pickReasoning(level.value)}>{level.label}</button>
                        {/each}
                      </div>
                    </div>
                  </div>
                  <section class="general-section" aria-labelledby="compression-title">
                    <h3 id="compression-title" class="settings-section-title">Compression du contexte</h3>
                    <p class="settings-hint">Raccourcit les anciens messages avant leur envoi au modèle. Le niveau maximal peut atténuer certaines nuances.</p>
                    <label class="settings-label">Niveau<select id="prompt-compression" class="settings-input" value={store.compression ?? "off"} onchange={event => {
                      store.compression = COMPRESSION_LEVELS.find(level => level.value === event.currentTarget.value)?.value;
                    }}>{#each COMPRESSION_LEVELS as level (level.value)}<option value={level.value}>{level.label}</option>{/each}</select></label>
                  </section>
                  <div class="general-section"><label for="custom-instructions" class="settings-label">Instructions personnalisées</label><p class="settings-hint">Indique le ton, le format et les consignes à suivre dans vos réponses.</p><textarea id="custom-instructions" class="settings-input" rows="6" placeholder="Comment souhaites-tu que l’assistant réponde ?" bind:value={store.instructions}></textarea><p class="settings-hint">Appliquées à vos conversations.</p></div>
                  <button type="submit" id="personalization-save" class="settings-btn primary">Enregistrer</button>
                </fieldset>
              </form>
              <p id="personalization-status" class="settings-hint" class:general-status-error={store.statusError} role="status" aria-live="polite">{store.status}</p>
              <button type="button" id="personalization-retry" class="settings-btn" hidden={!store.retryVisible} onclick={() => void store.loadPreferences()}>Réessayer</button>
              {#if store.localError}
                <p class="settings-hint general-status-error" role="alert">{store.localError}</p>
              {/if}
              <dialog id="web-settings-dialog" class="mcp-wizard" aria-labelledby="web-settings-title" bind:this={webDialog} oncancel={cancelWeb}>
                <header class="mcp-wizard-head"><h3 id="web-settings-title">Recherche web</h3><button type="button" id="web-settings-close" class="settings-icon-btn" aria-label="Fermer" onclick={() => store.closeWeb()}>×</button></header>
                <form id="web-settings-form" class="settings-form" onsubmit={submitWeb}>
                  <fieldset id="web-settings-fields" disabled={store.webFieldsDisabled}>
                    <label class="settings-label">Accès au web<select id="web-search-mode" class="settings-input" bind:value={store.webMode}>{#each WEB_MODES as mode (mode.value)}<option value={mode.value}>{mode.label}</option>{/each}</select></label>
                    <div id="web-domain-options" class="general-section" hidden={store.webMode !== "filtered"}><label class="settings-label">Filtre<select id="web-filter-type" class="settings-input" bind:value={store.webFilterType}><option value="allowlist">Autoriser uniquement ces sites</option><option value="blocklist">Exclure ces sites</option></select></label>
                      <label id="web-allowed-field" class="settings-label" hidden={store.webFilterType !== "allowlist"}>Sites autorisés<textarea id="web-allowed-domains" class="settings-input" rows="5" placeholder={"wikipedia.org\nfrancestudent.org"} bind:value={store.webAllowed}></textarea></label>
                      <label id="web-blocked-field" class="settings-label" hidden={store.webFilterType !== "blocklist"}>Sites exclus<textarea id="web-blocked-domains" class="settings-input" rows="5" placeholder="exemple.com" bind:value={store.webBlocked}></textarea></label>
                      <p class="settings-hint">Un domaine par ligne, sans chemin ni paramètres.</p>
                    </div>
                    <footer class="mcp-wizard-footer"><button type="button" id="web-settings-cancel" class="settings-btn" onclick={() => store.closeWeb()}>Annuler</button><button type="submit" id="web-settings-save" class="settings-btn primary" disabled={store.webSaveDisabled}>Enregistrer</button></footer>
                  </fieldset>
                  <p id="web-settings-status" class="settings-hint" class:general-status-error={store.webStatusError} role="status" aria-live="polite">{store.webStatus}</p>
                  <button type="button" id="web-settings-retry" class="settings-btn" hidden={!store.webRetryVisible} onclick={() => store.reloadWeb()}>Réessayer</button>
                </form>
              </dialog>
            </section>
          {:else if store.tab === "account" && store.accountPanel}
            <AccountPanel account={store.accountPanel}>
              {#if store.api}<ApiKeyPanel api={store.api} {onconfirm} />{/if}
            </AccountPanel>
          {:else if store.tab === "skills" && store.skillsPanel}
            <SkillsPanel skills={store.skillsPanel} {onconfirm} />
          {:else if store.tab === "mcp" && store.api}
            <McpPanel api={store.api} {onconfirm} />
          {:else if store.tab === "storage" && store.workspace}
            <StoragePanel engine={store.workspace} {onconfirm} {onarchives} onskills={() => store.selectTab("skills")} />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
