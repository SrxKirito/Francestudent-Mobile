<script lang="ts">
  import { onMount } from "svelte";

  let { initial, onanswer }: { initial: string; onanswer: (title: string | null) => void } = $props();
  let title = $state("");
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;

  onMount(() => {
    title = initial;
    dialog.showModal();
    input.focus();
    input.select();
  });

  function answer(value: string | null) {
    dialog.close();
    onanswer(value);
  }
</script>

<dialog class="project-editor" aria-labelledby="rename-title" bind:this={dialog} oncancel={event => { event.preventDefault(); answer(null); }}>
  <form class="settings-form" onsubmit={event => { event.preventDefault(); if (title.trim()) answer(title); }}>
    <h2 id="rename-title">Renommer la discussion</h2>
    <label class="settings-label">Titre <input class="settings-input" maxlength="100" required bind:value={title} bind:this={input}></label>
    <div class="settings-item-actions">
      <button type="button" class="settings-btn" onclick={() => answer(null)}>Annuler</button>
      <button class="settings-btn primary" disabled={!title.trim()}>Enregistrer</button>
    </div>
  </form>
</dialog>
