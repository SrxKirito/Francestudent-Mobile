<!-- Bloc « N sites consultés » : mêmes classes que l'ancienne interface (assistant.js, sourcesHtml), donc mêmes feuilles de style. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { faviconUrl, layoutSources, sourceLabel, sourceLetter, sourcesSummary } from "../lib/services/chat-view.ts";
  import type { ChatSource } from "../lib/types/chat.ts";

  interface Props {
    sources: ChatSource[];
    searching?: boolean;
    /** Ouvert pendant la réponse, replié une fois la réponse enregistrée (comme l'ancienne interface). */
    initiallyOpen?: boolean;
  }

  let { sources, searching = false, initiallyOpen = false }: Props = $props();
  let open = $state(untrack(() => initiallyOpen));
  let all = $state(false);

  const layout = $derived(layoutSources(sources));
  const label = $derived(sourcesSummary(layout.all.length, searching));

  function hideBrokenIcon(event: Event): void {
    (event.currentTarget as HTMLElement).remove();
  }
</script>

{#snippet icon(host: string)}
  <span class="source-icon"><span>{sourceLetter(host)}</span><img src={faviconUrl(host)} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={hideBrokenIcon} /></span>
{/snippet}

<div class="sources-container">
  <div class="sources-block" class:open class:all class:searching role="status" aria-live="polite">
    <button type="button" class="sources-pill" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="web-search-globe" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
        {#if searching}<span class="web-search-spinner"></span>{/if}
      </span>
      <span class="sources-label" class:web-search-label={searching}>{label}</span>
      <span class="source-icons">{#each layout.pillIcons as source}{@render icon(source.host)}{/each}</span>
      <span class="sources-chevron" aria-hidden="true"></span>
    </button>
    <div class="sources-grid">
      {#each layout.all as source, i}
        <a class="source-card" class:extra={layout.collapsed && i >= 3} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title || undefined}>
          <span class="source-url">{source.url}</span>
          <span class="source-meta">
            {@render icon(source.host)}
            <span class="source-name">{sourceLabel(source.host)}</span>
            <span class="source-num">{i + 1}</span>
          </span>
        </a>
      {/each}
      {#if layout.collapsed}
        <button type="button" class="source-card sources-more" onclick={() => (all = true)}>
          <span class="source-icons">{#each layout.moreIcons as source}{@render icon(source.host)}{/each}</span>
          <span class="source-url">{layout.moreLabel}</span>
        </button>
      {/if}
    </div>
  </div>
</div>
