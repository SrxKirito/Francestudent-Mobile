<script lang="ts">
  import FileFormatPreview from "./FileFormatPreview.svelte";
  import { htmlPreview } from "../lib/services/preview-formats.ts";
  import { renderCodeBlockInner } from "../lib/services/markdown.ts";
  let { name, source, onexpand }: { name: string; source: string; onexpand?: () => void } = $props();
  let page = $state("");
  let failed = $state(false);

  $effect(() => {
    try { page = htmlPreview(source); failed = false; }
    catch { page = ""; failed = true; }
  });
</script>

<section class="inline-html-preview" aria-label={"Aperçu de " + name}>
  <header>
    <div class="file-title"><FileFormatPreview {name} /><strong>{name}</strong></div>
    {#if onexpand}<button type="button" class="settings-btn" onclick={onexpand}>Ouvrir en grand</button>{/if}
  </header>
  {#if page}
    <iframe title={"Aperçu HTML de " + name} sandbox="" referrerpolicy="no-referrer" loading="lazy" srcdoc={page}></iframe>
  {:else if failed}
    <p role="status">Aperçu indisponible. Le code reste accessible ci-dessous.</p>
  {/if}
  <details>
    <summary>Afficher le code</summary>
    {@html renderCodeBlockInner(source, "html")}
  </details>
</section>

<style>
  section { margin-block: .8rem; border: 1px solid var(--border); border-radius: .75rem; overflow: hidden; min-width: 0; }
  header { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: .5rem; padding: .65rem; }
  .file-title { display: flex; align-items: center; gap: .55rem; min-width: 0; }
  strong { overflow-wrap: anywhere; }
  button, summary { min-height: 44px; }
  iframe { display: block; box-sizing: border-box; width: 100%; height: clamp(230px, 42dvh, 360px); border: 0; }
  details { padding-inline: .65rem; }
  summary { box-sizing: border-box; padding-block: .65rem; cursor: pointer; }
  p { padding-inline: .65rem; }
</style>
