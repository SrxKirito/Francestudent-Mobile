<script lang="ts">
  import { onMount, tick, type Snippet } from "svelte";
  import { errorMessage } from "../lib/utils/errors.ts";
  import LibraryThumbnail from "./LibraryThumbnail.svelte";
  import WorkspaceIcon from "./WorkspaceIcon.svelte";
  import { FILE_SORTS, formatBytes } from "../lib/services/workspace-engine.ts";
  import type { FileUsage, RemoteFile, WorkspaceEngine } from "../lib/services/workspace-engine.ts";

  type Category = "files" | "images";
  let { engine, scrollRoot, onconfirm, onarchives, archivePage, onskills }: {
    engine: WorkspaceEngine;
    scrollRoot?: HTMLElement;
    onconfirm: (text: string) => Promise<boolean>;
    onarchives?: () => void;
    archivePage?: Snippet;
    onskills?: () => void;
  } = $props();
  let usage = $state.raw<FileUsage | null>(null);
  let files = $state.raw<RemoteFile[]>([]);
  let hasMore = $state(false);
  let busy = $state(false);
  let usageLoading = $state(false);
  let usageError = $state("");
  let moreMarker = $state<HTMLElement>();
  let pagingError = $state(false);
  const canObserve = typeof IntersectionObserver === "function";
  let detail = $state<Category | "archives" | null>(null);
  let archiveButton: HTMLButtonElement | undefined = $state();
  let detailHeading: HTMLHeadingElement | undefined = $state();
  let query = $state("");
  let sort = $state("date-desc");
  let message = $state("");
  let live = true;
  const rows = $derived(engine.arrange(files.filter(file =>
    (engine.fileKind(file.filename || "") === "image") === (detail === "images")
  ), { query, kind: "*", sort }));
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

  function fileDate(stamp?: number) {
    if (!Number.isFinite(stamp) || !stamp) return "";
    const date = new Date(stamp < 1e12 ? stamp * 1000 : stamp);
    return Number.isNaN(date.valueOf()) ? "" : dateFormat.format(date);
  }
  const percent = $derived(usage && usage.maxBytes > 0 ? Math.min(100, Math.round(100 * usage.usedBytes / usage.maxBytes)) : null);

  onMount(() => {
    if (scrollRoot) scrollRoot.scrollTop = 0;
    sync();
    const unsubscribe = engine.watchFiles(sync);
    void readUsage(false);
    return () => { live = false; unsubscribe(); };
  });

  function sync() {
    files = engine.files();
    hasMore = engine.moreFiles();
    if (engine.cachedUsage) usage = engine.cachedUsage();
  }

  async function readUsage(force: boolean) {
    if (usageLoading) return;
    usageLoading = true;
    usageError = "";
    try {
      const data = await engine.usage(force);
      if (live) usage = engine.cachedUsage?.() ?? data;
    } catch (error) {
      if (live) usageError = errorMessage(error);
    } finally {
      if (live) usageLoading = false;
    }
  }

  function nextPage() {
    return run(async () => {
      pagingError = false;
      try { await engine.loadMore(); }
      catch (error) {
        pagingError = true;
        throw error;
      }
    });
  }

  $effect(() => {
    if (!canObserve || !scrollRoot || !moreMarker || !hasMore || busy || pagingError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void nextPage();
    }, { root: scrollRoot, rootMargin: "0px 0px 180px" });
    observer.observe(moreMarker);
    return () => observer.disconnect();
  });

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

  function showFiles(category: Category) {
    detail = category;
    query = "";
    pagingError = false;
    if (scrollRoot) scrollRoot.scrollTop = 0;
    void run(() => engine.loadFiles());
    void tick().then(() => detailHeading?.focus({ preventScroll: true }));
  }

  function showArchives() {
    message = "";
    detail = "archives";
    onarchives?.();
    void tick().then(() => detailHeading?.focus());
  }

  function back() {
    const fromArchives = detail === "archives";
    detail = null;
    message = "";
    if (scrollRoot) scrollRoot.scrollTop = 0;
    if (fromArchives) void tick().then(() => archiveButton?.focus());
  }

  function remove(file: RemoteFile) {
    void run(async () => {
      if (!await onconfirm("Supprimer définitivement « " + (file.filename || file.id) + " » ?") || !live) return;
      await engine.removeFile(file.id);
      await readUsage(false);
    });
  }
</script>

<div id="panel-storage" class="settings-panel" role="tabpanel" aria-labelledby="tab-storage">
  {#if !detail}
    <h3 class="settings-section-title">Stockage FRST</h3>
    {#if usage}
      <p class="storage-quota">{formatBytes(usage.usedBytes)} utilisés sur {formatBytes(usage.maxBytes)}</p>
      {#if percent !== null}<progress max="100" value={percent} aria-label="Stockage utilisé">{percent} %</progress>{/if}
      {#if usage.remainingBytes !== undefined}<p class="settings-hint">{formatBytes(usage.remainingBytes)} restants</p>{/if}
    {:else if usageLoading}
      <p class="storage-quota" role="status">Chargement du quota…</p>
      <progress aria-label="Chargement du quota"></progress>
    {/if}
    {#if usageError}<p role="alert" class="settings-error">{usageError}</p>{/if}
    <div class="storage-heading">
      <h4>Gérer le stockage</h4>
      <button type="button" class="settings-btn storage-action" aria-label="Actualiser le quota" disabled={usageLoading}
        onclick={() => void readUsage(true)}><WorkspaceIcon name="refresh" size={17} /></button>
    </div>
    <div class="storage-list">
      <button id="storage-files" type="button" class="settings-btn category" onclick={() => showFiles("files")}>
        <WorkspaceIcon name="folder" size={21} /><span><strong>Fichiers</strong><small>Documents et autres fichiers</small></span><WorkspaceIcon name="next" size={16} />
      </button>
      <button id="storage-images" type="button" class="settings-btn category" onclick={() => showFiles("images")}>
        <WorkspaceIcon name="image" size={21} /><span><strong>Images</strong><small>Voir les images et leurs aperçus</small></span><WorkspaceIcon name="next" size={16} />
      </button>
      {#if onarchives && archivePage}
        <button id="storage-archives" type="button" class="settings-btn category" bind:this={archiveButton} onclick={showArchives}>
          <WorkspaceIcon name="archive" size={21} /><span><strong>Discussions archivées</strong><small>Restaurer ou télécharger</small></span><WorkspaceIcon name="next" size={16} />
        </button>
      {/if}
      {#if onskills}
        <button type="button" class="settings-btn category" onclick={onskills}>
          <WorkspaceIcon name="skills" size={21} /><span><strong>Skills</strong>{#if usage?.skillsBytes !== undefined}<small>{formatBytes(usage.skillsBytes)}</small>{/if}</span><WorkspaceIcon name="next" size={16} />
        </button>
      {/if}
    </div>
  {:else}
    <div class="storage-heading detail">
      <button type="button" class="settings-btn storage-action" aria-label="Retour au stockage" disabled={busy}
        onclick={back}><WorkspaceIcon name="back" size={18} /></button>
      <h3 class="settings-section-title" tabindex="-1" bind:this={detailHeading}>{detail === "archives" ? "Discussions archivées" : detail === "images" ? "Images" : "Fichiers"}</h3>
      {#if detail !== "archives"}<button type="button" class="settings-btn storage-action" aria-label="Actualiser les fichiers" disabled={busy}
        onclick={() => void run(() => { pagingError = false; return engine.refreshFiles(); })}><WorkspaceIcon name="refresh" size={17} /></button>{/if}
    </div>
    {#if detail === "archives"}
      {@render archivePage?.()}
    {:else}
    <div class="library-filters">
      <input type="search" class="settings-input" aria-label="Rechercher un fichier" placeholder="Rechercher un fichier" bind:value={query}>
      <select class="settings-input" aria-label="Trier les fichiers" bind:value={sort}>{#each FILE_SORTS as [value, label]}<option {value}>{label}</option>{/each}</select>
    </div>
    <div class="storage-list">
      {#each rows as file, index (file.id)}
        {@const name = file.filename || file.id}
        {@const date = fileDate(file.created_at)}
        <div class="settings-item storage-file">
          <button type="button" class="storage-preview" aria-label={"Aperçu de " + name} disabled={busy}
            onclick={() => void run(() => engine.previewRemote(file.id))}>
            <LibraryThumbnail {engine} id={file.id} {name} local={false} compact eager={index < 6} />
            <span><strong>{name}</strong><small>{date ? date + " · " : ""}{formatBytes(file.bytes)}</small></span>
          </button>
          <button type="button" class="settings-btn storage-action" aria-label={"Télécharger " + name} disabled={busy}
            onclick={() => void run(() => engine.saveRemote(file.id))}><WorkspaceIcon name="download" size={18} /></button>
          <button type="button" class="settings-btn storage-action danger" aria-label={"Supprimer " + name} disabled={busy}
            onclick={() => remove(file)}><WorkspaceIcon name="trash" size={18} /></button>
        </div>
      {:else}
        {#if !busy && !message}<p class="settings-hint">{hasMore ? "Aucun résultat dans les fichiers chargés." : "Aucun fichier dans cette liste."}</p>{/if}
      {/each}
    </div>
    {#if hasMore}
      <div class="storage-more" bind:this={moreMarker}>
        {#if !canObserve || !scrollRoot || pagingError}<button type="button" class="settings-btn" disabled={busy} onclick={() => void nextPage()}>{pagingError ? "Réessayer" : "Charger plus"}</button>{/if}
      </div>
    {/if}
    {/if}
  {/if}
  {#if busy}<p role="status" class="settings-hint">Chargement…</p>{/if}
  {#if message}<p role="alert" class="settings-error">{message}</p>{/if}
</div>

<style>
  progress { width: 100%; accent-color: var(--accent); }
  .storage-quota { font-weight: 600; }
  .storage-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-block: 14px 9px; }
  .storage-heading h3, .storage-heading h4 { margin: 0; }
  .storage-heading.detail h3 { flex: 1; }
  .storage-list { display: grid; gap: 8px; }
  .storage-more { min-height: 1px; margin-top: 8px; }
  .category { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; text-align: left; width: 100%; min-block-size: 62px; border-radius: 12px; }
  .storage-list strong, .storage-list small { display: block; overflow-wrap: anywhere; }
  .storage-list small { color: var(--muted, #999); font-size: .78rem; margin-top: 2px; }
  .storage-file { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 5px; padding: 6px; }
  .storage-preview { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 44px; background: transparent; color: inherit; border: 0; text-align: left; padding: 0; font: inherit; }
  .storage-action { display: grid; place-items: center; padding: 0; width: 44px; height: 44px; border-radius: 12px; }
</style>
