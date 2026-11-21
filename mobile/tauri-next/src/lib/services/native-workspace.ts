import "../../../files-store.js";
import "../../../file-thumbnails.js";
import type { ApiClient } from "./api-client.ts";
import { extractDocumentText, openPdf } from "./document-assets.ts";
import { generatedArtifacts, generatedFile } from "./file-preview.ts";
import type { PreviewFile } from "./file-preview.ts";
import { saveStream } from "./file-saver.ts";
import type { LocalSettingsGateway } from "./local-settings.ts";
import { FILE_MIME } from "./markdown.ts";
import type { NativeConversation, NativeConversations } from "./native-conversations.ts";
import { inlineFileContent, PREVIEW_MAX_BYTES } from "./native-files.ts";
import type { NativeFiles } from "./native-files.ts";
import type { LibraryEntry, PreviewStorage, StoredAttachment } from "./preview-storage.ts";
import type { FileThumbnail, FileUsage, LibraryRecord, RemoteFile, WorkspaceEngine } from "./workspace-engine.ts";

const LOCAL_IMAGE_LIMIT = 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const REMOTE_PREVIEW_LIMIT = 10 * 1024 * 1024;
const TEXT_SNIPPET_LIMIT = 1800;
const RASTER = /^image\/(?:png|jpeg|webp|gif|avif)$/i;
const TEXT_SUFFIX = /\.(?:txt|md|markdown|csv|tsv|log|json|js|ts|py)$/i;
const NON_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FILE_TYPE: Record<string, string> = {
  ...FILE_MIME,
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", heic: "image/heic", heif: "image/heif",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

interface RemoteCache {
  files(): RemoteFile[];
  get(id: string): RemoteFile | null;
  hasMore(): boolean;
  fetchUsage(options: { force: boolean }): Promise<FileUsage>;
  reload(): Promise<unknown>;
  ensureLoaded(): Promise<unknown>;
  loadMore(): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  noteUploaded(file: unknown): boolean;
  invalidate(): void;
  reset(): void;
  subscribe(callback: () => void): () => void;
  watchForeground(doc: Document): () => void;
}

interface RemoteCacheFactory {
  create(deps: { api: (path: string, options?: { method?: string }) => Promise<unknown>; getSession: () => string }): RemoteCache;
  fileKind(name: string): string;
  arrange(rows: RemoteFile[], options: { query: string; kind: string; sort: string }): RemoteFile[];
}

interface ThumbnailFactory {
  create(deps: {
    fetchBlob: (file: RemoteFile, options: { signal: AbortSignal; limit: number; truncate: boolean }) => Promise<Blob>;
    createUrl: (blob: Blob, mime: string) => string | Promise<string>;
    documentPreview: (blob: Blob, name: string, signal: AbortSignal) => Promise<string | { url: string } | null>;
    imageMaxBytes?: number;
    revokeUrl: (url: string) => void;
  }): {
    request(file: RemoteFile, options: { signal: AbortSignal }): Promise<FileThumbnail>;
    clear(): void;
  };
}

export interface NativeWorkspaceOptions {
  api: ApiClient;
  repository: NativeConversations;
  local: LocalSettingsGateway;
  files: NativeFiles;
  previewStorage: PreviewStorage;
  deviceOwner?: string;
  openPreview(file: PreviewFile): void;
  resume(id: string): Promise<void>;
  cancelPending(id: string): Promise<void>;
  busy(): boolean;
  openChat(id: string): void | Promise<void>;
}

export interface NativeWorkspaceEngine extends WorkspaceEngine {
  noteUploaded(file: unknown): void;
  dispose(): void;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function visible(conversation: NativeConversation): boolean {
  return !conversation.serverArchived && !conversation.serverLocked;
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Lecture annulée.", "AbortError");
}

function tooLarge(): Error {
  return new Error("Fichier trop volumineux pour l’aperçu. Enregistre-le pour l’ouvrir.");
}

function typed(blob: Blob, name: string, mime?: string): Blob {
  if (blob.type && blob.type !== "application/octet-stream") return blob;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const type = mime || (Object.hasOwn(FILE_TYPE, extension) ? FILE_TYPE[extension] : "");
  return type ? blob.slice(0, blob.size, type) : blob;
}

function icon(): FileThumbnail {
  return { type: "icon", release() {} };
}

function textThumbnail(text: string): FileThumbnail {
  const snippet = text.slice(0, TEXT_SNIPPET_LIMIT).trimEnd();
  return !snippet || NON_TEXT.test(snippet) ? icon() : { type: "text", text: snippet, release() {} };
}

function libraryRecords(owner: string, conversations: readonly NativeConversation[], fileKind: (name: string) => string): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const conversation of conversations) {
    if (!visible(conversation)) continue;
    for (const [messageIndex, message] of (conversation.messages ?? []).entries()) {
      const common = {
        owner, conversationId: conversation.id, projectId: conversation.projectId ?? "",
        created: conversation.updatedAt ?? Date.now()
      };
      if (Array.isArray(message.attachments)) {
        for (const [index, item] of message.attachments.entries()) {
          if (!record(item)) continue;
          const file = item as StoredAttachment;
          const name = typeof file.name === "string" && file.name ? file.name : "Fichier";
          entries.push({
            ...common, id: owner + ":sent:" + conversation.id + ":" + messageIndex + ":" + index,
            direction: "sent", kind: file.kind === "image" ? "image" : fileKind(name),
            name, previewId: file.previewId ?? null, file
          });
        }
      }
      if (message.role !== "assistant") continue;
      for (const file of generatedArtifacts(message.content)) {
        entries.push({
          ...common, id: owner + ":generated:" + conversation.id + ":" + messageIndex + ":" + file.fenceIndex,
          direction: "generated", kind: fileKind(file.name), name: file.name, code: file.code, lang: file.lang
        });
      }
      for (const [index, image] of (message.images ?? []).entries()) {
        entries.push({
          ...common, id: owner + ":image:" + conversation.id + ":" + messageIndex + ":" + index,
          direction: "generated", kind: "image",
          name: "Image " + (messageIndex + 1) + "-" + (index + 1) + ".png", image
        });
      }
    }
  }
  return entries;
}

async function coverCanvasUrl(canvas: HTMLCanvasElement): Promise<string> {
  const preview = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!preview) throw new Error("Miniature indisponible.");
  return URL.createObjectURL(preview);
}

async function sniffPreviewType(blob: Blob, name: string): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  const mime = ascii.startsWith("%PDF-") ? "application/pdf"
    : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? "image/jpeg"
    : ascii.startsWith("\x89PNG\r\n\x1a\n") ? "image/png"
    : ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a") ? "image/gif"
    : ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP" ? "image/webp" : "";
  return mime && blob.type !== mime ? blob.slice(0, blob.size, mime) : typed(blob, name);
}

async function thumbnailUrl(blob: Blob, mime: string): Promise<string> {
  const typed = blob.type === mime ? blob : blob.slice(0, blob.size, mime);
  const source = URL.createObjectURL(typed);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image illisible."));
      image.src = source;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Image trop grande.");
    const scale = Math.min(1, 300 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Miniature indisponible.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return coverCanvasUrl(canvas);
  } finally { URL.revokeObjectURL(source); }
}

async function documentThumbnail(input: Blob, name: string, signal: AbortSignal): Promise<string | { url: string } | null> {
  const blob = await sniffPreviewType(input, name);
  signal.throwIfAborted();
  if (/^image\/(?:jpeg|png|gif|webp|avif|bmp|heic|heif)$/.test(blob.type)) {
    return { url: await thumbnailUrl(blob, blob.type) };
  }
  if (blob.type === "application/pdf" || /\.pdf$/i.test(name)) {
    const pdf = await openPdf(blob, signal);
    try {
      const page = await pdf.getPage(1);
      try {
        signal.throwIfAborted();
        const base = page.getViewport({ scale: 1 });
        if (Math.min(base.width, base.height) <= 0 || !Number.isFinite(base.width * base.height)) return null;
        const viewport = page.getViewport({ scale: 300 / Math.max(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) return null;
        const task = page.render({ canvasContext: context, viewport });
        const cancel = () => task.cancel();
        signal.addEventListener("abort", cancel, { once: true });
        try { await task.promise; }
        finally { signal.removeEventListener("abort", cancel); }
        signal.throwIfAborted();
        return { url: await coverCanvasUrl(canvas) };
      } finally { page.cleanup(); }
    } finally { await pdf.destroy().catch(() => {}); }
  }
  if (/\.(docx|xlsx|pptx)$/i.test(name)) {
    return (await extractDocumentText(blob, name, signal))?.text.slice(0, 600) ?? null;
  }
  const bytes = await blob.slice(0, TEXT_SNIPPET_LIMIT).arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: blob.size > bytes.byteLength }); }
  catch { return null; }
}

function publicEntry({ id, name, kind, direction, created, projectId, conversationId, attribution }: LibraryEntry): LibraryRecord {
  return { id, name, kind, direction, created, projectId, conversationId, attribution };
}

export function createNativeWorkspaceEngine(options: NativeWorkspaceOptions): NativeWorkspaceEngine {
  const { api, repository, local, files, previewStorage } = options;
  const bundles = globalThis as typeof globalThis & { tauriFilesStore: RemoteCacheFactory; tauriFileThumbnails: ThumbnailFactory };
  const { fileKind, arrange } = bundles.tauriFilesStore;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const remote = bundles.tauriFilesStore.create({
    getSession: () => signal.aborted ? "" : repository.owner(),
    api: (path, call) => api.json(path, { ...call, signal })
  });
  const unwatchForeground = typeof document === "undefined" ? () => {} : remote.watchForeground(document);
  const thumbnails = bundles.tauriFileThumbnails.create({
    fetchBlob: (file, settings) => files.content(file.id, settings),
    imageMaxBytes: REMOTE_PREVIEW_LIMIT,
    createUrl: async (blob, mime) => {
      const input = await sniffPreviewType(blob, "preview");
      return thumbnailUrl(input, RASTER.test(input.type) ? input.type : mime);
    },
    documentPreview: documentThumbnail,
    revokeUrl: url => URL.revokeObjectURL(url)
  });
  let thumbnailOwner = repository.owner();
  const unwatchReset = remote.subscribe(eventListener);

  function eventListener() {
    const owner = repository.owner();
    if (owner === thumbnailOwner && !signal.aborted) return;
    thumbnailOwner = owner;
    thumbnails.clear();
  }

  function ready(): boolean {
    return !signal.aborted && Boolean(repository.owner()) && !options.busy();
  }

  function requireReady() {
    if (!ready()) throw new Error("Attends la fin de la réponse en cours.");
  }

  function remoteFile(id: string): RemoteFile {
    checkSignal(signal);
    const row = remote.get(id);
    if (!row) throw new Error("Fichier indisponible.");
    return row;
  }

  function canReadLocal(row: LibraryEntry, owner: string): boolean {
    // Les pièces des discussions protégées/conservées en archives ne sont pas exposées dans cette liste.
    const conversation = repository.all().find(item => item.id === row.conversationId);
    if (conversation && !visible(conversation)) return false;
    if (row.owner === owner) return true;
    return row.owner === options.deviceOwner && Boolean(conversation);
  }

  async function localEntry(id: string): Promise<LibraryEntry> {
    checkSignal(signal);
    const owner = repository.owner();
    if (!owner) throw new Error("Fichier local indisponible.");
    let row = await previewStorage.libraryEntry(id, owner);
    if (!row && options.deviceOwner && options.deviceOwner !== owner) row = await previewStorage.libraryEntry(id, options.deviceOwner);
    checkSignal(signal);
    if (owner !== repository.owner() || !row || !canReadLocal(row, owner)) throw new Error("Fichier local indisponible.");
    return row;
  }

  async function readAttachment(row: LibraryEntry, limit: number, signal: AbortSignal, truncate = false): Promise<Blob> {
    checkSignal(signal);
    const file = row.file;
    if (row.previewId) {
      const cached = await previewStorage.readPreview(row.previewId).catch(() => undefined);
      checkSignal(signal);
      if (cached) {
        if (!truncate && cached.blob.size > limit) throw tooLarge();
        return typed(truncate ? cached.blob.slice(0, limit, cached.blob.type) : cached.blob, row.name, file?.mime);
      }
    }
    if (row.image) return files.image(row.image, signal, limit);
    const remoteId = typeof file?.remoteId === "string" ? file.remoteId : null;
    if (remoteId && file?.remoteKind !== "image") {
      if (!truncate && typeof file?.size === "number" && file.size > limit) throw tooLarge();
      const kind = file?.remoteKind === "legacy" ? "legacy" : "file";
      return typed(await files.content(remoteId, { kind, signal, limit, truncate }), row.name, file?.mime);
    }
    if (typeof file?.data === "string") {
      if (file.kind === "image" && /^(?:data:image\/|https:\/\/)/i.test(file.data)) {
        return files.image({ url: file.data }, signal, limit);
      }
      const inline = inlineFileContent(file.data, limit, truncate);
      if (inline) return typed(inline, row.name, file.mime);
      if (file.kind === "text") {
        if (!truncate && file.data.length > limit) throw tooLarge();
        const blob = new Blob([truncate ? file.data.slice(0, limit) : file.data], { type: "text/plain" });
        if (!truncate && blob.size > limit) throw tooLarge();
        return truncate ? blob.slice(0, limit, "text/plain") : blob;
      }
    }
    throw new Error("L’original n’est plus disponible. Joins-le à nouveau.");
  }

  function unnamed(file: RemoteFile): string { return file.filename || "Fichier enregistré"; }

  function downloadRemote(row: RemoteFile): Promise<string> {
    return saveStream(unnamed(row), () => files.response(row.id, signal));
  }

  async function previewLoad<T>(outer: AbortSignal | undefined, load: (requestSignal: AbortSignal) => Promise<T>): Promise<T> {
    checkSignal(signal);
    if (!outer || outer === signal) return load(signal);
    checkSignal(outer);
    const combined = new AbortController();
    const abort = () => combined.abort();
    signal.addEventListener("abort", abort, { once: true });
    outer.addEventListener("abort", abort, { once: true });
    try {
      return await load(combined.signal);
    } finally {
      signal.removeEventListener("abort", abort);
      outer.removeEventListener("abort", abort);
    }
  }

  function filePreview(row: LibraryEntry): PreviewFile {
    if (typeof row.code === "string") {
      const generated = generatedFile(row.name, row.code);
      return { ...generated, load: outer => previewLoad(outer, generated.load) };
    }
    return {
      name: row.name,
      load: outer => previewLoad(outer, requestSignal => readAttachment(row, PREVIEW_MAX_BYTES, requestSignal)),
      save: () => saveStream(row.name, async () => {
        if (typeof row.file?.remoteId === "string" && (!row.file.remoteKind || row.file.remoteKind === "file")) {
          return files.response(row.file.remoteId, signal);
        }
        const blob = await readAttachment(row, MAX_ATTACHMENT_BYTES, signal);
        return new Response(blob.stream());
      })
    };
  }

  function pendingConversations(): NativeConversation[] {
    const owner = repository.owner();
    return repository.all().filter(row => {
      if (!owner || !visible(row) || !row.pendingResponse) return false;
      const job = record(row.pendingResponse);
      return typeof job?.owner !== "string" || !job.owner || job.owner === owner;
    });
  }

  return {
    files: () => remote.files(),
    moreFiles: () => remote.hasMore(),
    usage: force => remote.fetchUsage({ force }),
    refreshFiles: () => remote.reload(),
    loadFiles: () => remote.ensureLoaded(),
    loadMore: () => remote.loadMore(),
    removeFile: id => remote.remove(id),
    watchFiles(listener) {
      const removeFiles = remote.subscribe(listener);
      const removeConversations = repository.subscribe(listener);
      return () => { removeFiles(); removeConversations(); };
    },
    fileKind,
    arrange,
    thumbnail: (id, signal) => thumbnails.request(remoteFile(id), { signal }),
    previewRemote(id) {
      const row = remoteFile(id);
      const name = unnamed(row);
      options.openPreview({
        name,
        load: outer => previewLoad(outer, async requestSignal => {
          if (typeof row.bytes === "number" && row.bytes > PREVIEW_MAX_BYTES) throw tooLarge();
          return sniffPreviewType(await files.content(id, { signal: requestSignal, limit: REMOTE_PREVIEW_LIMIT }), name);
        }),
        save: () => downloadRemote(row)
      });
      return Promise.resolve();
    },
    saveRemote: id => downloadRemote(remoteFile(id)),
    async localFiles() {
      const owner = repository.owner();
      if (!owner || signal.aborted) return [];
      await previewStorage.index(libraryRecords(owner, repository.all(), fileKind));
      const known = await previewStorage.readLibrary(owner);
      if (options.deviceOwner && options.deviceOwner !== owner) known.push(...await previewStorage.readLibrary(options.deviceOwner));
      if (signal.aborted || owner !== repository.owner()) return [];
      return known.filter(row => canReadLocal(row, owner)).map(publicEntry);
    },
    async localThumbnail(id, signal) {
      if (signal.aborted) return icon();
      const row = await localEntry(id);
      if (signal.aborted) return icon();
      if (typeof row.code === "string") return textThumbnail(row.code);
      const image = row.kind === "image";
      const text = TEXT_SUFFIX.test(row.name);
      if (!image && !text) return icon();
      try {
        const blob = await readAttachment(row, image ? LOCAL_IMAGE_LIMIT : TEXT_SNIPPET_LIMIT, signal, text);
        if (signal.aborted) return icon();
        if (image && RASTER.test(blob.type)) {
          const url = URL.createObjectURL(blob);
          return { type: "image", url, release: () => URL.revokeObjectURL(url) };
        }
        if (text) return textThumbnail(await blob.text());
      } catch { /* L’icône reste disponible si un aperçu ne peut pas être lu. */ }
      return icon();
    },
    async localFileAction(id, action) {
      const row = await localEntry(id);
      if (action === "chat") {
        requireReady();
        if (!repository.get(row.conversationId)) throw new Error("Le chat d’origine n’est plus disponible.");
        await options.openChat(row.conversationId);
        return;
      }
      const preview = filePreview(row);
      if (action === "preview") options.openPreview(preview);
      else if (preview.save) await preview.save();
      else await saveStream(preview.name, async () => new Response((await preview.load()).stream()));
    },
    async classifyLocal(id, projectId) {
      const row = await localEntry(id);
      await previewStorage.classify(id, row.owner, projectId);
    },
    libraryColumns: () => local.read().libraryColumns,
    projectReady: ready,
    enterProject(project, chats) {
      requireReady();
      repository.setProject(project, chats);
    },
    updateProject: project => repository.editProject(project),
    deleteProjectContext(id) {
      checkSignal(signal);
      if (repository.projectId() === id) repository.setProject(null);
      for (const conversation of repository.all()) {
        if (conversation.projectId === id && !conversation.serverLocked) conversation.projectId = null;
      }
      repository.commit();
    },
    chatTarget(id) {
      const conversation = repository.get(id);
      return conversation?.chatId ? { id: conversation.chatId, projectId: conversation.projectId || null } : null;
    },
    movedChat(chatId, projectId) {
      const conversation = repository.all().find(row => row.chatId === chatId && visible(row));
      if (!conversation) return;
      conversation.projectId = projectId;
      repository.commit();
    },
    pending: () => pendingConversations().map(row => {
      const recent = record(row.pendingResponse)?.recentChatIds;
      return { id: row.id, title: row.title || "Discussion", resume: Boolean(row.chatId || (Array.isArray(recent) && recent.length)) };
    }),
    async pendingAction(id, action) {
      requireReady();
      if (!pendingConversations().some(row => row.id === id)) return;
      if (action === "resume") await options.resume(id);
      else await options.cancelPending(id);
    },
    noteUploaded(file) {
      if (signal.aborted) return;
      if (typeof record(file)?.filename === "string") remote.noteUploaded(file);
      else remote.invalidate();
    },
    dispose() {
      if (signal.aborted) return;
      lifetime.abort();
      unwatchForeground();
      unwatchReset();
      thumbnails.clear();
      remote.reset();
    }
  };
}
