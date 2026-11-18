<script lang="ts">
  import type { Conversation } from "../lib/types/conversation.ts";
  import { NO_RESULT, conversationTitle } from "../lib/utils/history.ts";
  import type { HistoryGroup } from "../lib/utils/history.ts";
  import { MORE_ICON, icon } from "../lib/utils/icons.ts";

  interface Props {
    groups: HistoryGroup[];
    /** Une recherche est active : une liste vide affiche alors « Aucune conversation trouvée. ». */
    searching: boolean;
    currentId: string | null;
    menuId: string | null;
    /** Pastille HTML du modèle et son libellé (info-bulle de la ligne). */
    markFor: (conversation: Conversation) => { html: string; label: string };
    onopen: (id: string) => void;
    onmenu: (id: string, button: HTMLButtonElement) => void;
  }

  let { groups, searching, currentId, menuId, markFor, onopen, onmenu }: Props = $props();

  const pinIcon = icon("pin", 14);

  function onKeydown(event: KeyboardEvent, id: string) {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onopen(id);
    }
  }

  function onMore(event: MouseEvent, id: string) {
    event.stopPropagation();
    onmenu(id, event.currentTarget as HTMLButtonElement);
  }
</script>

<nav id="history" class="history" aria-label="Historique">
  {#if groups.length === 0}
    {#if searching}
      <div class="history-empty">{NO_RESULT}</div>
    {/if}
  {:else}
    {#each groups as group (group.label)}
      <div class="history-label">{group.label}</div>
      {#each group.items as conversation (conversation.id)}
        {@const mark = markFor(conversation)}
        {@const title = conversationTitle(conversation)}
        <div
          class="history-item"
          class:active={conversation.id === currentId}
          class:menu-open={conversation.id === menuId}
          role="button"
          tabindex="0"
          title={mark.label}
          onclick={() => onopen(conversation.id)}
          onkeydown={event => onKeydown(event, conversation.id)}
        >
          <span class="model-logo history-model" aria-hidden="true">{@html mark.html}</span>
          <span class="history-title" title={title}>{#if conversation.pinned}<span class="history-pin">{@html pinIcon}</span>{/if}{title}</span>
          <button type="button" class="history-more" title="Actions" aria-label="Actions sur la conversation" aria-haspopup="menu" onclick={event => onMore(event, conversation.id)}>{@html MORE_ICON}</button>
        </div>
      {/each}
    {/each}
  {/if}
</nav>
