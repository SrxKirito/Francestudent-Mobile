import type { ComposerAttachment } from "../types/chat.ts";
import type { TokenProvider } from "./auth.ts";
import type { NativeAttachment } from "./native-chat-types.ts";
import type { NativeFiles } from "./native-files.ts";
import type { PreviewStorage } from "./preview-storage.ts";
import { uploadFile } from "./transport.ts";
import { extractDocumentText } from "./document-assets.ts";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;
const MAX_CONVERSION_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;
const CONCURRENT = 2;
const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|log|json|js|mjs|cjs|ts|tsx|jsx|py|html?|css|xml|sql|ya?ml|toml|sh|rs|c|cpp|h|go|java|rb|php|svelte|svg)$/i;
const MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
  json: "application/json", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", heic: "image/heic", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

interface Entry {
  file: File;
  value: NativeAttachment;
  state?: ComposerAttachment["upload"];
  progress?: number;
  preview?: string;
  controller?: AbortController;
}

function typedFile(file: File): File {
  if (file.type) return file;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME_BY_EXTENSION[extension] || (TEXT_EXTENSIONS.test(file.name) ? "text/plain" : "application/octet-stream");
  return new File([file], file.name || "Fichier", { type, lastModified: file.lastModified });
}

export function createNativeAttachments(options: {
  tokens: TokenProvider;
  files: NativeFiles;
  previewStorage: PreviewStorage;
  noteUploaded?(response: unknown): void;
  changed(): void;
  toast(message: string, error: boolean): void;
}) {
  const entries = new Map<string, Entry>();
  let uploading = 0;

  async function convert(entry: Entry, signal: AbortSignal): Promise<string | undefined> {
    if (entry.file.size > MAX_CONVERSION_BYTES) return undefined;
    let value: string;
    if (TEXT_EXTENSIONS.test(entry.file.name) || entry.file.type.startsWith("text/")) {
      value = await entry.file.slice(0, MAX_TEXT_CHARS * 4).text();
    } else {
      const result = await extractDocumentText(entry.file, entry.file.name, signal);
      value = result?.text ?? "";
    }
    signal.throwIfAborted();
    if (!value.trim() || value.includes("\0")) return undefined;
    return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) + "\n[Texte tronqué]" : value;
  }

  async function run(entry: Entry) {
    const controller = new AbortController();
    entry.controller = controller;
    entry.state = "uploading";
    entry.progress = 0;
    options.changed();
    const signal = controller.signal;
    let progressAt = 0;
    try {
      const upload = async (force: boolean) => {
        const token = await options.tokens.getAccessToken(force);
        signal.throwIfAborted();
        return uploadFile(entry.file, token, signal, (sent, total) => {
          if (signal.aborted) return;
          entry.progress = total > 0 ? sent / total : 0;
          if (sent === total || Date.now() - progressAt >= 100) {
            progressAt = Date.now();
            options.changed();
          }
        });
      };
      let result: unknown;
      let extracted: string | undefined;
      try { result = await upload(false); }
      catch (error) {
        signal.throwIfAborted();
        if (/\bHTTP 401\b/.test(String(error))) {
          options.tokens.invalidate();
          result = await upload(true);
        } else if (/type de fichier.+pas accepté|\bHTTP 415\b/i.test(String(error))) {
          extracted = await convert(entry, signal);
          if (extracted === undefined) throw error;
        } else throw error;
      }
      signal.throwIfAborted();
      if (extracted !== undefined) {
        entry.value.kind = "text";
        entry.value.data = extracted;
      } else {
        const id = (result as { id?: unknown } | null)?.id;
        if (typeof id !== "string" || !id) throw new Error("Identifiant de fichier absent dans la réponse du serveur.");
        entry.value.remoteId = id;
        entry.value.remoteKind = "file";
        options.noteUploaded?.(result);
      }
      if (entry.file.size <= MAX_PREVIEW_BYTES) {
        const previewId = await options.previewStorage.remember(entry.file).catch(() => null);
        if (previewId) entry.value.previewId = previewId;
      }
      signal.throwIfAborted();
      entry.state = undefined;
    } catch (error) {
      if (!signal.aborted) {
        entry.state = "error";
        options.toast("Envoi de « " + entry.value.name + " » : " + (error instanceof Error ? error.message : String(error)), true);
      }
    } finally {
      uploading--;
      options.changed();
      schedule();
    }
  }

  function schedule() {
    for (const entry of entries.values()) {
      if (uploading >= CONCURRENT) break;
      if (entry.state !== "queued") continue;
      uploading++;
      void run(entry);
    }
  }

  function remove(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.controller?.abort();
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    options.changed();
  }

  function snapshot(): ComposerAttachment[] {
    return [...entries.values()].map(entry => ({
      id: entry.value.id, name: entry.value.name, kind: entry.value.kind, upload: entry.state, progress: entry.progress
    }));
  }

  function clear() {
    const previous = [...entries.values()];
    entries.clear();
    for (const entry of previous) {
      entry.controller?.abort();
      if (entry.preview) URL.revokeObjectURL(entry.preview);
    }
    options.changed();
  }

  async function load(value: NativeAttachment, signal?: AbortSignal): Promise<Blob> {
    signal?.throwIfAborted();
    const pending = entries.get(value.id);
    if (pending) {
      if (pending.file.size > MAX_PREVIEW_BYTES) throw new Error("Fichier trop volumineux pour l’aperçu. Utilise Télécharger dans les fichiers enregistrés.");
      return pending.file;
    }
    if (value.previewId) {
      const stored = await options.previewStorage.readPreview(value.previewId);
      if (stored?.blob && stored.blob.size <= MAX_PREVIEW_BYTES) return stored.blob;
    }
    if (value.data && value.kind === "text") return new Blob([value.data], { type: "text/plain" });
    if (value.data && value.kind === "image" && /^data:image\//i.test(value.data)) return options.files.image({ data: value.data }, signal);
    if (!value.remoteId) throw new Error("Contenu du fichier indisponible.");
    if (value.size !== undefined && value.size > MAX_PREVIEW_BYTES) throw new Error("Fichier trop volumineux pour l’aperçu. Utilise Télécharger dans les fichiers enregistrés.");
    const blob = await options.files.content(value.remoteId, { kind: value.remoteKind === "file" ? "file" : "legacy", signal, limit: MAX_PREVIEW_BYTES });
    return value.mime && (blob.type === "" || blob.type === "application/octet-stream") ? new Blob([blob], { type: value.mime }) : blob;
  }

  return {
    snapshot,
    add(files: ArrayLike<File>) {
      for (const input of Array.from(files)) {
        if (input.size > MAX_FILE_BYTES) {
          options.toast((input.name || "Fichier") + " dépasse 50 Mo.", true);
          continue;
        }
        const file = typedFile(input);
        const id = crypto.randomUUID();
        const kind = file.type.startsWith("image/") ? "image" : "file";
        entries.set(id, {
          value: { id, kind, name: file.name || "Fichier", mime: file.type, size: file.size },
          file,
          state: "queued",
          preview: kind === "image" ? URL.createObjectURL(file) : undefined
        });
      }
      schedule();
      options.changed();
    },
    remove,
    retry(id: string) {
      const entry = entries.get(id);
      if (entry?.state !== "error") return;
      entry.state = "queued";
      schedule();
      options.changed();
    },
    load,
    lookup(id: string) { return entries.get(id)?.value; },
    picture(id: string) { return entries.get(id)?.preview ?? ""; },
    ready() { return [...entries.values()].every(entry => entry.state === undefined); },
    take() {
      const values = [...entries.values()].map(entry => ({ ...entry.value }));
      clear();
      return values;
    },
    clear
  };
}
