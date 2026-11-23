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

<dialog class="rename-dialog" aria-labelledby="rename-title" bind:this={dialog} oncancel={event => { event.preventDefault(); answer(null); }}>
  <form class="settings-form" onsubmit={event => { event.preventDefault(); if (title.trim()) answer(title); }}>
    <h2 id="rename-title">Renommer la discussion</h2>
    <label class="settings-label">Titre <input class="settings-input" maxlength="100" required bind:value={title} bind:this={input}></label>
    <div class="settings-item-actions">
      <button type="button" class="settings-btn" onclick={() => answer(null)}>Annuler</button>
      <button class="settings-btn primary" disabled={!title.trim()}>Enregistrer</button>
    </div>
  </form>
</dialog>

<style>
  .rename-dialog { position: fixed; inset: auto 0; margin: 0 auto;
    top: calc(var(--ios-viewport-top, 0px) + var(--ios-viewport-height, 100dvh) / 2);
    translate: 0 -50%; max-height: calc(var(--ios-viewport-height, 100dvh) - 24px); overflow: auto;
    box-sizing: border-box; width: min(420px, calc(100% - 24px)); padding: 1rem;
    color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 1rem; }
  .rename-dialog::backdrop { background: #0008; }
  h2 { margin: 0; font-size: 1.1rem; }
  input { font-size: 16px; }
</style>
