<!-- Zone de saisie : mêmes ids et classes que l'ancienne interface (index.html, composer.js), donc mêmes feuilles de style. -->
<script lang="ts">
  import { untrack } from "svelte";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";
  import { canSend, imageTitle, studyLabel, uploadLabel, uploadsPending, webSearchTitle } from "../lib/services/chat-view.ts";
  import type { StudyMode } from "../lib/types/chat.ts";
  import { ICON_PATHS } from "../lib/utils/icons.ts";

  interface Props {
    chat: ChatStore;
  }

  let { chat }: Props = $props();

  let text = $state("");
  let prompt: HTMLTextAreaElement | undefined = $state();
  let attachOpen = $state(false);
  let studyOpen = $state(false);
  let photoInput: HTMLInputElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let cameraInput: HTMLInputElement | undefined = $state();

  const composer = $derived(chat.state.composer);
  const busy = $derived(chat.state.busy);
  const attachments = $derived(composer.attachments);
  // Les fichiers sont téléversés dès la sélection : l'envoi attend la fin (ou le retrait d'un fichier en échec).
  const uploading = $derived(uploadsPending(attachments));
  const ready = $derived(canSend(text, attachments.length, false) && !uploading);
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
      prompt?.focus();
    });
  });

  function submit(event?: Event) {
    event?.preventDefault();
    const engine = chat.engine;
    if (!engine) return;
    if (busy) {
      engine.stop();
      return;
    }
    if (!ready) return;
    if (engine.send(text)) {
      text = "";
      queueMicrotask(resize);
      return;
    }
    if (chat.state.pending) chat.toast("Une réponse interrompue attend d'être reprise.", true);
  }

  let composing = false;
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || composing) return;
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
    studyOpen = !studyOpen;
  }

  function chooseStudy(mode: StudyMode) {
    chat.engine?.setOption("studyMode", mode);
    closeMenus();
  }

  function onDocumentClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (target?.closest("#attach-menu, #study-menu, #attach")) return;
    closeMenus();
  }

  function onDocumentKey(event: KeyboardEvent) {
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

<svelte:document onclick={onDocumentClick} onkeydown={onDocumentKey} />

<form id="composer" class="composer" onsubmit={submit}>
  <div class="composer-box">
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
      <textarea id="prompt" rows="1" placeholder="Envoie un message" aria-label="Message" bind:this={prompt} bind:value={text} oninput={resize} onkeydown={onKeydown} oncompositionstart={() => (composing = true)} oncompositionend={() => (composing = false)}></textarea>
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
      {#if busy}
        <button type="submit" id="send" class="send stop" aria-label="Arrêter la génération" title="Arrêter la génération"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>
      {:else}
        <button type="submit" id="send" class="send" aria-label="Envoyer" title="Envoyer (Entrée)" disabled={!ready}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button>
      {/if}
    </div>
  </div>
  <p class="disclaimer">L'IA peut faire des erreurs.</p>
</form>
