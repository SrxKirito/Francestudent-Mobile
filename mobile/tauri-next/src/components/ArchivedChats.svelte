<script lang="ts">
  import "../../archived-chats.css";
  import type { ArchiveState } from "../lib/services/legacy-engine.ts";

  interface Props {
    archive: ArchiveState;
    ontoggle?: () => void;
    standalone?: boolean;
    onrestore: (chatId: string) => void;
    ondownload: (chatId: string) => void;
    onmore: () => void;
  }

  let { archive, ontoggle, standalone = false, onrestore, ondownload, onmore }: Props = $props();
</script>

<!-- Même balisage et mêmes classes que archived-chats.js (feuille archived-chats.css, identique à celle de l'ancienne interface). -->
{#if !standalone}<button type="button" class="side-nav-item archived-chat-toggle" aria-expanded={archive.open ? "true" : "false"} onclick={ontoggle}>Conversations archivées</button>{/if}
<section class="archived-chats-panel" class:standalone aria-label="Conversations archivées" hidden={!standalone && !archive.open}>
  {#if archive.status}<p role="status">{archive.status}</p>{/if}
  <div>
    {#each archive.rows as row (row.id)}
      <div class="archived-chat-row" data-chat-id={row.id}>
        <span>{row.title}</span>
        <button type="button" aria-label={"Restaurer " + row.title} disabled={row.busy} onclick={() => onrestore(row.id)}>Restaurer</button>
        <button type="button" aria-label={"Télécharger " + row.title} disabled={row.busy} onclick={() => ondownload(row.id)}>Télécharger</button>
      </div>
    {/each}
  </div>
  <button type="button" hidden={archive.moreHidden} disabled={archive.moreDisabled} onclick={onmore}>{archive.moreLabel}</button>
</section>

<style>
  .standalone { max-height: none; overflow: visible; margin: 0; }
  .standalone button { min-height: 44px; }
</style>
