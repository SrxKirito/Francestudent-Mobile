<!-- Import d'une conversation ChatGPT partagée publiquement. Même balisage et mêmes classes que conversation-import.js
     (feuille conversation-import.css) ; la validation, le POST et l'enregistrement sont dans le service et le moteur. -->
<script lang="ts">
  import "../../conversation-import.css";
  import { tick } from "svelte";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";

  interface Props {
    chat: ChatStore;
  }

  let { chat }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let linkInput: HTMLInputElement | undefined = $state();
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
      el.showModal();
      void tick().then(() => linkInput?.focus());
    } else if (!info && el.open) {
      el.close();
    }
  });

  function submit(event: Event) {
    event.preventDefault();
    if (chat.importing) return;
    chat.submitImport(link, agentId ?? -1);
  }

  function onCancel(event: Event) {
    event.preventDefault();
    if (!chat.importing) chat.closeImport();
  }
</script>

<dialog class="project-editor conversation-import-dialog" aria-label="Importer une conversation" bind:this={dialog} oncancel={onCancel}>
  <form class="conversation-import-body" novalidate onsubmit={submit}>
    <h2>Importer une conversation</h2>
    <p class="settings-hint">Colle le lien d’une conversation ChatGPT partagée publiquement. Elle sera importée dans ton compte avec le modèle choisi.</p>
    <label>Lien de partage
      <input class="settings-input" type="text" placeholder="https://chatgpt.com/share/…" autocomplete="off" spellcheck="false" inputmode="url" maxlength="2048" bind:value={link} bind:this={linkInput} disabled={chat.importing}>
    </label>
    <label>Modèle
      <select class="settings-input" bind:value={agentId} disabled={chat.importing || (info?.models.length ?? 0) === 0}>
        {#each info?.models ?? [] as model (model.id)}
          <option value={model.id}>{model.label}</option>
        {/each}
      </select>
    </label>
    <p class="settings-hint conversation-import-status" class:is-error={status.error} role="status">{status.text}</p>
    <div class="conversation-import-actions">
      <button type="button" class="settings-btn" disabled={chat.importing} onclick={() => chat.closeImport()}>Fermer</button>
      <button type="submit" class="settings-btn primary" disabled={chat.importing || (info?.models.length ?? 0) === 0}>Importer</button>
    </div>
  </form>
</dialog>
