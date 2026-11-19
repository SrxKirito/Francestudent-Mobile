// Client TypeScript du pont du chat (window.__fsChat dans l'iframe de l'ancienne interface).
// Le pont renvoie du JSON : tout est revalidé ici, rien n'est supposé de la forme reçue.
import type {
  AttachmentKind, ChatImage, ChatMessage, ChatOptionName, ChatRole, ChatSource, ChatState, ComposerAttachment,
  ComposerState, ConversationAgent, MessageAttachment, PreviewTarget, StudyMode
} from "../types/chat.ts";
import type { GeneratedImage, ProcessChatStreamOptions } from "../types/chat-stream.ts";
import type { ImportApi, ImportExisting, ImportModel, ImportModels, ImportOutcome, ImportRequest } from "./conversation-import.ts";
import type { LockedConversation } from "./locked-chats.ts";
import type { ShareRequest, ShareResult, ShareTarget, SharesApi } from "./chat-shares.ts";

export interface ChatHost {
  changed(): void;
  toast(text: string, isError: boolean): void;
  /** Si présent, la lecture du flux SSE de l'ancienne interface est déléguée ici. */
  readStream?(options: ProcessChatStreamOptions): Promise<string>;
}

export interface ChatEngine {
  attach(host: ChatHost): void;
  detach(): void;
  state(): ChatState;
  send(text: string): boolean;
  stop(): void;
  regenerate(index: number): void;
  removeAttachment(id: string): void;
  /** Relance le téléversement d'une pièce jointe en échec (absent des anciens ponts : sans effet). */
  retryUpload(id: string): void;
  addFiles(files: ArrayLike<File>): void;
  editSent(index: number): void;
  editFailed(index: number): void;
  vote(index: number, isUpvoted: boolean): Promise<void>;
  setOption(name: ChatOptionName, value: boolean | StudyMode): void;
  setAgent(id: number | string): void;
  image(messageIndex: number, imageIndex: number): Promise<string | null>;
  resolveImage(image: GeneratedImage): Promise<string | null>;
  attachmentPreview(id: string): string;
  downloadImage(src: string): Promise<void>;
  preview(target: PreviewTarget): void;
  /** Import d'une conversation ChatGPT partagée : le réseau et l'enregistrement restent dans le moteur historique. */
  importApi: ImportApi;
  /** Conversations utilisables par les verrouillées. Les masquées n'y figurent que si l'accès est ouvert. */
  lockableConversations(): LockedConversation[];
  /** Partage d'une conversation : liste et droits restent décidés par le serveur, via le moteur historique. */
  sharesApi: SharesApi;
}

interface RawChat {
  attach(host: ChatHost): void;
  detach(): void;
  state(): string;
  send(text: string): boolean;
  stop(): void;
  regenerate(index: number): unknown;
  removeAttachment(id: string): void;
  retryUpload?(id: string): void;
  addFiles(files: ArrayLike<File>): unknown;
  editSent(index: number): void;
  editFailed(index: number): void;
  vote(index: number, isUpvoted: boolean): Promise<void>;
  setOption(name: string, value: unknown): void;
  setAgent(id: number | string): void;
  image(messageIndex: number, imageIndex: number): Promise<string | null>;
  resolveImage(json: string): Promise<string | null>;
  attachmentPreview(id: string): string;
  downloadImage(src: string): Promise<void>;
  preview(json: string): void;
  importModels(): string;
  importFindExisting(shareId: string): string;
  importRun(json: string): Promise<string>;
  lockableConversations(): string;
  sharesTarget(localId: string): string;
  sharesCall(json: string): Promise<string>;
}

const METHODS = [
  "attach", "detach", "state", "send", "stop", "regenerate", "removeAttachment", "addFiles", "editSent", "editFailed",
  "vote", "setOption", "setAgent", "image", "resolveImage", "attachmentPreview", "downloadImage", "preview",
  "importModels", "importFindExisting", "importRun", "lockableConversations", "sharesTarget", "sharesCall"
] as const;

export const EMPTY_CHAT_STATE: ChatState = {
  ready: false,
  id: null,
  chatId: null,
  title: "",
  busy: false,
  stopping: false,
  pending: false,
  legacyOverlay: false,
  conversationAgent: null,
  messages: [],
  composer: {
    agentId: null, webSearch: false, webSearchMode: "auto", imageMode: false, powerpointMode: false,
    studyMode: "", imageModel: "", attachments: []
  },
  draft: { seq: 0, text: "" }
};

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalText = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** Seuls http(s) sont affichables comme lien de source. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function toRole(value: unknown): ChatRole {
  return value === "user" || value === "error" ? value : "assistant";
}

function toKind(value: unknown): AttachmentKind {
  return value === "image" || value === "text" ? value : "file";
}

function toSources(value: unknown): ChatSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources: ChatSource[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.url !== "string" || !isHttpUrl(item.url)) continue;
    sources.push({ url: item.url, title: text(item.title), host: text(item.host) });
  }
  return sources.length ? sources : undefined;
}

function toImages(value: unknown): ChatImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images: ChatImage[] = [];
  value.forEach((item, position) => {
    if (!isRecord(item)) return;
    const image: ChatImage = { index: Number.isInteger(item.index) ? (item.index as number) : position, inline: item.inline === true };
    const id = optionalText(item.id);
    const messageId = optionalText(item.messageId);
    const chatId = optionalText(item.chatId);
    const url = optionalText(item.url);
    if (id) image.id = id;
    if (messageId) image.messageId = messageId;
    if (chatId) image.chatId = chatId;
    if (url && isHttpUrl(url)) image.url = url;
    images.push(image);
  });
  return images.length ? images : undefined;
}

function toAttachments(value: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files: MessageAttachment[] = [];
  for (const item of value) {
    if (isRecord(item)) files.push({ name: text(item.name), kind: toKind(item.kind), mime: text(item.mime) });
  }
  return files.length ? files : undefined;
}

function toMessage(value: unknown, position: number): ChatMessage | null {
  if (!isRecord(value)) return null;
  const message: ChatMessage = {
    index: Number.isInteger(value.index) ? (value.index as number) : position,
    role: toRole(value.role),
    content: text(value.content)
  };
  const serverMessageId = optionalText(value.serverMessageId);
  if (serverMessageId) message.serverMessageId = serverMessageId;
  if (value.feedback === "up" || value.feedback === "down") message.feedback = value.feedback;
  const sources = toSources(value.sources);
  if (sources) message.sources = sources;
  const images = toImages(value.images);
  if (images) message.images = images;
  const attachments = toAttachments(value.attachments);
  if (attachments) message.attachments = attachments;
  return message;
}

function toStudy(value: unknown): StudyMode {
  return value === "fiches" || value === "quiz" || value === "cartes" ? value : "";
}

function toAttachment(item: Rec): ComposerAttachment {
  const file: ComposerAttachment = { id: String(item.id), name: text(item.name), kind: toKind(item.kind) };
  if (item.upload === "queued" || item.upload === "uploading" || item.upload === "error") {
    file.upload = item.upload;
    if (item.upload === "uploading") {
      const progress = typeof item.progress === "number" && Number.isFinite(item.progress) ? item.progress : 0;
      file.progress = Math.min(1, Math.max(0, progress));
    }
  }
  return file;
}

function toComposer(value: unknown): ComposerState {
  const raw = isRecord(value) ? value : {};
  const attachments: ComposerAttachment[] = [];
  if (Array.isArray(raw.attachments)) {
    for (const item of raw.attachments) {
      if (isRecord(item) && typeof item.id === "string") attachments.push(toAttachment(item));
    }
  }
  const agentId = typeof raw.agentId === "number" || typeof raw.agentId === "string" ? raw.agentId : null;
  return {
    agentId,
    webSearch: raw.webSearch === true,
    webSearchMode: text(raw.webSearchMode) || "auto",
    imageMode: raw.imageMode === true,
    powerpointMode: raw.powerpointMode === true,
    studyMode: toStudy(raw.studyMode),
    imageModel: text(raw.imageModel),
    attachments
  };
}

function toAgent(value: unknown): ConversationAgent | null {
  if (!isRecord(value) || (typeof value.id !== "number" && typeof value.id !== "string")) return null;
  return { id: value.id, name: text(value.name), provider: text(value.provider) };
}

export function parseChatState(json: string): ChatState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return EMPTY_CHAT_STATE;
  }
  if (!isRecord(raw)) return EMPTY_CHAT_STATE;
  const messages: ChatMessage[] = [];
  if (Array.isArray(raw.messages)) {
    raw.messages.forEach((item, position) => {
      const message = toMessage(item, position);
      if (message) messages.push(message);
    });
  }
  const draft = isRecord(raw.draft) ? raw.draft : {};
  return {
    ready: raw.ready === true,
    id: typeof raw.id === "string" ? raw.id : null,
    chatId: typeof raw.chatId === "string" ? raw.chatId : null,
    title: text(raw.title),
    busy: raw.busy === true,
    stopping: raw.stopping === true,
    pending: raw.pending === true,
    legacyOverlay: raw.legacyOverlay === true,
    conversationAgent: toAgent(raw.conversationAgent),
    messages,
    composer: toComposer(raw.composer),
    draft: { seq: Number.isInteger(draft.seq) ? (draft.seq as number) : 0, text: text(draft.text) }
  };
}

function isRawChat(value: unknown): value is RawChat {
  return isRecord(value) && METHODS.every(method => typeof value[method] === "function");
}

function parseJson(json: unknown): unknown {
  try { return JSON.parse(String(json)); } catch { return null; }
}

function parseImportModels(json: string): ImportModels {
  const raw = parseJson(json);
  const models: ImportModel[] = [];
  let currentId: number | null = null;
  if (isRecord(raw)) {
    if (Array.isArray(raw.models)) {
      for (const item of raw.models) {
        if (isRecord(item) && typeof item.id === "number" && typeof item.label === "string" && typeof item.model === "string") {
          models.push({ id: item.id, label: item.label, model: item.model });
        }
      }
    }
    if (typeof raw.currentId === "number") currentId = raw.currentId;
  }
  return { models, currentId };
}

function parseImportExisting(json: string): ImportExisting | null {
  const raw = parseJson(json);
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return { id: raw.id, serverArchived: raw.serverArchived === true };
}

function parseImportOutcome(json: unknown): ImportOutcome {
  const raw = parseJson(json);
  if (!isRecord(raw)) return { ok: false, message: "Réponse illisible du moteur d’import." };
  const outcome: ImportOutcome = { ok: raw.ok === true };
  if (typeof raw.id === "string") outcome.id = raw.id;
  if (typeof raw.count === "number") outcome.count = raw.count;
  else if (raw.count === null) outcome.count = null;
  if (typeof raw.status === "number") outcome.status = raw.status;
  if (typeof raw.detail === "string" && raw.detail) outcome.detail = raw.detail;
  if (typeof raw.message === "string" && raw.message) outcome.message = raw.message;
  if (raw.noSession === true) outcome.noSession = true;
  if (raw.noModel === true) outcome.noModel = true;
  if (raw.unexpected === true) outcome.unexpected = true;
  if (raw.aborted === true) outcome.aborted = true;
  return outcome;
}

function parseLockable(json: string): LockedConversation[] {
  const raw = parseJson(json);
  const list: LockedConversation[] = [];
  if (!Array.isArray(raw)) return list;
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    list.push({
      id: item.id,
      chatId: typeof item.chatId === "string" ? item.chatId : undefined,
      title: text(item.title),
      updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
      pendingResponse: item.pendingResponse === true
    });
  }
  return list;
}

function parseShareTarget(json: string): ShareTarget | null {
  const raw = parseJson(json);
  if (!isRecord(raw) || typeof raw.chatId !== "string" || !raw.chatId) return null;
  const me = isRecord(raw.me) ? raw.me : {};
  return {
    chatId: raw.chatId,
    me: { id: typeof me.id === "number" && Number.isInteger(me.id) ? me.id : null, email: text(me.email) }
  };
}

function parseShareResult(json: unknown): ShareResult {
  const raw = parseJson(json);
  if (!isRecord(raw)) return { ok: false, message: "Réponse illisible du moteur de partage." };
  const result: ShareResult = { ok: raw.ok === true };
  if ("data" in raw) result.data = raw.data;
  if (typeof raw.status === "number") result.status = raw.status;
  if (typeof raw.message === "string" && raw.message) result.message = raw.message;
  if (raw.noSession === true) result.noSession = true;
  if (raw.notSynced === true) result.notSynced = true;
  if (raw.aborted === true) result.aborted = true;
  return result;
}

/** Se relie au pont du chat d'une iframe. `null` si inaccessible (autre origine, pas encore chargée) ou incomplet. */
export function connectChatEngine(frameWindow: unknown): ChatEngine | null {
  let raw: unknown;
  try {
    raw = typeof frameWindow === "object" && frameWindow !== null ? (frameWindow as Rec).__fsChat : undefined;
  } catch {
    return null;
  }
  if (!isRawChat(raw)) return null;
  const chat = raw;
  return {
    attach: host => chat.attach(host),
    detach: () => chat.detach(),
    state: () => parseChatState(chat.state()),
    send: value => chat.send(value) === true,
    stop: () => chat.stop(),
    regenerate: index => { void chat.regenerate(index); },
    removeAttachment: id => chat.removeAttachment(id),
    retryUpload: id => { if (typeof chat.retryUpload === "function") chat.retryUpload(id); },
    addFiles: files => { void chat.addFiles(files); },
    editSent: index => chat.editSent(index),
    editFailed: index => chat.editFailed(index),
    vote: (index, isUpvoted) => chat.vote(index, isUpvoted),
    setOption: (name, value) => chat.setOption(name, value),
    setAgent: id => chat.setAgent(id),
    image: (messageIndex, imageIndex) => chat.image(messageIndex, imageIndex),
    resolveImage: image => chat.resolveImage(JSON.stringify(image)),
    attachmentPreview: id => chat.attachmentPreview(id),
    downloadImage: src => chat.downloadImage(src),
    preview: target => chat.preview(JSON.stringify(target)),
    importApi: {
      models: () => parseImportModels(chat.importModels()),
      findExisting: shareId => parseImportExisting(chat.importFindExisting(shareId)),
      run: async (request: ImportRequest) => {
        try {
          return parseImportOutcome(await chat.importRun(JSON.stringify(request)));
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "" };
        }
      }
    },
    lockableConversations: () => parseLockable(chat.lockableConversations()),
    sharesApi: {
      target: localId => parseShareTarget(chat.sharesTarget(localId)),
      call: async (request: ShareRequest) => {
        try {
          return parseShareResult(await chat.sharesCall(JSON.stringify(request)));
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "" };
        }
      }
    }
  };
}
