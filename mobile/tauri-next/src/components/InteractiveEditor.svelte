
<script lang="ts">
  import { safeFileName } from "../lib/services/file-preview.ts";
  import { renderMarkdownText } from "../lib/services/markdown.ts";
  import { saveBytes } from "../lib/services/file-saver.ts";
  let { title, text }: { title: string; text: string } = $props();
  let value = $state("");
  let message = $state("");
  let saving = $state(false);
  let editing = $state(false);
  const uid = $props.id();
  $effect(() => { value = text; message = ""; editing = false; });

  async function save() {
    saving = true;
    try {
      await saveBytes(safeFileName(title.slice(0, 130) + ".md"), new TextEncoder().encode(value));
      message = "Document enregistré.";
    } catch {
      message = "Enregistrement interrompu.";
    } finally { saving = false; }
  }
</script>

<section class="interactive-editor" aria-label={title}>
  <strong>{title}</strong>
  {#if editing}
    <textarea id={uid} aria-label={"Modifier " + title} class="settings-input" rows="8" maxlength="16000" bind:value></textarea>
  {:else}
    <article id={uid} class="editor-preview">{@html renderMarkdownText(value)}</article>
  {/if}
  <div class="editor-actions">
    <button type="button" class="settings-btn" aria-controls={uid} onclick={() => editing = !editing}>{editing ? "Voir l’aperçu" : "Modifier"}</button>
    <button type="button" class="settings-btn" disabled={saving} onclick={() => void save()}>Enregistrer une copie</button>
  </div>
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  .editor-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .editor-preview { margin-block: .6rem; overflow-wrap: anywhere; }
  textarea { display: block; font-size: 16px; width: 100%; margin-block: .55rem; resize: vertical; }
</style>
