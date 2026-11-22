<script lang="ts">
  import { highlightCode, renderMarkdownText } from "../lib/services/markdown.ts";
  let { replacement, apply, language }: { replacement: string; apply?: (replacement: string) => string; language?: string } = $props();
  let outcome = $state("");
  let applied = $state(false);

  function accept() {
    if (!apply || applied) return;
    const error = apply(replacement);
    outcome = error || "Proposition appliquée.";
    applied = !error;
  }
</script>

<section aria-label="Révision proposée">
  <strong>Révision proposée</strong>
  {#if replacement && language}
    <pre><code>{@html highlightCode(replacement, language)}</code></pre>
  {:else if replacement}
    <article>{@html renderMarkdownText(replacement)}</article>
  {:else}
    <p>Supprimer le passage demandé.</p>
  {/if}
  {#if apply}
    <button type="button" class="settings-btn" disabled={applied} onclick={accept}>Appliquer au document</button>
    {#if outcome}<p role="status">{outcome}</p>{/if}
  {/if}
</section>

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  pre { overflow: auto; }
  article { margin-block: .55rem; overflow-wrap: anywhere; }
  button { min-height: 44px; }
</style>
