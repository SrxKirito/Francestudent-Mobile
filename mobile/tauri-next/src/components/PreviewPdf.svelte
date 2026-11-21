<script lang="ts">
  import type { PdfDocument } from "../lib/services/document-assets.ts";
  let { pdf }: { pdf: PdfDocument } = $props();
  let index = $state(1);
  let canvas: HTMLCanvasElement | undefined = $state();
  let error = $state("");
  let loading = $state(true);

  $effect(() => {
    const documentPdf = pdf;
    const number = index;
    const target = canvas;
    if (!target) return;
    let disposed = false;
    let cancel: (() => void) | undefined;
    loading = true;
    error = "";

    async function paint() {
      try {
        const page = await documentPdf.getPage(number);
        try {
          if (disposed) return;
          const base = page.getViewport({ scale: 1 });
          if (Math.min(base.width, base.height) <= 0 || !Number.isFinite(base.width * base.height)) throw new Error();
          const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const scratch = document.createElement("canvas");
          scratch.width = Math.max(1, Math.ceil(viewport.width));
          scratch.height = Math.max(1, Math.ceil(viewport.height));
          const context = scratch.getContext("2d");
          if (!context) throw new Error();
          const task = page.render({ canvasContext: context, viewport });
          cancel = () => task.cancel();
          await task.promise;
          if (!disposed && target) {
            target.width = scratch.width;
            target.height = scratch.height;
            target.getContext("2d")?.drawImage(scratch, 0, 0);
          }
        } finally {
          page.cleanup();
        }
      } catch {
        if (!disposed) error = "Cette page ne peut pas être affichée.";
      } finally {
        if (!disposed) loading = false;
      }
    }

    void paint();
    return () => { disposed = true; cancel?.(); };
  });

  function change(offset: number) {
    index = Math.max(1, Math.min(index + offset, pdf.numPages));
  }
</script>

<div class="pdf-controls">
  <button type="button" class="settings-btn" onclick={() => change(-1)} disabled={index <= 1} aria-label="Page précédente">‹</button>
  <span role="status">Page {index} sur {pdf.numPages}</span>
  <button type="button" class="settings-btn" onclick={() => change(1)} disabled={index >= pdf.numPages} aria-label="Page suivante">›</button>
</div>
{#if loading}<p role="status">Chargement de la page…</p>{/if}
{#if error}<p role="alert">{error}</p>{/if}
<canvas hidden={loading || Boolean(error)} bind:this={canvas}>Page {index} du PDF</canvas>

<style>
  .pdf-controls { position: sticky; top: 0; display: flex; gap: .8rem; justify-content: center; align-items: center; padding-block: .5rem; background: var(--surface); }
  canvas { display: block; max-width: 100%; height: auto; margin: 0 auto; background: white; }
  canvas[hidden] { display: none; }
</style>
