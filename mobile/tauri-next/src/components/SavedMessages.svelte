<script lang="ts">
  import { onDestroy } from "svelte";
  import { savedMessages } from "../lib/services/saved-messages.ts";
  import type { SavedMessage } from "../lib/services/saved-messages.ts";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import { parseMarkdownBlocks, renderMarkdownText } from "../lib/services/markdown.ts";
  import { errorMessage } from "../lib/utils/errors.ts";

  let { api, katexReady, onopen }: { api: ApiClient; katexReady: boolean; onopen: (id: string) => Promise<boolean> } = $props();
  const lifetime = new AbortController();
  let rows = $state.raw<SavedMessage[]>([]);
  let next = $state<string | null>(null);
  let loaded = $state(false);
  let busy = $state(false);
  let status = $state("");
  let failedPage = $state(false);
  let open = $state(false);
  onDestroy(() => lifetime.abort());

  const previews = $derived.by(() => {
    void katexReady;
    return open ? rows.map(row => parseMarkdownBlocks(row.content || "Message sans texte").map(block =>
      block.type === "text" ? { html: renderMarkdownText(block.content) } : { code: block.content }
    )) : [];
  });

  const key = (row: SavedMessage) => row.chatId + "/" + row.messageId;

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    status = "";
    try { await work(); }
    catch (error) { if (!lifetime.signal.aborted) status = errorMessage(error); }
    finally { busy = false; }
  }

  function load() {
    void run(async () => {
      failedPage = false;
      try {
        const result = await savedMessages(api).page(next, lifetime.signal);
        if (lifetime.signal.aborted) return;
        rows = [...new Map([...rows, ...result.rows].map(row => [key(row), row])).values()];
        next = result.next;
        loaded = true;
      } catch (error) {
        failedPage = true;
        throw error;
      }
    });
  }

  function remove(row: SavedMessage) {
    void run(async () => {
      await savedMessages(api).set(row.chatId, row.messageId, false, lifetime.signal);
      if (!lifetime.signal.aborted) rows = rows.filter(item => key(item) !== key(row));
    });
  }
</script>

<button type="button" class="settings-btn" aria-expanded={open} onclick={() => {
  open = !open;
  if (open && !loaded) load();
}}>Messages enregistrés</button>
{#if open}
  <section aria-label="Messages enregistrés" aria-busy={busy}>
    {#if status}<p role="alert">{status}</p>{/if}
    {#if busy}<p role="status">Chargement…</p>
    {:else if loaded && !rows.length}<p>Aucun message enregistré.</p>{/if}
    {#each rows as row, index (key(row))}
      <article>
        <div class="saved-message-content">
          {#each previews[index] ?? [] as block}
            {#if block.html !== undefined}
              {@html block.html}
            {:else}
              <pre><code>{block.code}</code></pre>
            {/if}
          {/each}
        </div>
        <button type="button" class="settings-btn" disabled={busy} onclick={() => void run(() => onopen(row.chatId))}>Ouvrir la conversation</button>
        <button type="button" class="settings-btn" disabled={busy} onclick={() => remove(row)}>Retirer</button>
      </article>
    {/each}
    {#if next || failedPage}
      <button type="button" class="settings-btn" disabled={busy} onclick={load}>{failedPage ? "Réessayer" : "Charger la suite"}</button>
    {/if}
  </section>
{/if}

<style>
  section { margin-block: .5rem; max-height: min(40dvh, 24rem); overflow: auto; }
  article { border-top: 1px solid var(--border); padding-block: .6rem; }
  .saved-message-content { min-width: 0; overflow-wrap: anywhere; margin-bottom: .5rem; }
  .saved-message-content :global(p:first-child) { margin-top: 0; }
  .saved-message-content :global(.katex-display), pre { max-width: 100%; overflow-x: auto; }
</style>
