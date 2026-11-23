<!-- Un message du chat : mêmes classes que l'ancienne interface (assistant.js), donc mêmes feuilles de style. -->
<script lang="ts">
  import ImageSearchGallery from "./ImageSearchGallery.svelte";
  import ChatSources from "./ChatSources.svelte";
  import MessageContent from "./MessageContent.svelte";
  import type { PreviewFile } from "../lib/services/file-preview.ts";
  import { generatedImageFile } from "../lib/services/file-preview.ts";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";
  import type { EditorTarget } from "../lib/services/document-editor.ts";
  import type { InteractiveContent } from "../lib/services/interactive-content.ts";
  import type { AppSession } from "../lib/services/interactive-app-session.ts";
  import { attachmentIcon } from "../lib/services/chat-view.ts";
  import { fileIconSvg } from "../lib/services/markdown.ts";
  import type { ChatImage, ChatMessage } from "../lib/types/chat.ts";
  import { copyText } from "../lib/utils/clipboard.ts";
  import { icon } from "../lib/utils/icons.ts";

  interface Props {
    message: ChatMessage;
    chat: ChatStore;
    openPreview?: (file: PreviewFile) => void;
  }

  let { message, chat, openPreview }: Props = $props();

  function appSession(fence: EditorTarget, kind: InteractiveContent["kind"]): AppSession | undefined {
    const id = chat.state.id;
    if (!id) return;
    const followUp: AppSession["followUp"] = chat.engine?.sendWithInteractiveContext ? context => chat.useInteractiveContext(id,
      context.kind === "editor" ? { ...context, message: message.index, block: fence } : context) : undefined;
    return kind === "editor" ? chat.editorSession(id, message.index, fence, followUp)
      : chat.appSessions.forBlock(id, message.index, fence, followUp);
  }

  const editorRequest = $derived(chat.state.messages[message.index - 1]?.editorRequest);
  const applyEditorEdit = $derived.by(() => {
    const id = chat.state.id;
    const request = editorRequest;
    return id && request && request.message < message.index - 1
      ? (replacement: string) => chat.applyEditorSuggestion(id, request, replacement) : undefined;
  });

  let copied = $state(false);

  /** Une image remplacée lors d'une régénération ne réutilise pas la source de l'ancienne. */
  let imageSources = $state.raw<Record<string, string | null>>({});
  const requested = new Set<string>();
  const hasImages = $derived((message.images?.length ?? 0) > 0);
  const text = $derived(message.content.trim());

  function imageKey(image: ChatImage) {
    return [message.serverMessageId ?? message.content, image.index, image.id ?? image.url ?? ""].join(":");
  }

  $effect(() => {
    const engine = chat.engine;
    if (!engine) return;
    for (const image of message.images ?? []) {
      const key = imageKey(image);
      if (requested.has(key)) continue;
      requested.add(key);
      void engine.image(message.index, image.index).then(src => {
        imageSources = { ...imageSources, [key]: src };
      }).catch(() => {
        imageSources = { ...imageSources, [key]: null };
      });
    }
  });

  async function copyMessage() {
    if (!(await copyText(message.content))) {
      chat.toast("Copie impossible sur cet appareil.", true);
      return;
    }
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1500);
  }

  async function onBubbleClick(event: MouseEvent) {
    const button = (event.target as Element | null)?.closest(".code-copy");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
    if (!(await copyText(code))) return;
    const label = button.textContent;
    button.textContent = "Copié";
    setTimeout(() => {
      button.textContent = label;
    }, 1500);
  }

  function previewAttachment(index: number) {
    chat.engine?.preview({ messageIndex: message.index, attachmentIndex: index });
  }

  function onChipKey(event: KeyboardEvent, index: number) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    previewAttachment(index);
  }

</script>

{#if message.imageSearch && chat.state.id}
  {@const id = chat.state.id}
  <div class="message assistant">
    <div class="bubble">
      <ImageSearchGallery search={message.imageSearch} canSearch={chat.state.composer.webSearchMode === "open"}
        onupdate={search => chat.engine?.storeImageSearch?.(id, message.index, search)}
        onfile={async (image, action) => {
          const engine = chat.engine;
          if (!engine?.saveImageResult) throw new Error("L’enregistrement est indisponible.");
          await engine.saveImageResult(id, message.index, image, action);
        }} />
    </div>
  </div>
{:else if message.role === "user"}
  <div class="message user message-enter">
    {#if message.attachments && message.attachments.length > 0}
      <div class="message-attachments">
        {#each message.attachments as attachment, index (index)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="attachment-chip file-pill"
            role="button"
            tabindex="0"
            title={attachment.name}
            aria-label={"Aperçu de " + attachment.name}
            data-kind={attachmentIcon(attachment.kind)}
            onclick={() => previewAttachment(index)}
            onkeydown={event => onChipKey(event, index)}
          >
            <span class="attachment-icon">{@html fileIconSvg(attachment.name, attachment.kind)}</span>
            <span class="attachment-info"><span class="attachment-name">{attachment.name}</span></span>
          </div>
        {/each}
      </div>
    {/if}
    {#if text !== ""}<div class="bubble">{message.content}</div>{:else if !message.attachments?.length}<div class="bubble"></div>{/if}
    <div class="message-actions user-actions">
      <button type="button" class="msg-action icon-only" title="Modifier ce message et relancer la réponse" aria-label="Modifier ce message et relancer la réponse" onclick={() => chat.engine?.editSent(message.index)}>{@html icon("edit")}</button>
      <button type="button" class="msg-action icon-only" title="Copier le texte" aria-label="Copier le texte" onclick={copyMessage}>{#if copied}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>{:else}{@html icon("copy")}{/if}</button>
    </div>
  </div>
{:else if message.role === "error"}
  <div class="message error message-enter">
    <div class="bubble">{message.content}</div>
    <div class="message-actions error-actions">
      <button type="button" class="msg-action retry-action" onclick={() => chat.engine?.regenerate(message.index)}>{@html icon("refresh")}<span>Réessayer</span></button>
      <button type="button" class="msg-action" onclick={() => chat.engine?.editFailed(message.index)}>{@html icon("edit")}<span>Modifier le message</span></button>
    </div>
  </div>
{:else}
  <div class="message assistant message-enter">
    {#if message.sources && message.sources.length > 0}<ChatSources sources={message.sources} />{/if}
    {#if hasImages}
      <div class="generated-images">
        {#each message.images ?? [] as image (image.index)}
          {@const src = imageSources[imageKey(image)]}
          <figure class="generated-image" class:loading={src === undefined} class:failed={src === null}>
            {#if src}
              {#if openPreview}
                <button type="button" class="image-open" aria-label="Agrandir l’image générée" onclick={() => openPreview?.(generatedImageFile(src))}>
                  <img {src} alt="Illustration générée par l’IA" decoding="async">
                </button>
              {:else}
                <img {src} alt="Illustration générée par l’IA" decoding="async">
              {/if}
              <button type="button" class="generated-image-download" title="Télécharger l'image" aria-label="Télécharger l'image" onclick={() => void chat.engine?.downloadImage(src)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>
              </button>
            {:else if src === null}
              <span class="generated-image-error">Image indisponible</span>
            {/if}
          </figure>
        {/each}
      </div>
    {/if}
    {#if text !== "" || !hasImages}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="bubble" onclick={onBubbleClick}>
        <MessageContent content={message.content} katexReady={chat.katexReady} {openPreview} {appSession} {applyEditorEdit} editLanguage={editorRequest?.language} />
      </div>
    {/if}
    <div class="message-actions">
      <button type="button" class="msg-action icon-only" title="Copier" aria-label="Copier" onclick={copyMessage}>{#if copied}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>{:else}{@html icon("copy")}{/if}</button>
      {#if message.responseVersions && chat.engine?.selectResponseVersion}
        {@const versions = message.responseVersions}
        <div class="version-actions" role="group" aria-label="Variantes de réponse">
          <button type="button" class="msg-action" aria-label="Variante précédente"
            disabled={chat.state.busy || chat.state.pending || versions.index === 0}
            onclick={() => chat.engine?.selectResponseVersion?.(message.index, versions.index - 1)}>‹</button>
          <span aria-live="polite">{versions.index + 1} / {versions.count}</span>
          <button type="button" class="msg-action" aria-label="Variante suivante"
            disabled={chat.state.busy || chat.state.pending || versions.index + 1 >= versions.count}
            onclick={() => chat.engine?.selectResponseVersion?.(message.index, versions.index + 1)}>›</button>
        </div>
      {/if}
      {#if chat.engine?.branch}
        <button type="button" class="msg-action" onclick={() => chat.engine?.branch?.(message.index)}>Créer une branche</button>
      {/if}
      <button type="button" class="msg-action icon-only" title="Régénérer" aria-label="Régénérer" onclick={() => chat.engine?.regenerate(message.index)}>{@html icon("refresh")}</button>
    </div>
  </div>
{/if}

<style>
  .version-actions { display: inline-flex; align-items: center; gap: .25rem; }
  .version-actions button { min-width: 36px; min-height: 44px; }
  .image-open { display: block; background: transparent; padding: 0; border: 0; max-width: 100%; cursor: zoom-in; }
</style>
