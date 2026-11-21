import { encodePdf, encodePresentation, loadPresentation, MAX_PREVIEW_BYTES } from "./document-assets.ts";
import type { Presentation } from "./document-assets.ts";
import { FILE_MIME, fileNameFromCode, guessFileName, parseMarkdownBlocks } from "./markdown.ts";
import { parseStudyContent } from "./study-content.ts";

export interface PreviewFile {
  name: string;
  load: (signal?: AbortSignal) => Promise<Blob>;
  /** Téléchargement en flux ou enregistrement d'une copie sans charger l'aperçu. */
  save?: () => Promise<unknown>;
  presentation?: () => Promise<Presentation>;
}

export interface GeneratedArtifact {
  name: string;
  code: string;
  lang: string;
  fenceIndex: number;
}

export function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 150) || "fichier";
}

function powerPointName(code: string): string {
  let hint = "";
  if (code.length <= 200_000) {
    try {
      const payload = JSON.parse(code) as { filename?: unknown; title?: unknown } | null;
      hint = typeof payload?.filename === "string" ? payload.filename :
        typeof payload?.title === "string" ? payload.title : "";
    } catch {
      // La grille peut proposer le téléchargement même si la conversion devra expliquer l'erreur.
    }
  }
  const clean = safeFileName(hint.replace(/\.pptx$/i, "").slice(0, 100) || "presentation");
  return clean + ".pptx";
}

export function generatedArtifacts(source: string): GeneratedArtifact[] {
  return parseMarkdownBlocks(source).flatMap(block => {
    if (block.type !== "code" || block.open || parseStudyContent(block.language, block.content)) return [];
    const name = fileNameFromCode(block.content, block.language, powerPointName) || guessFileName(block.content, block.language);
    return [{ name, code: block.content, lang: block.language, fenceIndex: block.index }];
  });
}

export function generatedFile(name: string, code: string): PreviewFile {
  const filename = safeFileName(name);
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  const mime = Object.hasOwn(FILE_MIME, extension) ? FILE_MIME[extension] : "text/plain";
  return {
    name: filename,
    async load(signal) {
      signal?.throwIfAborted();
      const bytes = extension === "pptx" ? await encodePresentation(code) :
        extension === "pdf" ? await encodePdf(code) : new TextEncoder().encode(code);
      signal?.throwIfAborted();
      const content = new Blob([Uint8Array.from(bytes)], { type: mime });
      return content;
    },
    presentation: extension === "pptx" ? () => loadPresentation(code) : undefined
  };
}

/** Charge une source déjà affichable dans le chat sans activer le contenu du fichier. */
export function generatedImageFile(src: string): PreviewFile {
  const jpg = /^data:image\/jpeg[;,]/i.test(src);
  const webp = /^data:image\/webp[;,]/i.test(src);
  return {
    name: "image-france-student." + (jpg ? "jpg" : webp ? "webp" : "png"),
    async load(signal) {
      const inline = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([\s\S]+)$/i.exec(src);
      signal?.throwIfAborted();
      if (inline) {
        if (inline[2].length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4) throw new Error("Cette image est trop volumineuse pour l’aperçu.");
        const binary = atob(inline[2]);
        if (binary.length > MAX_PREVIEW_BYTES) throw new Error("Cette image est trop volumineuse pour l’aperçu.");
        return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: inline[1] });
      }
      if (!/^(?:blob:|https:\/\/)/i.test(src)) throw new Error("Cette source d’image est indisponible.");
      const response = await fetch(src, { credentials: "omit", referrerPolicy: "no-referrer", signal });
      if (!response.ok || !response.body) throw new Error("Image indisponible.");
      const reader = response.body.getReader();
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_PREVIEW_BYTES) throw new Error("Cette image est trop volumineuse pour l’aperçu.");
          parts.push(Uint8Array.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return new Blob(parts, { type: response.headers.get("content-type") ?? "application/octet-stream" });
    }
  };
}
