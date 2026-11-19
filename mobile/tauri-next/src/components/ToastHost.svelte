<!-- Notifications du chat. Même classes que l'ancienne interface (.app-toast) ; posées dans la couche supérieure du navigateur
     (popover) pour rester visibles au-dessus d'une boîte de dialogue modale. -->
<script lang="ts">
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";

  interface Props {
    chat: ChatStore;
  }

  let { chat }: Props = $props();

  let host: HTMLElement | undefined = $state();
  const latest = $derived(chat.toasts.length > 0 ? chat.toasts[chat.toasts.length - 1] : null);

  $effect(() => {
    const el = host;
    if (!el || typeof el.showPopover !== "function") return;
    // Réaffiché à chaque nouvelle notification pour repasser au-dessus d'un dialogue ouvert entre-temps.
    void latest?.id;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (latest) el.showPopover();
    } catch {
      // Navigateur sans popover : la notification reste affichée dans le flux normal.
    }
  });
</script>

<div class="fs-toast-host" popover="manual" bind:this={host}>
  {#if latest}
    <div id="app-toast" class="app-toast show" class:error={latest.error} role="status">{latest.text}</div>
  {/if}
</div>
