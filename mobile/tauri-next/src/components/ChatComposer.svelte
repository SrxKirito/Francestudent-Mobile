<!-- Zone de saisie : mêmes ids et classes que l'ancienne interface (index.html, composer.js), donc mêmes feuilles de style. -->
<script lang="ts">
  import { skillQuery } from "../lib/stores/skills.svelte.ts";
  import type { SkillsStore } from "../lib/stores/skills.svelte.ts";
  import { appSpeechReady, createDictation } from "../lib/services/dictation.ts";
  import { onMount, tick, untrack } from "svelte";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";
  import { canSend, imageTitle, studyLabel, uploadLabel, uploadsPending, webSearchTitle } from "../lib/services/chat-view.ts";
  import type { StudyMode } from "../lib/types/chat.ts";
  import { ICON_PATHS } from "../lib/utils/icons.ts";

  interface Props {
    chat: ChatStore;
    skills?: SkillsStore;
  }

  let { chat, skills }: Props = $props();

  let text = $state("");
  let prompt: HTMLTextAreaElement | undefined = $state();
  let micActive = $state(false);
  let speechBase = "";
  let dictation = $state.raw<ReturnType<typeof createDictation> | null>(null);
  onMount(() => {
    let mounted = true;
    void appSpeechReady().then(speech => {
      if (!mounted || !speech) return;
      dictation = createDictation(speech, {
        active: enabled => { micActive = enabled; },
        transcript: phrase => { text = speechBase + phrase; void tick().then(resize); },
        error: message => chat.toast(message, true),
        visible: () => !document.hidden && chat.visible
      });
    });
    return () => {
      mounted = false;
      void dictation?.stop();
    };
  });

  function toggleDictation() {
    if (!dictation) return;
    if (micActive) { void dictation.stop(); return; }
    speechBase = text && !/\s$/.test(text) ? text + " " : text;
    void dictation.start();
  }

  $effect(() => {
    // La dictée ne suit pas l'utilisateur d'une discussion à une autre.
    void chat.state.id;
    void chat.shell.conversations.projectId;
    void chat.visible;
    void dictation?.stop();
  });

  let attachOpen = $state(false);
  let studyOpen = $state(false);
  let photoInput: HTMLInputElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let cameraInput: HTMLInputElement | undefined = $state();

  let composing = $state(false);
  let dismissed = $state<string | null>(null);
  let activeSkill = $state(0);
  let checkingSkill = $state(false);
  const query = $derived(skillQuery(text));
  const skillMenu = $derived(Boolean(skills) && !composing && !chat.state.busy && query !== null && dismissed !== text);
  const choices = $derived(skillMenu ? skills?.choices(query ?? "") ?? [] : []);
  const selected = $derived(skills?.command(text) ?? null);

  $effect(() => {
    if (skillMenu) void skills?.load();
  });

  async function selectSkill(command: string) {
    text = "/" + command + " ";
    prompt?.focus({ preventScroll: true });
    await tick();
    prompt?.setSelectionRange(text.length, text.length);
    resize();
  }

  function promptInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
    if (micActive) void dictation?.stop();
    activeSkill = 0;
    dismissed = null;
    if (/^\s*\//.test(event.currentTarget.value)) void skills?.load();
    resize();
  }

  const composer = $derived(chat.state.composer);
  const busy = $derived(chat.state.busy && !chat.state.backgroundReply);
  const attachments = $derived(composer.attachments);
  // Les fichiers sont téléversés dès la sélection : l'envoi attend la fin (ou le retrait d'un fichier en échec).
  const uploading = $derived(uploadsPending(attachments));
  const ready = $derived(canSend(text, attachments.length, chat.state.backgroundReply === true) && !uploading);
  const activeTools = $derived.by(() => {
    const active: string[] = [];
    if (composer.webSearch && composer.webSearchMode !== "disabled") active.push("Recherche web");
    if (composer.imageMode) active.push("Image");
    if (composer.studyMode) active.push(studyLabel(composer.studyMode));
    return active;
  });
  const attachLabel = $derived("Outils et pièces jointes" + (activeTools.length > 0 ? ". Actifs : " + activeTools.join(", ") : ""));

  const STUDY_OPTIONS: { value: StudyMode; label: string }[] = [
    { value: "", label: "Désactivé" },
    { value: "fiches", label: "Fiches de révision" },
    { value: "quiz", label: "Quiz" },
    { value: "cartes", label: "Cartes mémoire" }
  ];

  function resize() {
    if (!prompt) return;
    prompt.style.height = "auto";
    const limit = Math.min(200, (window.visualViewport?.height || window.innerHeight) * 0.3);
    prompt.style.height = Math.min(prompt.scrollHeight, limit) + "px";
    prompt.style.overflowY = prompt.scrollHeight > limit ? "auto" : "hidden";
  }

  // « Modifier » (message envoyé ou en échec) remet le texte dans la zone : le moteur publie un nouveau brouillon.
  let seenDraft = untrack(() => chat.state.draft.seq);
  $effect(() => {
    const draft = chat.state.draft;
    if (draft.seq === seenDraft) return;
    seenDraft = draft.seq;
    text = draft.text;
    queueMicrotask(() => {
      resize();
      if (draft.text) prompt?.focus({ preventScroll: true });
    });
  });

  const promptContext = $derived(chat.interactiveContext?.conversationId === chat.state.id &&
    chat.interactiveContext.projectId === chat.shell.conversations.projectId ? chat.interactiveContext : null);
  $effect(() => {
    if (promptContext) prompt?.focus({ preventScroll: true });
  });

  async function submit(event?: Event) {
    event?.preventDefault();
    const engine = chat.engine;
    if (!engine) return;
    if (busy) {
      engine.stop();
      return;
    }
    if ((skillMenu && query === "") || !ready || checkingSkill) return;
    if (micActive) void dictation?.stop();
    const value = text;
    const conversation = chat.shell.conversations.currentId;
    const project = chat.shell.conversations.projectId;
    const context = promptContext;
    const catalog = skills;
    if (catalog && /^\s*\/[^\s/]+(?=\s|$)/.test(value)) {
      checkingSkill = true;
      const loaded = await catalog.load();
      checkingSkill = false;
      if (engine !== chat.engine || catalog !== skills || value !== text || busy || !ready ||
          conversation !== chat.shell.conversations.currentId || project !== chat.shell.conversations.projectId || context !== promptContext) return;
      if (!loaded || catalog.busy) {
        chat.toast(catalog.error || "Attends la fin de l’actualisation des skills.", true);
        return;
      }
    }
    const prefix = catalog?.prefix(value);
    const sent = context && context.conversationId === chat.state.id
      ? engine.sendWithInteractiveContext?.(value, context.data, prefix)
      : engine.send(value, prefix);
    if (sent) {
      chat.interactiveContext = null;
      text = "";
      queueMicrotask(resize);
      return;
    }
    if (chat.state.pending) chat.toast("Une réponse interrompue attend d'être reprise.", true);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing || composing) return;
    if (skillMenu) {
      const current = Math.min(activeSkill, choices.length - 1);
      if (event.key === "Escape") {
        dismissed = text;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (choices.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        activeSkill = (current + step + choices.length) % choices.length;
        document.getElementById("skill-choice-" + activeSkill)?.scrollIntoView({ block: "nearest" });
        event.preventDefault();
        return;
      }
      if (choices.length && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
        event.preventDefault();
        void selectSkill(choices[current].command);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!busy) submit();
  }

  function closeMenus() {
    attachOpen = false;
    studyOpen = false;
  }

  function toggleAttach(event: MouseEvent) {
    event.stopPropagation();
    const next = !attachOpen;
    closeMenus();
    attachOpen = next;
  }

  function pick(input: HTMLInputElement | undefined) {
    closeMenus();
    input?.click();
  }

  function onFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) chat.engine?.addFiles(files);
  }

  function toggleWeb() {
    if (composer.webSearchMode === "disabled") return;
    chat.engine?.setOption("webSearch", !composer.webSearch);
  }

  function toggleImage() {
    chat.engine?.setOption("imageMode", !composer.imageMode);
  }

  function toggleStudy(event: MouseEvent) {
    event.stopPropagation();
    const next = !studyOpen;
    closeMenus();
    studyOpen = next;
    if (next) void tick().then(() => document.querySelector<HTMLElement>("#study-menu button")?.focus());
  }

  function chooseStudy(mode: StudyMode) {
    chat.engine?.setOption("studyMode", mode);
    closeMenus();
    document.getElementById("attach")?.focus();
  }

  function onDocumentClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target?.closest("#prompt, #skill-menu")) dismissed = text;
    if (target?.closest("#attach-menu, #study-menu, #attach")) return;
    closeMenus();
  }

  function onDocumentKey(event: KeyboardEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const submenu = target?.closest("#study-menu");
    if (submenu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const options = [...submenu.querySelectorAll("button")];
      if (!options.length) return;
      const index = options.indexOf(target as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
        event.key === "ArrowDown" ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
      event.preventDefault();
      options[next]?.focus();
      return;
    }
    if (event.key === "Escape" && (attachOpen || studyOpen)) {
      closeMenus();
      document.getElementById("attach")?.focus();
    }
  }

  function removeAttachment(event: MouseEvent, id: string) {
    event.stopPropagation();
    chat.engine?.removeAttachment(id);
  }

  function retryUpload(event: MouseEvent, id: string) {
    event.stopPropagation();
    chat.engine?.retryUpload(id);
  }

  function previewPending(id: string) {
    chat.engine?.preview({ pending: id });
  }

  function onChipKey(event: KeyboardEvent, id: string) {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    previewPending(id);
  }
</script>

<svelte:document onvisibilitychange={() => { if (document.hidden) void dictation?.stop(); }} onclick={onDocumentClick} onkeydown={onDocumentKey} />

<form id="composer" class="composer" onsubmit={submit}>
  <div class="composer-box">
    {#if skillMenu}
      <div id="skill-menu" class="native-skill-menu" role="listbox" aria-label="Skills disponibles">
        {#each choices as choice, index (choice.skill.id)}
          <button id={"skill-choice-" + index} type="button" role="option" tabindex="-1" aria-selected={index === Math.min(activeSkill, choices.length - 1)} onmousedown={event => event.preventDefault()} onclick={() => void selectSkill(choice.command)}>
            <strong>/{choice.command}</strong>
            <span>{choice.skill.description || choice.skill.name}</span>
          </button>
        {:else}
          <p role="status">{skills?.loading ? "Chargement des skills…" : skills?.error || "Aucun skill correspondant."}</p>
        {/each}
      </div>
    {/if}
    {#if selected}<div class="native-skill-active">Skill sélectionné · /{selected.command}</div>{/if}
    {#if promptContext}
      <div class="app-context"><span>{promptContext.data.kind === "table" ? "Lignes jointes" : promptContext.data.kind === "editor" ? "Texte à réviser" : "Réglages joints"} · {promptContext.data.title}</span>
        <button type="button" aria-label={promptContext.data.kind === "table" ? "Retirer les lignes jointes" : promptContext.data.kind === "editor" ? "Retirer le texte à réviser" : "Retirer les réglages joints"} onclick={() => { chat.interactiveContext = null; }}>×</button>
      </div>
    {/if}
    <div id="attachments" class="attachments" class:hidden={attachments.length === 0} aria-label="Fichiers joints">
      {#each attachments as file (file.id)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
        <div
          class="attachment-chip"
          role="group"
          tabindex="0"
          aria-label={"Pièce jointe : " + file.name + ". Entrée pour l’aperçu."}
          onclick={() => previewPending(file.id)}
          onkeydown={event => onChipKey(event, file.id)}
        >
          {#if file.kind === "image"}
            <img src={chat.engine?.attachmentPreview(file.id) ?? ""} alt="">
          {:else}
            <span class="attachment-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICON_PATHS.file}</svg></span>
          {/if}
          <span class="attachment-name" title={file.name}>{file.name}</span>
          {#if file.upload}
            <span class="tauri-upload-status" role="status">{uploadLabel(file)}{#if file.upload === "error"} · <button type="button" onclick={event => retryUpload(event, file.id)}>Réessayer</button>{/if}</span>
          {/if}
          <button type="button" class="attachment-remove" data-id={file.id} aria-label={"Retirer " + file.name} onclick={event => removeAttachment(event, file.id)}>×</button>
        </div>
      {/each}
    </div>
    <div class="composer-actions">
      <button type="button" id="attach" class="tool-button icon-button" class:has-active-tools={activeTools.length > 0} aria-label={attachLabel} title={attachLabel} aria-controls="attach-menu" aria-haspopup="menu" aria-expanded={attachOpen ? "true" : "false"} onclick={toggleAttach}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <textarea id="prompt" rows="1" placeholder="Envoie un message" aria-label="Message" bind:this={prompt} bind:value={text} aria-controls={skillMenu ? "skill-menu" : undefined} aria-activedescendant={skillMenu && choices.length ? "skill-choice-" + Math.min(activeSkill, choices.length - 1) : undefined} oninput={promptInput} onkeydown={onKeydown} oncompositionstart={() => (composing = true)} oncompositionend={() => (composing = false)}></textarea>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <div id="attach-menu" class="popover attach-menu" class:hidden={!attachOpen} role="menu" tabindex="-1" aria-label="Outils et pièces jointes" onclick={event => event.stopPropagation()}>
        <button type="button" class="attach-option" role="menuitem" data-target="camera-input" onclick={() => pick(cameraInput)}><span class="attach-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span><span>Caméra</span></button>
        <button type="button" class="attach-option" role="menuitem" data-target="photo-input" onclick={() => pick(photoInput)}><span class="attach-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg></span><span>Photos</span></button>
        <button type="button" class="attach-option" role="menuitem" data-target="file-input" onclick={() => pick(fileInput)}><span class="attach-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5l-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2.5a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6.3"/></svg></span><span>Fichiers</span></button>
        <!-- svelte-ignore a11y_role_supports_aria_props : les feuilles historiques colorent l'état actif via [aria-pressed] -->
        <button type="button" id="toggle-web" role="menuitemcheckbox" class="tool-button toggle" aria-pressed={composer.webSearch ? "true" : "false"} aria-checked={composer.webSearch ? "true" : "false"} disabled={composer.webSearchMode === "disabled"} title={webSearchTitle(composer.webSearch, composer.webSearchMode)} onclick={toggleWeb}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg> <span>Recherche web</span></button>
        <!-- svelte-ignore a11y_role_supports_aria_props : idem -->
        <button type="button" id="toggle-image" role="menuitemcheckbox" class="tool-button toggle" aria-pressed={composer.imageMode ? "true" : "false"} aria-checked={composer.imageMode ? "true" : "false"} title={imageTitle(composer.imageMode)} onclick={toggleImage}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg> <span>Image</span></button>
        <!-- svelte-ignore a11y_role_supports_aria_props : idem -->
        <button type="button" id="toggle-study" role="menuitem" aria-controls="study-menu" aria-haspopup="menu" aria-expanded={studyOpen ? "true" : "false"} class="tool-button toggle" aria-pressed={composer.studyMode ? "true" : "false"} title="Mode étudiant : fiches, quiz ou cartes mémoire" onclick={toggleStudy}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg> <span id="study-label">{studyLabel(composer.studyMode)}</span></button>
      </div>
      <input type="file" id="photo-input" accept="image/*" multiple hidden bind:this={photoInput} onchange={onFiles}>
      <input type="file" id="file-input" multiple hidden bind:this={fileInput} onchange={onFiles}>
      <input type="file" id="camera-input" accept="image/*" capture="environment" hidden bind:this={cameraInput} onchange={onFiles}>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <div id="study-menu" class="popover image-model-menu" class:hidden={!studyOpen} role="menu" tabindex="-1" aria-label="Mode étudiant" onclick={event => event.stopPropagation()}>
        {#each STUDY_OPTIONS as option (option.value)}
          <button type="button" class="image-model-option" class:selected={composer.studyMode === option.value} role="menuitemradio" aria-checked={composer.studyMode === option.value ? "true" : "false"} data-study={option.value} onclick={() => chooseStudy(option.value)}><span class="image-model-name">{option.label}</span><span class="image-model-radio" aria-hidden="true"></span></button>
        {/each}
      </div>
      {#if dictation && !busy}
        <button type="button" id="mic" class="tool-button icon-button mic" aria-pressed={micActive} aria-label={micActive ? "Arrêter la dictée" : "Dicter un message"} onclick={toggleDictation}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
        </button>
      {/if}
      {#if busy}
        <button type="submit" id="send" class="send stop" aria-label="Arrêter la génération" title="Arrêter la génération"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>
      {:else}
        <button type="submit" id="send" class="send" aria-label="Envoyer" title="Envoyer (Entrée)" disabled={!ready}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button>
      {/if}
    </div>
  </div>
  <p class="disclaimer">{chat.state.backgroundReply ? "Une réponse est en cours dans une autre discussion." : "L'IA peut faire des erreurs."}</p>
</form>

<style>

  .composer-box { position: relative; }
  .app-context { display: flex; align-items: center; gap: .5rem; padding: 0 .65rem; font-size: .85rem; }
  .app-context span { overflow-wrap: anywhere; }
  .app-context button { min-width: 44px; min-height: 44px; color: inherit; background: transparent; border: 0; cursor: pointer; }
  .native-skill-menu { position: absolute; inset: auto 0 calc(100% + 8px); z-index: 25; max-height: min(280px, calc(var(--ios-viewport-height, 100dvh) * .38)); overflow-y: auto; overscroll-behavior: contain; padding: 6px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
  .native-skill-menu button { display: grid; gap: 3px; width: 100%; min-height: 44px; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; }
  .native-skill-menu button[aria-selected="true"] { background: var(--hover); }
  .native-skill-menu span, .native-skill-menu p { color: var(--muted); }
  .native-skill-active { padding: 4px 10px; color: var(--muted); font-size: .85rem; }
</style>
