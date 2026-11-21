<script lang="ts">
  import type { PreviewFile } from "../lib/services/file-preview.ts";
  import { safeFileName } from "../lib/services/file-preview.ts";
  import type { PdfDocument, Presentation } from "../lib/services/document-assets.ts";
  import { extractDocumentText, MAX_PREVIEW_BYTES, openPdf } from "../lib/services/document-assets.ts";
  import { saveBytes } from "../lib/services/file-saver.ts";
  import PreviewPdf from "./PreviewPdf.svelte";

  type View =
    | { kind: "image"; url: string }
    | { kind: "pdf"; pdf: PdfDocument }
    | { kind: "slides"; presentation: Presentation }
    | { kind: "text"; text: string }
    | { kind: "unavailable"; detail: string };

  let { file, onclose }: { file: PreviewFile | null; onclose: () => void } = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let view: View | null = $state.raw(null);
  let loadedBlob: Blob | null = $state.raw(null);
  let saveBusy = $state(false);
  let status = $state("");
  let slideIndex = $state(0);
  let zoom = $state(1);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  function selectedSlide(current: View | null, index: number) {
    return current?.kind === "slides" ? current.presentation.slides[index] : null;
  }
  const slide = $derived(selectedSlide(view, slideIndex));

  $effect(() => {
    const current = file;
    const element = dialog;
    if (!element) return;
    if (!current) {
      if (element.open) element.close();
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let ownedUrl: string | undefined;
    let pdf: PdfDocument | undefined;
    view = null;
    loadedBlob = null;
    status = "";
    slideIndex = 0;
    zoom = 1;
    if (!element.open) element.showModal();

    async function read() {
      if (!current) return;
      try {
        if (current.presentation) {
          const presentation = await current.presentation();
          if (!signal.aborted) view = { kind: "slides", presentation };
          return;
        }
        const blob = await current.load(signal);
        if (signal.aborted) return;
        loadedBlob = blob;
        if (blob.size > MAX_PREVIEW_BYTES) {
          view = { kind: "unavailable", detail: "Ce fichier est trop volumineux pour l’aperçu." };
        } else if (/^image\/(?:png|jpe?g|webp|gif|avif|bmp)(?:$|[; ])/i.test(blob.type)) {
          ownedUrl = URL.createObjectURL(blob);
          view = { kind: "image", url: ownedUrl };
        } else if (blob.type === "application/pdf" || /\.pdf$/i.test(current.name)) {
          const opened = await openPdf(blob, signal);
          if (signal.aborted) {
            await opened.destroy();
            return;
          }
          pdf = opened;
          view = { kind: "pdf", pdf: opened };
        } else {
          const extracted = await extractDocumentText(blob, current.name, signal);
          if (signal.aborted) return;
          const slides = extracted && /\.pptx$/i.test(current.name) ? textSlides(extracted.text) : [];
          if (slides.length) view = { kind: "slides", presentation: { title: current.name, subtitle: "", slides } };
          else view = extracted ? { kind: "text", text: extracted.text } :
            { kind: "unavailable", detail: "Aucun aperçu disponible pour ce fichier." };
        }
      } catch (error) {
        if (!signal.aborted) view = { kind: "unavailable", detail: error instanceof Error ? error.message : "Impossible d’ouvrir l’aperçu." };
      }
    }

    void read();
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      if (pdf) void pdf.destroy().catch(() => {});
    };
  });

  function textSlides(text: string): Presentation["slides"] {
    return text.split(/^--- Diapositive \d+ ---\n/gm).slice(1, 201).map((part, index) => {
      const [first, ...bullets] = part.trim().split(/\n+/);
      return {
        title: first || "Diapositive " + (index + 1),
        bullets,
        notes: "",
        layout: "",
        illustration: ""
      };
    });
  }

  async function share() {
    const current = file;
    const bytes = loadedBlob;
    if (!current || !bytes || saveBusy || bytes.size > MAX_PREVIEW_BYTES) return;
    try {
      const files = [new File([bytes], safeFileName(current.name), { type: bytes.type })];
      if (navigator.canShare && !navigator.canShare({ files })) throw new Error("Cet appareil ne peut pas partager ce type de fichier.");
      await navigator.share({ files });
    } catch (error) {
      if (file === current && (!(error instanceof DOMException) || error.name !== "AbortError")) {
        status = error instanceof Error ? error.message : "Partage indisponible.";
      }
    }
  }

  async function save() {
    const current = file;
    if (!current || saveBusy) return;
    saveBusy = true;
    status = "";
    try {
      if (current.save) await current.save();
      else {
        const blob = loadedBlob ?? await current.load();
        if (file !== current) return;
        await saveBytes(safeFileName(current.name), new Uint8Array(await blob.arrayBuffer()));
      }
      if (file === current) status = "Fichier enregistré.";
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Vérifie l’emplacement choisi.";
      if (file === current && !/annul[ée]|abort/i.test(detail)) status = "Enregistrement impossible : " + detail;
    } finally {
      saveBusy = false;
    }
  }
</script>

<dialog class="preview-dialog" bind:this={dialog} aria-labelledby="preview-title" oncancel={event => { event.preventDefault(); onclose(); }}>
  {#if file}
    <header>
      <h2 id="preview-title">{file.name}</h2>
      <button type="button" class="settings-btn" onclick={onclose} aria-label="Fermer l’aperçu">Fermer</button>
    </header>
    <div class="preview-content">
      {#if view?.kind === "image"}
        <div class="image-controls">
          <button type="button" class="settings-btn" aria-label="Réduire le zoom" disabled={zoom === 1} onclick={() => { zoom = Math.max(1, zoom - .5); }}>−</button>
          <span role="status">{Math.round(zoom * 100)} %</span>
          <button type="button" class="settings-btn" aria-label="Augmenter le zoom" disabled={zoom === 3} onclick={() => { zoom = Math.min(3, zoom + .5); }}>+</button>
        </div>
        <img src={view.url} alt={file.name} class:zoomed={zoom > 1} style:--preview-width={zoom * 100 + "%"}>
      {:else if view?.kind === "pdf"}
        {#key view.pdf}<PreviewPdf pdf={view.pdf} />{/key}
      {:else if view?.kind === "slides" && slide}
        <nav aria-label="Diapositives" class="slides-controls">
          <button type="button" class="settings-btn" aria-label="Diapositive précédente" onclick={() => slideIndex--} disabled={slideIndex === 0}>‹</button>
          <span role="status">Diapositive {slideIndex + 1} sur {view.presentation.slides.length}</span>
          <button type="button" class="settings-btn" aria-label="Diapositive suivante" onclick={() => slideIndex++} disabled={slideIndex + 1 >= view.presentation.slides.length}>›</button>
        </nav>
        <article class="slide" class:hero={slide.layout === "hero" || (!slide.layout && slideIndex === 0)}>
          <h3>{slide.title}</h3>
          {#if slideIndex === 0 && view.presentation.subtitle}<p>{view.presentation.subtitle}</p>{/if}
          {#if slide.bullets.length}<ul>{#each slide.bullets as point}<li>{point}</li>{/each}</ul>{/if}
        </article>
        {#if slide.notes}<details><summary>Notes</summary><p>{slide.notes}</p></details>{/if}
      {:else if view?.kind === "text"}
        <pre>{view.text}</pre>
      {:else if view?.kind === "unavailable"}
        <p role="status">{view.detail}</p>
      {:else}
        <p role="status">Chargement de l’aperçu…</p>
      {/if}
    </div>
    <footer>
      <span role="status">{status}</span>
      <div class="preview-actions">
        {#if canShare && loadedBlob && loadedBlob.size <= MAX_PREVIEW_BYTES}
          <button type="button" class="settings-btn" onclick={() => void share()} disabled={saveBusy}>Partager</button>
        {/if}
        <button type="button" class="settings-btn primary" onclick={() => void save()} disabled={saveBusy || (!file.save && !view)}>Enregistrer</button>
      </div>
    </footer>
  {/if}
</dialog>

<style>
  .preview-dialog {
    width: min(56rem, calc(100% - 2rem));
    height: min(50rem, calc(100dvh - 2rem));
    max-width: none;
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--surface);
    color: var(--text);
  }
  .preview-dialog[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
  .preview-dialog::backdrop { background: #000a; }
  header, footer { display: flex; justify-content: space-between; align-items: center; gap: .75rem; padding: .75rem 1rem; }
  header { border-bottom: 1px solid var(--border); }
  footer { border-top: 1px solid var(--border); }
  h2 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
  footer span { overflow-wrap: anywhere; }
  header button, footer button { flex: 0 0 auto; }
  .preview-content { min-height: 0; overflow: auto; padding: 1rem; }
  img { display: block; margin: 0 auto; width: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
  img.zoomed { max-width: none; max-height: none; margin: 0; width: var(--preview-width); }
  .image-controls { position: sticky; left: 0; top: 0; display: flex; align-items: center; justify-content: center; gap: .75rem; margin-bottom: .75rem; background: var(--surface); }
  .preview-actions { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: end; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; }
  .slides-controls { display: flex; align-items: center; justify-content: center; gap: .75rem; margin-bottom: .75rem; }
  .slide { min-height: min(25rem, 50dvh); padding: clamp(1rem, 4vw, 3rem); border-radius: .65rem; border: 1px solid var(--border); background: #f5f4ee; color: #142d3b; overflow-wrap: anywhere; }
  .slide.hero { background: #142d3b; color: #edf5eb; }
  .slide h3 { margin: 0; font-size: clamp(1.15rem, 4vw, 2rem); }
  .slide li { margin-block: .4rem; }
  details p { white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 560px) {
    .preview-dialog { width: 100%; height: 100dvh; border-radius: 0; }
    header { padding-top: calc(.75rem + env(safe-area-inset-top)); }
    footer { padding-bottom: calc(.75rem + env(safe-area-inset-bottom)); }
  }
</style>
