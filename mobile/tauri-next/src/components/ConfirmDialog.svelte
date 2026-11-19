<!-- Confirmation maison : window.confirm n'est pas fiable dans une WebView iOS. -->
<script lang="ts">
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";

  interface Props {
    chat: ChatStore;
  }

  let { chat }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  const request = $derived(chat.confirmRequest);

  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (request && !el.open) el.showModal();
    else if (!request && el.open) el.close();
  });

  function onCancel(event: Event) {
    event.preventDefault();
    chat.answerConfirm(false);
  }
</script>

<dialog class="fs-confirm" aria-label="Confirmation" bind:this={dialog} oncancel={onCancel}>
  <p class="fs-confirm-text">{request?.message ?? ""}</p>
  <div class="fs-confirm-actions">
    <button type="button" class="settings-btn" onclick={() => chat.answerConfirm(false)}>Annuler</button>
    <button type="button" class="settings-btn primary fs-confirm-ok" onclick={() => chat.answerConfirm(true)}>Confirmer</button>
  </div>
</dialog>
