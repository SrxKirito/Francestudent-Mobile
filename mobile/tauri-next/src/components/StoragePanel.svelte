<script lang="ts">
  import { onMount } from "svelte";
  import { errorMessage } from "../lib/utils/errors.ts";
  import { FILE_KINDS, FILE_SORTS, formatBytes } from "../lib/services/workspace-engine.ts";
  import type { FileUsage, RemoteFile, WorkspaceEngine } from "../lib/services/workspace-engine.ts";

  let { engine, onconfirm }: { engine: WorkspaceEngine; onconfirm: (text: string) => Promise<boolean> } = $props();
  let usage = $state.raw<FileUsage | null>(null);
  let files = $state.raw<RemoteFile[]>([]);
  let hasMore = $state(false);
  let busy = $state(false);
  let detail = $state(false);
  let query = $state("");
  let kind = $state("*");
  let sort = $state("date-desc");
  let message = $state("");
  let live = true;
  let upload: AbortController | null = null;
  let uploading = $state(false);
  let transferPercent = $state(0);
  const rows = $derived(engine.arrange(files, { query, kind, sort }));
  const percent = $derived(usage && usage.maxBytes > 0 ? Math.min(100, Math.round(100 * usage.usedBytes / usage.maxBytes)) : null);

  onMount(() => {
    const unsubscribe = engine.watchFiles(sync);
    void run(() => readUsage(false));
    return () => { live = false; upload?.abort(); unsubscribe(); };
  });

  function sync() {
    files = engine.files();
    hasMore = engine.moreFiles();
  }

  async function readUsage(force: boolean) {
    const data = await engine.usage(force);
    if (live) usage = data;
  }

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    message = "";
    try {
      await work();
      if (live) sync();
    } catch (error) {
      if (live) message = errorMessage(error);
    } finally {
      if (live) busy = false;
    }
  }

  function showFiles() {
    detail = true;
    void run(() => engine.loadFiles());
  }

  function chooseFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !engine.uploadRemote) return;
    void run(async () => {
      const controller = upload = new AbortController();
      transferPercent = 0;
      uploading = true;
      try {
        await engine.uploadRemote?.(file, controller.signal, (sent, total) => {
          transferPercent = Math.round(100 * sent / total);
        });
        if (!live) return;
        await engine.loadFiles();
        await readUsage(false);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        upload = null;
        uploading = false;
      }
    });
  }

  function remove(file: RemoteFile) {
    void run(async () => {
      if (!await onconfirm("Supprimer définitivement « " + (file.filename || file.id) + " » ?") || !live) return;
      await engine.removeFile(file.id);
      try { await readUsage(false); }
      catch { if (live) message = "Fichier supprimé. Le quota n’a pas pu être actualisé."; }
    });
  }
</script>

<div id="panel-storage" class="settings-panel" role="tabpanel" aria-labelledby="tab-storage">
  <h3 class="settings-section-title">Stockage FRST</h3>
  {#if !detail}
    {#if usage}
      <p>{formatBytes(usage.usedBytes)} utilisés sur {formatBytes(usage.maxBytes)}</p>
      {#if percent !== null}<progress max="100" value={percent} aria-label="Stockage utilisé">{percent} %</progress>{/if}
      {#if usage.remainingBytes !== undefined}<p>{formatBytes(usage.remainingBytes)} restants</p>{/if}
      <p>Fichiers · {formatBytes(usage.filesBytes)}</p>
      <p>Skills · {formatBytes(usage.skillsBytes)}</p>
    {/if}
    <div class="settings-item-actions">
      <button type="button" class="settings-btn" disabled={busy} onclick={showFiles}>Gérer les fichiers</button>
      <button type="button" class="settings-btn" disabled={busy} onclick={() => void run(() => readUsage(true))}>Actualiser le quota</button>
    </div>
  {:else}
    <div class="settings-item-actions">
      <button type="button" class="settings-btn" disabled={busy} onclick={() => { detail = false; message = ""; }}>Retour au quota</button>
      <button type="button" class="settings-btn" disabled={busy} onclick={() => void run(() => engine.refreshFiles())}>Actualiser les fichiers</button>
    </div>
    {#if engine.uploadRemote}
      <label class="settings-label">Ajouter un fichier au stockage FRST
        <input type="file" class="settings-input" disabled={busy} onchange={chooseFile}>
      </label>
    {/if}
    {#if uploading}
      <progress max="100" value={transferPercent} aria-label="Progression du transfert">{transferPercent} %</progress>
      <button type="button" class="settings-btn" onclick={() => upload?.abort()}>Annuler le transfert</button>
    {/if}
    <div class="library-filters">
      <input type="search" class="settings-input" aria-label="Rechercher un fichier" placeholder="Rechercher un fichier" bind:value={query}>
      <select class="settings-input" aria-label="Type de fichier" bind:value={kind}>{#each FILE_KINDS as [value, label]}<option {value}>{label}</option>{/each}</select>
      <select class="settings-input" aria-label="Trier les fichiers" bind:value={sort}>{#each FILE_SORTS as [value, label]}<option {value}>{label}</option>{/each}</select>
    </div>
    {#each rows as file (file.id)}
      <div class="settings-item">
        <div class="settings-item-head"><strong>{file.filename || file.id}</strong><span>{formatBytes(file.bytes)}</span></div>
        <button type="button" class="settings-btn small" disabled={busy} onclick={() => void run(() => engine.saveRemote(file.id))}>Télécharger</button>
        <button type="button" class="settings-btn small danger" disabled={busy} onclick={() => remove(file)}>Supprimer</button>
      </div>
    {:else}
      {#if !busy && !message}<p class="settings-hint">Aucun fichier dans cette liste.</p>{/if}
    {/each}
    {#if hasMore}<button type="button" class="settings-btn" disabled={busy} onclick={() => void run(() => engine.loadMore())}>Charger plus</button>{/if}
  {/if}
  {#if busy}<p role="status" class="settings-hint">Chargement…</p>{/if}
  {#if message}<p role="alert" class="settings-error">{message}</p>{/if}
</div>

<style>
  progress { width: 100%; accent-color: var(--accent); }
  strong { overflow-wrap: anywhere; }
</style>
