import { API_URL } from "../config.ts";

// Contenu des fichiers France Student via le transport Rust. Les réponses Files V2 sont
// binaires ou enveloppées dans une chaîne JSON base64 suivant le serveur.
export type NativeFileRequest = (path: string, options?: {
  method?: string;
  accept?: string;
  body?: unknown;
  signal?: AbortSignal;
}) => Promise<Response>;

export interface FileReadOptions {
  kind?: "file" | "legacy";
  signal?: AbortSignal;
  limit?: number;
  truncate?: boolean;
}

export interface NativeFiles {
  response(id: string, signal?: AbortSignal): Promise<Response>;
  content(id: string, options?: FileReadOptions): Promise<Blob>;
  image(input: unknown, signal?: AbortSignal, limit?: number): Promise<Blob>;
}

export const PREVIEW_MAX_BYTES = 6 * 1024 * 1024;

function tooLarge(): Error {
  const error = new Error("Fichier trop volumineux pour l’aperçu. Enregistre-le pour l’ouvrir.");
  return Object.assign(error, { code: "too-large" });
}

function ensureActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Lecture annulée.", "AbortError");
}

function cancelResponse(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

function fileSegment(id: string): string {
  if (!id || id === "." || id === ".." || /[\\/\p{Cc}]/u.test(id)) throw new Error("Identifiant de fichier invalide.");
  return encodeURIComponent(id);
}

async function successful(response: Response): Promise<Response> {
  if (response.ok) return response;
  cancelResponse(response);
  throw new Error("Fichier indisponible (HTTP " + response.status + ").");
}

/** Décode une chaîne JSON base64 par blocs et laisse la consommation du flux à l’appelant. */
function decodeFileResponse(response: Response): Response {
  if (!/\bapplication\/json\b/i.test(response.headers.get("Content-Type") ?? "")) return response;
  if (!response.body) throw new Error("Contenu du fichier absent.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let quoteOpened = false;
  let quoteClosed = false;
  let escaped = false;
  let padded = false;
  let tail = "";
  const invalid = () => new Error("Le contenu encodé du fichier est invalide.");
  const base64 = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, stream) {
      const text = decoder.decode(chunk, { stream: true });
      let block = tail;
      for (const char of text) {
        if (!quoteOpened) {
          if (/^[ \t\r\n]$/.test(char)) continue;
          if (char !== '"') throw invalid();
          quoteOpened = true;
          continue;
        }
        if (quoteClosed) {
          if (!/^[ \t\r\n]$/.test(char)) throw invalid();
          continue;
        }
        if (escaped) {
          if (char !== "/") throw invalid();
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
          continue;
        } else if (char === '"') {
          quoteClosed = true;
          continue;
        }
        if (padded || !/^[a-z0-9+/=]$/i.test(char)) throw invalid();
        block += char;
      }
      const size = block.length - block.length % 4;
      tail = block.slice(size);
      if (size) {
        const complete = block.slice(0, size);
        // Un remplissage base64 n’est valide qu’à la fin du dernier groupe.
        const padding = complete.indexOf("=");
        if (padding >= 0 && (tail || padding < complete.length - 2 || /[^=]/.test(complete.slice(padding)))) throw invalid();
        padded ||= padding >= 0;
        const decoded = atob(complete);
        stream.enqueue(Uint8Array.from(decoded, char => char.charCodeAt(0)));
      }
      if (quoteClosed && tail) throw invalid();
    },
    flush() {
      if (decoder.decode() || !quoteClosed || escaped || tail) throw invalid();
    }
  });
  return new Response(response.body.pipeThrough(base64), { headers: { "Content-Type": "application/octet-stream" } });
}

async function readBounded(response: Response, limit: number, truncate = false, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) {
    cancelResponse(response);
    ensureActive(signal);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Contenu du fichier absent.");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const parts: ArrayBuffer[] = [];
  let total = 0;
  try {
    for (;;) {
      ensureActive(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      if (value.byteLength > remaining && !truncate) throw tooLarge();
      const part = value.subarray(0, remaining);
      if (part.byteLength > 0) {
        const copy = new Uint8Array(part.byteLength);
        copy.set(part);
        parts.push(copy.buffer);
        total += part.byteLength;
      }
      if (truncate && total >= limit) break;
    }
    ensureActive(signal);
    const type = response.headers.get("Content-Type")?.split(";")[0].trim();
    return new Blob(parts, { type: type || "application/octet-stream" });
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function decodeBytes(data: string, type: string, limit: number, truncate = false): Blob {
  const decodedLength = Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (decodedLength > limit && !truncate) throw tooLarge();
  const encoded = truncate ? data.slice(0, Math.ceil(limit / 3) * 4) : data;
  const binary = atob(encoded);
  return new Blob([Uint8Array.from(binary.slice(0, limit), char => char.charCodeAt(0))], { type });
}

/** Relit un fichier embarqué dans les anciennes pièces jointes sans charger une URL distante. */
export function inlineFileContent(source: string, limit: number, truncate = false): Blob | undefined {
  const parts = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(source);
  return parts ? decodeBytes(parts[2], parts[1], limit, truncate) : undefined;
}

export function createNativeFiles(request: NativeFileRequest): NativeFiles {
  async function response(id: string, signal?: AbortSignal): Promise<Response> {
    ensureActive(signal);
    const result = await successful(await request("/filesv2/" + fileSegment(id) + "/content", { accept: "*/*", signal }));
    if (signal?.aborted) cancelResponse(result);
    ensureActive(signal);
    return decodeFileResponse(result);
  }

  async function content(id: string, { kind, limit = PREVIEW_MAX_BYTES, truncate, signal }: FileReadOptions = {}): Promise<Blob> {
    ensureActive(signal);
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Limite de lecture invalide.");
    if (kind !== "legacy") return readBounded(await response(id, signal), limit, truncate, signal);
    const metadata = await successful(await request("/files/" + fileSegment(id), { signal }));
    const envelope = await readBounded(metadata, Math.ceil(limit * 4 / 3) + 4096, false, signal);
    const file: { base64Data?: unknown; contentType?: unknown } | null = JSON.parse(await envelope.text());
    ensureActive(signal);
    if (typeof file?.base64Data !== "string") throw new Error("Contenu du fichier historique non reconnu.");
    return decodeBytes(file.base64Data, typeof file.contentType === "string" ? file.contentType : "application/octet-stream", limit, truncate);
  }

  async function image(input: unknown, signal?: AbortSignal, limit = PREVIEW_MAX_BYTES): Promise<Blob> {
    ensureActive(signal);
    if (!input || typeof input !== "object") throw new Error("Image indisponible.");
    const row = input as Record<string, unknown>;
    const url = typeof row.data === "string" ? row.data : typeof row.url === "string" ? row.url : "";
    const inline = /^data:image\//i.test(url) ? inlineFileContent(url, limit) : undefined;
    if (inline) return inline;
    let result: Response;
    const imageRoute = /^\/chats\/([^/?#]+)\/messages\/([^/?#]+)\/images\/([^/?#]+)$/;
    const parts = [row.chatId, row.messageId, row.id];
    const absolute = /^https:\/\//i.test(url) ? new URL(url) : undefined;
    const sameService = absolute?.origin === API_URL;
    const route = imageRoute.exec(sameService && absolute ? absolute.pathname : url);
    if (route) {
      const [chatId, messageId, imageId] = route.slice(1).map(segment => fileSegment(decodeURIComponent(segment)));
      result = await request("/chats/" + chatId + "/messages/" + messageId + "/images/" + imageId, { accept: "image/*", signal });
    } else if (parts.every((part): part is string => typeof part === "string" && Boolean(part))) {
      const [chatId, messageId, id] = parts.map(fileSegment);
      result = await request("/chats/" + chatId + "/messages/" + messageId + "/images/" + id, { accept: "image/*", signal });
    } else if (absolute && !absolute.username && !absolute.password) {
      result = await fetch(absolute.href, { credentials: "omit", referrerPolicy: "no-referrer", signal });
    } else throw new Error("Image indisponible.");
    const blob = await readBounded(await successful(result), limit, false, signal);
    if (!blob.type.startsWith("image/")) throw new Error("Le serveur n’a pas renvoyé une image.");
    return blob;
  }

  return { response, content, image };
}
