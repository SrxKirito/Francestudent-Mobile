<!-- Un message du chat : mêmes classes que l'ancienne interface (assistant.js), donc mêmes feuilles de style. -->
<script lang="ts">
  import ImageSearchGallery from "./ImageSearchGallery.svelte";
  import ChatSources from "./ChatSources.svelte";
  import MessageContent from "./MessageContent.svelte";
  import type { PreviewFile } from "../lib/services/file-preview.ts";
  import { generatedImageFile } from "../lib/services/file-preview.ts";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";
  import { attachmentIcon } from "../lib/services/chat-view.ts";
  import { fileIconSvg } from "../lib/services/markdown.ts";
  import type { ChatImage, ChatMessage } from "../lib/types/chat.ts";
  import { speechText } from "../lib/services/read-aloud.ts";
  import { copyText } from "../lib/utils/clipboard.ts";
  import { icon } from "../lib/utils/icons.ts";

  interface Props {
    message: ChatMessage;
    chat: ChatStore;
    openPreview?: (file: PreviewFile) => void;
    saveMessage?: (chatId: string, messageId: string) => Promise<void>;
    onread?: () => void;
    speaking?: number | null;
  }

  let { message, chat, openPreview, saveMessage, onread, speaking }: Props = $props();

  let copied = $state(false);
  let saving = $state(false);

  async function save() {
    if (saving || !saveMessage || !chat.state.chatId || !message.serverMessageId) return;
    saving = true;
    try { await saveMessage(chat.state.chatId, message.serverMessageId); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) chat.toast("Enregistrement du message impossible.", true);
    } finally { saving = false; }
  }

  /** Une image remplacée lors d'une régénération ne réutilise pas la source de l'ancienne. */
  let imageSources = $state.raw<Record<string, string | null>>({});
  const requested = new Set<string>();
  const hasImages = $derived((message.images?.length ?? 0) > 0);
  const text = $derived(message.content.trim());
  const readLabel = $derived(speaking === message.index ? "Arrêter la lecture" : "Lire à voix haute");

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

{#snippet saveButton()}
  {#if saveMessage && chat.state.chatId && message.serverMessageId}
    <button type="button" class="msg-action" disabled={saving} onclick={save}>Enregistrer</button>
  {/if}
{/snippet}

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
      {@render saveButton()}
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
        <MessageContent content={message.content} katexReady={chat.katexReady} {openPreview} />
      </div>
    {/if}
    <div class="message-actions">
      {@render saveButton()}
      {#if onread && speechText(message.content)}
        <button type="button" class="msg-action icon-only" class:active={speaking === message.index} title={readLabel} aria-label={readLabel}
          aria-pressed={speaking === message.index} onclick={onread}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if speaking === message.index}<rect x="6" y="6" width="12" height="12" rx="2"/>
            {:else}<path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>{/if}
          </svg>
        </button>
      {/if}
      <button type="button" class="msg-action icon-only" title="Copier" aria-label="Copier" onclick={copyMessage}>{#if copied}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>{:else}{@html icon("copy")}{/if}</button>
      <button type="button" class="msg-action icon-only" title="Régénérer" aria-label="Régénérer" onclick={() => chat.engine?.regenerate(message.index)}>{@html icon("refresh")}</button>
    </div>
  </div>
{/if}

<style>
  .image-open { display: block; background: transparent; padding: 0; border: 0; max-width: 100%; cursor: zoom-in; }
</style>
