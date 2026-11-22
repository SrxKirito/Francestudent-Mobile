<script lang="ts">
  import { untrack } from "svelte";
  import { memoryEntryLimit, type ChatMemory, type MemorySnapshot } from "../lib/services/chat-memory.ts";

  let { memory }: { memory: ChatMemory } = $props();
  const title = $props.id();
  let snapshot = $state.raw(untrack(() => memory.read()));
  let draft = $state("");
  let editing = $state<string>();
  let issue = $state("");
  let input = $state<HTMLTextAreaElement>();

  function change(operation: () => MemorySnapshot) {
    issue = "";
    try {
      snapshot = operation();
      return true;
    } catch (error) {
      issue = error instanceof Error ? error.message : "Impossible de modifier la mémoire.";
      return false;
    }
  }

  function edit(id: string, text: string) {
    editing = id;
    draft = text;
    input?.focus();
  }

  function cancel() {
    editing = undefined;
    draft = "";
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (change(() => memory.save(draft, editing))) cancel();
  }
</script>

<section class="general-section memory-panel" aria-labelledby={title}>
  <h3 id={title} class="settings-section-title">Mémoire</h3>
  <p class="settings-hint">Les souvenirs sont enregistrés sur cet appareil pour ton compte. Quand la mémoire est active, ils sont transmis au modèle avec tes messages.</p>
  <label class="memory-toggle">
    <input type="checkbox" checked={snapshot.enabled} onchange={event => {
      const checkbox = event.currentTarget;
      if (!change(() => memory.setEnabled(checkbox.checked))) checkbox.checked = snapshot.enabled;
    }}>
    Utiliser la mémoire dans les discussions
  </label>
  {#if snapshot.entries.length}
    <ul>
      {#each snapshot.entries as entry (entry.id)}
        <li>
          <p>{entry.text}</p>
          <div class="memory-actions">
            <button type="button" class="settings-btn" onclick={() => edit(entry.id, entry.text)}>Modifier</button>
            <button type="button" class="settings-btn" onclick={() => {
              if (change(() => memory.remove(entry.id)) && editing === entry.id) cancel();
            }}>Oublier</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  <form onsubmit={submit}>
    <label class="settings-label">{editing ? "Modifier le souvenir" : "Nouveau souvenir"}
      <textarea class="settings-input" bind:this={input} bind:value={draft} maxlength={memoryEntryLimit} rows="3"
        placeholder="Par exemple, j’apprends le français au niveau B1."></textarea>
    </label>
    <div class="memory-actions">
      <button type="submit" class="settings-btn primary" disabled={!draft.trim()}>{editing ? "Enregistrer la modification" : "Ajouter à la mémoire"}</button>
      {#if editing}<button type="button" class="settings-btn" onclick={cancel}>Annuler</button>{/if}
    </div>
  </form>
  {#if issue}<p class="settings-hint" role="alert">{issue}</p>{/if}
</section>

<style>
  .memory-toggle { display: flex; align-items: center; gap: .6rem; min-height: 44px; }
  ul { margin: .6rem 0; padding: 0; list-style: none; }
  li { margin-block: .5rem; padding: .65rem; border: 1px solid var(--border); border-radius: .65rem; }
  li p { margin: 0 0 .3rem; overflow-wrap: anywhere; white-space: pre-wrap; }
  textarea { margin-block: .35rem .5rem; width: 100%; font-size: 16px; }
  .memory-actions { display: flex; flex-wrap: wrap; gap: .45rem; }
  button { min-height: 44px; }
</style>
