<!-- Accès à une conversation. Même balisage et mêmes libellés que chat-shares.js ; le serveur décide de la liste et des droits. -->
<script lang="ts">
  import type { SharePermission } from "../lib/services/chat-shares.ts";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";

  interface Props {
    chat: ChatStore;
  }

  let { chat }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let email = $state("");
  let permission = $state<SharePermission>("View");

  const view = $derived(chat.sharesView);

  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (chat.sharesOpen && !el.open) {
      email = "";
      permission = "View";
      el.showModal();
    } else if (!chat.sharesOpen && el.open) {
      el.close();
    }
  });

  function submit(event: Event) {
    event.preventDefault();
    const address = email.trim();
    if (!address || (view?.busy ?? false)) return;
    chat.grantShare(address, permission);
  }

  function onCancel(event: Event) {
    event.preventDefault();
    chat.closeShares();
  }
</script>

<dialog class="project-editor" aria-label="Accès à la conversation" bind:this={dialog} oncancel={onCancel}>
  <div class="fs-shares-body">
    <h2>Accès à la conversation</h2>
    <p class="settings-hint">Les droits sont vérifiés par France Student.</p>
    <div class="fs-shares-list">
      {#each view?.rows ?? [] as row (row.key)}
        <div class="fs-shares-row">
          <span>{row.label}</span>
          {#if row.canChange}
            <button type="button" class="settings-btn small" disabled={view?.busy} onclick={() => chat.changeShare(row.key)}>{row.changeLabel}</button>
          {/if}
          {#if row.canRemove}
            <button type="button" class="settings-btn small" disabled={view?.busy} onclick={() => chat.removeShare(row.key)}>Retirer</button>
          {/if}
        </div>
      {/each}
    </div>
    <p class="settings-hint" role="status">{view?.status ?? ""}</p>
    {#if view?.canInvite}
      <form onsubmit={submit}>
        <label>Adresse e-mail
          <input class="settings-input" name="email" type="email" required bind:value={email}>
        </label>
        <label>Autorisation
          <select name="permission" bind:value={permission}>
            <option value="View">Lecture</option>
            <option value="Write">Écriture</option>
          </select>
        </label>
        <button class="settings-btn" type="submit" disabled={view?.busy}>Partager</button>
      </form>
    {/if}
    <button type="button" class="settings-btn" onclick={() => chat.closeShares()}>Fermer</button>
  </div>
</dialog>
