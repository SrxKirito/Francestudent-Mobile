
<script lang="ts">
  import { safeFileName } from "../lib/services/file-preview.ts";
  import { saveBytes } from "../lib/services/file-saver.ts";
  let { title, text }: { title: string; text: string } = $props();
  let value = $state("");
  let message = $state("");
  let saving = $state(false);
  const uid = $props.id();
  $effect(() => { value = text; message = ""; });

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
  <label for={uid}><strong>{title}</strong></label>
  <textarea id={uid} class="settings-input" rows="8" maxlength="16000" bind:value></textarea>
  <button type="button" class="settings-btn" disabled={saving} onclick={() => void save()}>Enregistrer une copie</button>
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  textarea { display: block; font-size: 16px; width: 100%; margin-block: .55rem; resize: vertical; }
</style>
