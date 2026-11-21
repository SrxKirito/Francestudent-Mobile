<script lang="ts">
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";

  let { chat }: { chat: ChatStore } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let title: HTMLHeadingElement | undefined = $state();
  let opener: HTMLElement | null = null;
  let link = $state("");
  let agentId = $state<number | null>(null);

  const info = $derived(chat.importDialog);
  const status = $derived(chat.importStatus);

  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (info && !el.open) {
      link = "";
      agentId = info.selectedId;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      title?.focus({ preventScroll: true });
    } else if (!info && el.open) {
      el.close();
      const target = opener?.getClientRects().length && !opener.closest("[inert]") ? opener : document.querySelector<HTMLElement>("#menu-toggle");
      target?.focus({ preventScroll: true });
      opener = null;
    }
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!chat.importing) chat.submitImport(link, agentId ?? -1);
  }

  function onCancel(event: Event) {
    event.preventDefault();
    if (!chat.importing) chat.closeImport();
  }
</script>

<dialog class="import-dialog" aria-labelledby="import-title" bind:this={dialog} oncancel={onCancel}>
  <form novalidate onsubmit={submit} aria-busy={chat.importing}>
    <!-- svelte-ignore a11y_autofocus (focaliser le titre plutôt qu'ouvrir automatiquement le clavier) -->
    <h2 id="import-title" tabindex="-1" autofocus bind:this={title}>Importer une conversation</h2>
    <p class="hint">Colle le lien public d’une conversation ChatGPT et choisis le modèle à utiliser.</p>
    <label for="import-link">Lien de partage</label>
    <input id="import-link" type="url" placeholder="https://chatgpt.com/share/…" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" maxlength="2048" bind:value={link} disabled={chat.importing} aria-describedby="import-status">
    <label for="import-model">Modèle</label>
    <select id="import-model" bind:value={agentId} disabled={chat.importing || !info?.models.length}>
      {#each info?.models ?? [] as model (model.id)}
        <option value={model.id}>{model.label}</option>
      {:else}
        <option value={null}>Aucun modèle disponible</option>
      {/each}
    </select>
    <p id="import-status" class="hint" class:error={status.error} role="status">{status.text}</p>
    <div class="actions">
      <button type="button" class="settings-btn" disabled={chat.importing} onclick={() => chat.closeImport()}>Annuler</button>
      <button type="submit" class="settings-btn primary" disabled={chat.importing || !info?.models.length}>{chat.importing ? "Import en cours…" : "Importer"}</button>
    </div>
  </form>
</dialog>

<style>
  .import-dialog {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    margin: auto;
    width: min(30rem, calc(100% - max(16px, env(safe-area-inset-left, 0px)) - max(16px, env(safe-area-inset-right, 0px))));
    max-width: none;
    max-height: calc(var(--ios-viewport-height, 100dvh) - max(12px, var(--fs-safe-top, 0px)) - max(12px, var(--fs-safe-bottom, 0px)));
    overflow: auto;
    overscroll-behavior: contain;
    padding: clamp(14px, 4vw, 24px);
    border: 1px solid var(--border, #3a3a3f);
    border-radius: 20px;
    background: var(--surface, #212124);
    color: var(--text, #fafafa);
    box-shadow: 0 16px 48px #0007;
  }
  :global(.ios-viewport) .import-dialog {
    top: calc(var(--ios-viewport-top, 0px) + max(12px, var(--fs-safe-top)));
    bottom: auto;
    margin-block: 0;
  }
  .import-dialog::backdrop { background: #0009; }
  form { display: grid; gap: 10px; min-width: 0; }
  h2 { margin: 0; font-size: 1.25rem; line-height: 1.3; }
  h2:focus { outline: none; }
  .hint { margin: 0; color: var(--muted, #a6a6ae); overflow-wrap: anywhere; }
  #import-status:empty { display: none; }
  .error { color: var(--danger, #ff8b8b); }
  input, select {
    box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px;
    font: inherit; font-size: 16px; color: inherit; background: var(--bg, #161617);
    border: 1px solid var(--border, #3a3a3f); border-radius: 12px;
  }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--accent, #88aaff); outline-offset: 2px; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .actions button { min-height: 44px; }
</style>
