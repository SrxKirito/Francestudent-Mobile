const base = "/document-assets/";
const scripts = new Map<string, Promise<void>>();

function script(file: string): Promise<void> {
  const pending = scripts.get(file);
  if (pending) return pending;
  const loading = new Promise<void>((resolve, reject) => {
    const node = document.createElement("script");
    node.src = base + file;
    node.onload = () => resolve();
    node.onerror = () => {
      node.remove();
      reject(new Error("Le lecteur de documents est indisponible."));
    };
    document.head.append(node);
  });
  scripts.set(file, loading);
  void loading.catch(() => scripts.delete(file));
  return loading;
}

export interface Presentation {
  title: string;
  subtitle: string;
  slides: { title: string; bullets: string[]; notes: string; layout: string; illustration: string }[];
}

interface Formats {
  makePdf(text: string): Uint8Array;
  makePowerPoint(code: string): Promise<Uint8Array>;
  parsePowerPoint(code: string): Presentation;
  powerPointPages(presentation: Presentation): Presentation["slides"];
}

async function formats(): Promise<Formats> {
  const moduleUrl = base + "formats.mjs";
  return await import(/* @vite-ignore */ moduleUrl) as Formats;
}

export async function loadPresentation(code: string): Promise<Presentation> {
  const library = await formats();
  const presentation = library.parsePowerPoint(code);
  return { ...presentation, slides: library.powerPointPages(presentation) };
}

export async function encodePresentation(code: string): Promise<Uint8Array> {
  const [library] = await Promise.all([formats(), script("pptxgen.bundle.js"), script("powerpoint-visuals.js")]);
  return library.makePowerPoint(code);
}

export async function encodePdf(text: string): Promise<Uint8Array> {
  return (await formats()).makePdf(text);
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<{ items: { str?: unknown; hasEOL?: boolean }[] }>;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
    cancel(): void;
    promise: Promise<void>;
  };
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: {
    data: Uint8Array;
    isEvalSupported: false;
    enableXfa: false;
    maxImageSize: number;
  }): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
}

type ExtractedText = { text: string; format: string };
type FileConvert = {
  extractText(buffer: ArrayBuffer, name: string, mime: string): Promise<ExtractedText | null>;
  wordXml(buffer: ArrayBuffer): Promise<string | null>;
};
type DocumentGlobals = Window & { pdfjsLib?: PdfJs; FileConvert?: FileConvert };
const MAX_TEXT = 250_000;
const MAX_PDF_TEXT_PAGES = 120;
export const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;

export async function openPdf(blob: Blob, signal?: AbortSignal): Promise<PdfDocument> {
  if (blob.size > MAX_PREVIEW_BYTES) throw new Error("Ce PDF est trop volumineux pour l’aperçu.");
  await script("pdf.min.js");
  signal?.throwIfAborted();
  const lib = (window as DocumentGlobals).pdfjsLib;
  if (!lib) throw new Error("Le lecteur PDF est indisponible.");
  lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
  const data = new Uint8Array(await blob.arrayBuffer());
  signal?.throwIfAborted();
  const task = lib.getDocument({ data, maxImageSize: 16_000_000, isEvalSupported: false, enableXfa: false });
  const cancel = () => { void task.destroy().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await task.promise;
  } catch (error) {
    if (!signal?.aborted) cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

async function extractPdfText(blob: Blob, signal?: AbortSignal): Promise<ExtractedText | null> {
  const pdf = await openPdf(blob, signal);
  try {
    const pages: string[] = [];
    let used = 0;
    for (let number = 1; number <= pdf.numPages && number <= MAX_PDF_TEXT_PAGES && used < MAX_TEXT; number++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(number);
      try {
        const { items } = await page.getTextContent();
        const value = items.map(item => typeof item.str === "string" ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        if (!value) continue;
        const section = "— Page " + number + " —\n" + value.slice(0, MAX_TEXT - used);
        pages.push(section);
        used += section.length;
      } finally {
        page.cleanup();
      }
    }
    if (!pages.length) return null;
    const clipped = pdf.numPages > MAX_PDF_TEXT_PAGES || used >= MAX_TEXT;
    return { format: "PDF", text: pages.join("\n\n") + (clipped ? "\n\n[Extrait limité]" : "") };
  } finally {
    await pdf.destroy();
  }
}

export async function readWordDocument(blob: Blob, signal?: AbortSignal): Promise<string | null> {
  if (blob.size > MAX_PREVIEW_BYTES) return null;
  await script("fileconvert.js");
  signal?.throwIfAborted();
  const library = (window as DocumentGlobals).FileConvert;
  if (!library) return null;
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  return library.wordXml(bytes);
}

export async function extractDocumentText(blob: Blob, name: string, signal?: AbortSignal): Promise<ExtractedText | null> {
  signal?.throwIfAborted();
  if (blob.size > MAX_PREVIEW_BYTES) return null;
  if (blob.type === "application/pdf" || /\.pdf$/i.test(name)) return extractPdfText(blob, signal);
  await script("fileconvert.js");
  signal?.throwIfAborted();
  const lib = (window as DocumentGlobals).FileConvert;
  if (!lib) return null;
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  const result = await lib.extractText(bytes, name, blob.type);
  signal?.throwIfAborted();
  return result;
}
