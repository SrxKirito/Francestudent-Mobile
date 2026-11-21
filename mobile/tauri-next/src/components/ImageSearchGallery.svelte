<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { CommonsImage, ImageSearch } from "../lib/services/image-search.ts";
  import { canSaveCommonsImage, MAX_IMAGE_RESULTS, normalizeCommonsImage, searchCommons } from "../lib/services/image-search.ts";
  import { copyText } from "../lib/utils/clipboard.ts";

  let { search, canSearch, onupdate, onfile }: {
    search: ImageSearch;
    canSearch: boolean;
    onupdate: (search: ImageSearch) => void;
    onfile: (image: CommonsImage, action: "download" | "library") => Promise<void>;
  } = $props();
  const lifetime = new AbortController();
  let loading = $state(false);
  let failure = $state("");
  let status = $state("");
  let working = $state(false);
  let selected = $state<number | null>(null);
  let zoom = $state(false);
  let fullscreen = $state(false);
  let opener: HTMLElement | null;
  let dialog: HTMLDialogElement;
  const images = $derived((search.results ?? []).flatMap(row => {
    const image = normalizeCommonsImage(row);
    return image ? [image] : [];
  }));
  const item = $derived(selected === null ? null : images[selected]);

  onMount(() => {
    if (!search.results) void load();
    return () => lifetime.abort();
  });

  async function load() {
    if (loading || (search.results && search.next === undefined)) return;
    if (!canSearch) { failure = "Passe la recherche web en mode Ouvert pour rechercher sur Wikimedia Commons."; return; }
    loading = true;
    failure = "";
    const offset = search.next ?? 0;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    lifetime.signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 15_000);
    const { signal } = controller;
    try {
      const page = await searchCommons(search.query, offset, signal);
      if (signal.aborted) return;
      const results = [...new Map([...images, ...page.results].map(image => [image.id, image])).values()].slice(0, MAX_IMAGE_RESULTS);
      onupdate({ query: search.query, results, next: results.length < MAX_IMAGE_RESULTS ? page.next : undefined });
    } catch (error) {
      if (!lifetime.signal.aborted) {
        failure = signal.aborted ? "La recherche d’images a pris trop de temps." :
          error instanceof Error ? error.message : "Recherche d’images impossible.";
      }
    } finally {
      clearTimeout(timeout);
      lifetime.signal.removeEventListener("abort", cancel);
      loading = false;
    }
  }

  async function show(index: number, button: HTMLElement) {
    opener = button;
    selected = index;
    zoom = false;
    fullscreen = false;
    status = "";
    await tick();
    if (dialog && !dialog.open) dialog.showModal();
  }

  function move(step: number) {
    if (selected === null) return;
    const next = selected + step;
    if (next < 0 || next >= images.length) return;
    selected = next;
    zoom = false;
    status = "";
  }

  function close() {
    selected = null;
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  async function copy(image: CommonsImage) {
    status = await copyText(image.source) ? "Lien copié." : "Copie du lien impossible.";
  }

  async function file(image: CommonsImage, action: "download" | "library") {
    if (working) return;
    working = true;
    status = "";
    try {
      await onfile(image, action);
      if (item?.id === image.id) status = action === "library" ? "Image enregistrée dans la bibliothèque." : "Image téléchargée.";
    } catch (error) {
      if (item?.id === image.id) status = error instanceof Error ? error.message : "Impossible d’enregistrer cette image.";
    } finally { working = false; }
  }
</script>

<section class="image-search-gallery" aria-label={"Images pour " + search.query}>
  <h3>Images pour « {search.query} »</h3>
  <p>Wikimedia Commons</p>
  <ul class="results">
    {#each images as image, index (image.id)}
      <li>
        <button type="button" class="tile" onclick={event => void show(index, event.currentTarget)}>
          <img src={image.thumbnail} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <span>{image.title}</span>
        </button>
        <small>{image.artist || "Voir le crédit dans la source"}{image.license ? " · " + image.license : ""}</small>
        <a href={image.source} target="_blank" rel="noopener noreferrer">Source</a>
      </li>
    {/each}
  </ul>
  {#if loading}<p role="status">Recherche d’images…</p>
  {:else if failure}<p role="alert">{failure}</p>
  {:else if search.results && !images.length}<p>Aucune image sur cette page.</p>{/if}
  {#if failure || search.next !== undefined}
    <button type="button" class="settings-btn" disabled={loading} onclick={() => void load()}>{failure ? "Réessayer" : "Charger plus d’images"}</button>
  {/if}
</section>

<dialog class="commons-preview" class:fullscreen aria-label="Aperçu de l’image" bind:this={dialog} onclose={close}
  onkeydown={event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  }}>
  {#if item && selected !== null}
    <header>
      <h3>{item.title}</h3>
      <div class="actions">
        <button type="button" class="settings-btn" onclick={() => dialog.close()}>Fermer</button>
        <button type="button" class="settings-btn" aria-pressed={fullscreen} onclick={() => fullscreen = !fullscreen}>Plein écran</button>
      </div>
    </header>
    <p>{item.artist || "Crédit sur la page source"}{item.license ? " · " + item.license : ""}</p>
    <nav aria-label="Navigation entre les images">
      <button type="button" class="settings-btn" disabled={selected === 0} onclick={() => move(-1)}>Précédente</button>
      <span>{selected + 1} / {images.length}</span>
      <button type="button" class="settings-btn" disabled={selected + 1 >= images.length} onclick={() => move(1)}>Suivante</button>
      <button type="button" class="settings-btn" aria-pressed={zoom} onclick={() => zoom = !zoom}>{zoom ? "Réduire" : "Agrandir"}</button>
    </nav>
    <div class="visual" class:zoom>
      <img src={item.thumbnail} alt={item.title} decoding="async" referrerpolicy="no-referrer">
    </div>
    <div class="actions">
      <a href={item.source} target="_blank" rel="noopener noreferrer">Ouvrir la source</a>
      <button type="button" class="settings-btn" onclick={() => void copy(item)}>Copier le lien</button>
      {#if canSaveCommonsImage(item)}
        <button type="button" class="settings-btn" disabled={working} onclick={() => void file(item, "download")}>Télécharger</button>
        <button type="button" class="settings-btn" disabled={working} onclick={() => void file(item, "library")}>Enregistrer dans la bibliothèque</button>
      {/if}
    </div>
    {#if status}<p role="status">{status}</p>{/if}
  {/if}
</dialog>

<style>
  h3 { margin: 0; overflow-wrap: anywhere; }
  p { margin-block: .35rem .65rem; }
  .results { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 135px), 1fr)); gap: .75rem; list-style: none; padding: 0; }
  li { min-width: 0; overflow-wrap: anywhere; }
  .tile { display: grid; gap: .35rem; width: 100%; padding: .35rem; text-align: start; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: .65rem; cursor: pointer; }
  .tile img { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; }
  small { display: block; color: var(--muted); }
  .commons-preview { position: fixed; inset: 0; overflow-y: auto; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: .8rem; box-sizing: border-box; width: min(52rem, calc(100% - max(2rem, env(safe-area-inset-left) + env(safe-area-inset-right)))); max-height: calc(var(--ios-viewport-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem); padding: 1rem; }
  .commons-preview.fullscreen { width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left)); }
  .commons-preview::backdrop { background: rgb(0 0 0 / 75%); }
  header, nav, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: .55rem; margin-bottom: .6rem; }
  header { justify-content: space-between; }
  .visual { overflow: auto; height: min(50dvh, 32rem); }
  .visual img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .visual.zoom img { width: 175%; height: 175%; }
</style>
