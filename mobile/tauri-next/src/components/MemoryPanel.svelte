<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import { errorMessage } from "../lib/utils/errors.ts";

  let { api, onconfirm }: { api: ApiClient; onconfirm: (text: string) => Promise<boolean> } = $props();
  type Memory = { id: string; name?: string; path?: string };
  const endpoint = "/user/@me/memories";
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const route = (id: string) => endpoint + "/" + encodeURIComponent(id);
  const title = (item: Memory) => item.path || item.name || item.id;
  let rows = $state.raw<Memory[]>([]);
  let selected = $state.raw<{ id: string; text: string } | null>(null);
  let status = $state("");
  let fetched = $state(false);
  let busy = $state(false);
  onDestroy(() => lifetime.abort());

  async function run(action: () => Promise<void>) {
    if (busy || signal.aborted) return;
    busy = true;
    status = "";
    try { await action(); }
    catch (error) { if (!signal.aborted) status = errorMessage(error); }
    finally { busy = false; }
  }

  function load() {
    void run(async () => {
      const response = await api.json<{ memories?: Memory[] }>(endpoint, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(response?.memories)) throw new Error("Liste des mémoires illisible.");
      rows = response.memories.filter(item => typeof item?.id === "string" && item.id);
      if (selected && !rows.some(row => row.id === selected?.id)) selected = null;
      fetched = true;
    });
  }

  function read(item: Memory) {
    if (selected?.id === item.id) { selected = null; return; }
    void run(async () => {
      const response = await api.json<{ content?: unknown }>(route(item.id), { signal });
      if (signal.aborted) return;
      if (typeof response?.content !== "string") throw new Error("Contenu de la mémoire illisible.");
      selected = { id: item.id, text: response.content };
    });
  }

  function remove(item?: Memory) {
    void run(async () => {
      const prompt = item ? "Supprimer la mémoire « " + title(item) + " » ?" : "Supprimer définitivement toutes les mémoires ?";
      if (!await onconfirm(prompt) || signal.aborted) return;
      await api.json(item ? route(item.id) : endpoint, { method: "DELETE", signal });
      if (signal.aborted) return;
      rows = item ? rows.filter(row => row.id !== item.id) : [];
      if (!item || selected?.id === item.id) selected = null;
    });
  }
</script>

<details class="settings-item" ontoggle={event => {
  if (event.currentTarget.open && !fetched) load();
  if (!event.currentTarget.open) selected = null;
}}>
  <summary>Mémoires du compte</summary>
  <div class="settings-item-actions">
    <button type="button" class="settings-btn" disabled={busy} onclick={load}>Actualiser</button>
    {#if rows.length}<button type="button" class="settings-btn danger" disabled={busy} onclick={() => remove()}>Tout supprimer</button>{/if}
  </div>
  {#if busy}<p role="status">Chargement…</p>{/if}
  {#if status}<p class="settings-error" role="alert">{status}</p>{/if}
  {#if fetched && !rows.length}<p>Aucune mémoire enregistrée.</p>{/if}
  {#each rows as item (item.id)}
    <article>
      <strong>{title(item)}</strong>
      <div class="settings-item-actions">
        <button type="button" class="settings-btn small" disabled={busy} aria-expanded={selected?.id === item.id}
          onclick={() => read(item)}>{selected?.id === item.id ? "Masquer" : "Lire"}</button>
        <button type="button" class="settings-btn small danger" disabled={busy} onclick={() => remove(item)}>Supprimer</button>
      </div>
      {#if selected?.id === item.id}<pre>{selected.text || "Mémoire vide."}</pre>{/if}
    </article>
  {/each}
</details>

<style>
  summary { cursor: pointer; font-weight: 600; }
  article { margin-top: .65rem; border-top: 1px solid var(--border); padding-top: .55rem; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 16rem; overflow: auto; }
</style>
