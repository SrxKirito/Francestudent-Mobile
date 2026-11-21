<script lang="ts">
  import { onMount } from "svelte";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import type { LibraryRecord, PendingResponse, RemoteFile, WorkspaceEngine } from "../lib/services/workspace-engine.ts";
  import { FILE_KINDS, FILE_SORTS, formatBytes } from "../lib/services/workspace-engine.ts";
  import { errorMessage } from "../lib/utils/errors.ts";
  import WorkspaceIcon from "./WorkspaceIcon.svelte";
  import SavedMessages from "./SavedMessages.svelte";
  import LibraryThumbnail from "./LibraryThumbnail.svelte";

  let { engine, api, katexReady, onclose, ontoast, onopenmessage, onconfirm }: {
    engine: WorkspaceEngine; api: ApiClient; katexReady: boolean; onclose: () => void; ontoast: (message: string, error: boolean) => void;
    onopenmessage: (id: string) => Promise<boolean>;
    onconfirm: (text: string) => Promise<boolean>;
  } = $props();
  let dialog: HTMLDialogElement;
  let files = $state.raw<RemoteFile[]>([]);
  let localFiles = $state.raw<LibraryRecord[]>([]);
  let projects = $state.raw<{ id: string; name: string }[]>([]);
  let pending = $state.raw<PendingResponse[]>([]);
  let hasMore = $state(false);
  let moreMarker = $state<HTMLElement>();
  let pagingError = $state(false);
  const canObserve = typeof IntersectionObserver === "function";
  let busy = $state(false);
  let fileMessage = $state("");
  let localMessage = $state("");
  let actionMessage = $state("");
  let source = $state("all");
  let project = $state("*");
  const showMore = $derived(hasMore && (source === "all" || source === "remote") && project === "*");
  let query = $state("");
  let kind = $state("*");
  let sort = $state("date-desc");
  let inView = true;
  const lifetime = new AbortController();

  const remote = $derived((source === "all" || source === "remote") && project === "*" ? engine.arrange(files, { query, kind, sort }).map(file => ({
    key: "remote:" + file.id, id: file.id, name: file.filename || "Fichier enregistré", note: formatBytes(file.bytes), attribution: undefined,
    local: false, date: file.created_at ?? 0, bytes: file.bytes, projectId: ""
  })) : []);
  const local = $derived(localFiles.filter(file => source !== "remote" && (source === "all" || source === file.direction) &&
    (project === "*" || (file.projectId || "") === project) && (kind === "*" || (file.kind || engine.fileKind(file.name)) === kind) &&
    file.name.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"))).map(file => ({
    key: "local:" + file.id, id: file.id, name: file.name, note: file.direction === "sent" ? "Envoyé" : file.direction === "found" ? "Wikimedia Commons" : "Généré", attribution: file.attribution,
    local: true, date: file.created, bytes: undefined, projectId: file.projectId
  })));
  const cards = $derived([...remote, ...local].sort((a, b) => {
    if (sort.startsWith("name")) return a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" }) * (sort === "name-asc" ? 1 : -1);
    if (sort.startsWith("size")) return a.bytes === undefined ? (b.bytes === undefined ? 0 : 1) : b.bytes === undefined ? -1 : (a.bytes - b.bytes) * (sort === "size-asc" ? 1 : -1);
    const timestamp = (date: number) => date < 1e12 ? date * 1000 : date;
    return (timestamp(a.date) - timestamp(b.date)) * (sort === "date-asc" ? 1 : -1);
  }));

  function nextPage() {
    return operate(async () => {
      pagingError = false;
      try { await engine.loadMore(); }
      catch (error) { pagingError = true; throw error; }
    });
  }

  $effect(() => {
    if (!canObserve || !showMore || !moreMarker || busy || pagingError || fileMessage) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void nextPage();
    }, { root: dialog, rootMargin: "180px" });
    observer.observe(moreMarker);
    return () => observer.disconnect();
  });

  function sync() {
    files = engine.files();
    hasMore = engine.moreFiles();
    pending = engine.pending();
  }

  onMount(() => {
    dialog.showModal();
    sync();
    const unsubscribe = engine.watchFiles(sync);
    void refresh(false);
    void api.json<{ projects?: { id: string; name: string }[] } | { id: string; name: string }[]>("/projects", { signal: lifetime.signal }).then(result => {
      if (!inView) return;
      const items = Array.isArray(result) ? result : result?.projects;
      if (Array.isArray(items)) projects = items.filter(row => row?.id && row?.name);
    }).catch(() => {});
    return () => { inView = false; lifetime.abort(); unsubscribe(); };
  });

  async function operate(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    actionMessage = "";
    try { await work(); }
    catch (error) {
      const description = errorMessage(error);
      if (inView) actionMessage = description;
      else ontoast(description, true);
    } finally {
      if (inView) { busy = false; sync(); }
    }
  }

  function refresh(force: boolean) {
    return operate(async () => {
      pagingError = false;
      fileMessage = localMessage = "";
      const [remoteResult, localResult] = await Promise.allSettled([
        force ? engine.refreshFiles() : engine.loadFiles(), engine.localFiles()
      ]);
      if (!inView) return;
      if (remoteResult.status === "rejected") fileMessage = "Fichiers FRST : " + errorMessage(remoteResult.reason);
      if (localResult.status === "fulfilled") localFiles = localResult.value;
      else localMessage = "Fichiers de discussions : " + errorMessage(localResult.reason);
    });
  }

  function open(id: string, local: boolean) {
    void operate(async () => {
      onclose();
      if (local) await engine.localFileAction(id, "preview");
      else await engine.previewRemote(id);
    });
  }

  function fileAction(id: string, local: boolean, action: "save" | "chat") {
    void operate(async () => {
      if (action === "chat") onclose();
      if (local) {
        await engine.localFileAction(id, action);
        if (action === "save") ontoast("Fichier enregistré.", false);
      } else if (typeof await engine.saveRemote(id) === "string") {
        ontoast("Fichier enregistré.", false);
      }
    });
  }

  function classify(fileId: string, projectId: string) {
    void operate(async () => {
      await engine.classifyLocal(fileId, projectId);
      if (inView) localFiles = localFiles.map(file => file.id === fileId ? { ...file, projectId } : file);
    });
  }
</script>

<dialog id="svelte-library" class="file-library" aria-labelledby="svelte-library-title" bind:this={dialog} oncancel={event => { event.preventDefault(); onclose(); }}>
  <header><div><h2 id="svelte-library-title">Bibliothèque</h2></div><div class="library-header-actions">
    <button type="button" class="library-refresh" aria-label="Actualiser les fichiers" title="Actualiser" disabled={busy} onclick={() => void refresh(true)}><WorkspaceIcon name="refresh" size={18} /></button>
    <button type="button" aria-label="Fermer" onclick={onclose}>×</button>
  </div></header>
  <SavedMessages {api} {katexReady} onopen={onopenmessage} />
  {#each pending as row (row.id)}
    <div class="library-job">
      <strong>Réponse en attente · {row.title}</strong>
      <button type="button" disabled={busy || !row.resume} onclick={() => void operate(async () => { onclose(); await engine.pendingAction(row.id, "resume"); })}>Reprendre</button>
      <button type="button" disabled={busy} onclick={() => void operate(async () => { if (await onconfirm("Annuler le suivi de cette réponse ?")) await engine.pendingAction(row.id, "cancel"); })}>Annuler</button>
    </div>
  {/each}
  <input class="settings-input library-search" type="search" placeholder="Rechercher un fichier" aria-label="Rechercher un fichier" bind:value={query}>
  <details class="library-refinements"><summary>Filtres et tri</summary><div class="library-filters">
    <select aria-label="Origine" bind:value={source}><option value="all">Toutes les sources</option><option value="remote">Fichiers FRST</option><option value="generated">Fichiers générés</option><option value="sent">Fichiers envoyés</option><option value="found">Images trouvées</option></select>
    <select aria-label="Type de fichier" bind:value={kind}>{#each FILE_KINDS as [value, label]}<option {value}>{label}</option>{/each}</select>
    <select aria-label="Projet" bind:value={project}><option value="*">Tous les projets</option><option value="">Sans projet</option>{#each projects as item (item.id)}<option value={item.id}>{item.name}</option>{/each}</select>
    <select aria-label="Trier les fichiers" bind:value={sort}>{#each FILE_SORTS as [value, label]}<option {value}>{label}</option>{/each}</select>
  </div></details>
  {#if fileMessage}<p role="alert" class="settings-error">{fileMessage}</p>{/if}
  {#if localMessage}<p role="alert" class="settings-error">{localMessage}</p>{/if}
  {#if actionMessage}<p role="alert" class="settings-error">{actionMessage}</p>{/if}
  <p role="status">{busy ? "Chargement…" : cards.length + " fichier(s) affiché(s)"}</p>
  <div class="library-grid" style:--library-columns={engine.libraryColumns()}>
    {#each cards as file, index (file.key)}
      <article class="library-card">
        <button type="button" class="library-open" disabled={busy} onclick={() => open(file.id, file.local)}>
          <LibraryThumbnail {engine} id={file.id} name={file.name} local={file.local} eager={index < 6} />
          <strong>{file.name}</strong>
        </button>
        <small>{file.note}</small>
        {#if file.attribution && file.attribution.url.startsWith("https://commons.wikimedia.org/wiki/File:")}
          <small>{file.attribution.artist} · {file.attribution.license} · <a href={file.attribution.url} target="_blank" rel="noopener noreferrer">Source</a></small>
        {/if}
        <details class="library-actions">
          <summary aria-label={"Actions pour " + file.name}>•••</summary>
          <div class="library-card-menu">
            <button type="button" disabled={busy} onclick={() => fileAction(file.id, file.local, "save")}>Enregistrer</button>
            {#if file.local}
              <button type="button" disabled={busy} onclick={() => fileAction(file.id, true, "chat")}>Ouvrir le chat</button>
              <select aria-label={"Classer localement " + file.name + " dans un projet"} value={file.projectId} disabled={busy} onchange={event => { const selected = event.currentTarget.value; event.currentTarget.value = file.projectId; classify(file.id, selected); }}>
                <option value="">Sans projet</option>
                {#each projects as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
              </select>
            {/if}
          </div>
        </details>
      </article>
    {/each}
  </div>
  {#if showMore}
    <div class="library-more-marker" bind:this={moreMarker} aria-hidden="true"></div>
    {#if !canObserve || pagingError}
      <button type="button" class="settings-btn" disabled={busy} onclick={() => void nextPage()}>{pagingError ? "Réessayer" : "Charger plus de fichiers FRST"}</button>
    {/if}
  {/if}
</dialog>

<style>
  .library-header-actions { display: flex; align-items: center; gap: .5rem; }
  .library-refresh { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; }
  .library-search { width: 100%; margin-block: .6rem; }
  .library-refinements { margin-block-end: .65rem; }
  .library-refinements summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; gap: .45rem; color: var(--muted); }
  .library-refinements summary::before { content: "›"; }
  .library-refinements[open] summary::before { transform: rotate(90deg); }
  .library-more-marker { height: 1px; }
</style>
