import type { ImageSearch } from "./image-search.ts";
import type { Conversation } from "../types/conversation.ts";
import type { ChatRole, ChatSource } from "../types/chat.ts";
import type { GeneratedImage } from "../types/chat-stream.ts";
import { providerLabel } from "../utils/agents.ts";
import type { ApiClient } from "./api-client.ts";
import { collectGeneratedImages, collectSourceUrls } from "./chat-stream.ts";
import type { ConversationStorage } from "./conversation-storage.ts";
import type { NativeAttachment, NativePending } from "./native-chat-types.ts";
import type { Project, ProjectChat } from "./projects.ts";

export interface NativeMessage {
  role: ChatRole;
  content: string;
  serverMessageId?: string;
  prompt?: string;
  feedback?: "up" | "down";
  error?: boolean;
  sources?: ChatSource[];
  images?: GeneratedImage[];
  imageSearch?: ImageSearch;
  attachments?: NativeAttachment[];
}

export interface NativeConversation extends Omit<Conversation, "messages" | "pendingResponse"> {
  messages: NativeMessage[];
  pendingResponse?: NativePending;
  serverLocked?: boolean;
  localImageSearch?: boolean;
  serverArchived?: boolean;
  owner?: string;
  importedFrom?: { source?: string; sourceConversationId?: string; shareId?: string };
  /** Rattachement local de l’historique à la session qui y a accès. */
  accountOwner?: string;
}

type ServerRow = ProjectChat & {
  projectId?: string | null;
  createdAt?: string;
  lastMessageAt?: string;
  isPinned?: boolean;
  isLocked?: boolean;
  isArchived?: boolean;
  serverLocked?: boolean;
  serverArchived?: boolean;
  agent?: { id?: number | string; name?: string; modelProvider?: string };
};

export interface NativeConversations {
  load(): Promise<void>;
  sync(): Promise<void>;
  dispose(): void;
  all(): readonly NativeConversation[];
  get(id: string): NativeConversation | undefined;
  current(): NativeConversation | undefined;
  currentId(): string | null;
  projectId(): string | null;
  project(): Project | null;
  setProject(project: Project | null, chats?: ProjectChat[]): void;
  editProject(project: Project): void;
  add(conversation: NativeConversation): void;
  select(id: string | null): void;
  remove(id: string): void;
  commit(): void;
  subscribe(fn: () => void): () => void;
  owner(): string;
  detail(id: string): Promise<void>;
  isArchived(id: string): boolean;
  canShow(row: ProjectChat): boolean;
  mergeServer(row: ProjectChat, projectId?: string | null): NativeConversation | undefined;
}

const text = (value: unknown) => typeof value === "string" ? value : "";
const time = (value: unknown) => Date.parse(text(value)) || 0;
const identity = (value: unknown) => text(value).trim().toLowerCase();
const serverLocked = (row: ServerRow | null | undefined) => row?.isLocked === true || row?.serverLocked === true;

function asLocal(value: unknown): value is NativeConversation {
  return value !== null && typeof value === "object" && typeof (value as NativeConversation).id === "string";
}

function serverAttachments(message: Record<string, unknown>, saved: NativeAttachment[] = []): NativeAttachment[] {
  const files = [...saved];
  const keys = new Set(files.filter(file => file?.remoteId).map(file => (file.remoteKind || "file") + ":" + file.remoteId));
  const categories = [
    ["file", message.usedFilesV2Ids, "Fichier enregistré"],
    ["legacy", message.usedFileIds, "Fichier historique"]
  ] as const;
  for (const [remoteKind, list, name] of categories) {
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id !== "string" || !id) continue;
      const key = remoteKind + ":" + id;
      if (keys.has(key)) continue;
      keys.add(key);
      files.push({ id: key, remoteId: id, remoteKind, name, kind: "file" });
    }
  }
  return files;
}

function pageRows(value: unknown): ServerRow[] {
  const list = (value as { chats?: unknown } | null)?.chats;
  if (!Array.isArray(list)) throw new Error("Historique du serveur illisible.");
  return list.filter(row => row && typeof row.id === "string");
}

export function createNativeConversations(deps: {
  api: ApiClient;
  storage: ConversationStorage;
  owner: () => string;
  cachedOwner: string;
}): NativeConversations {
  let entries: NativeConversation[] = [];
  let unknownRecords: unknown[] = [];
  let selected: string | null = null;
  let project: Project | null = null;
  let loading: Promise<void> | null = null;
  let syncTask: Promise<void> | null = null;
  let ready = false;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const listeners = new Set<() => void>();
  const details = new Map<string, Promise<void>>();
  const owner = () => deps.owner().trim();
  const ownerKey = () => identity(owner());
  const owned = (row: NativeConversation) => Boolean(ownerKey()) && identity(row.accountOwner) === ownerKey();
  const find = (id: string) => entries.find(row => row.id === id && owned(row));
  const get = (id: string) => {
    const row = find(id);
    return row?.serverLocked ? undefined : row;
  };

  function current() {
    const row = selected ? get(selected) : undefined;
    return row?.serverArchived ? undefined : row;
  }

  function changed() {
    for (const handler of listeners) handler();
  }

  function commit() {
    if (!ready || signal.aborted) return;
    // Le stockage existant sérialise les écritures. Les anciens champs et les données des autres comptes sont conservés.
    deps.storage.save([...entries, ...unknownRecords] as Conversation[]);
    changed();
  }

  function load() {
    if (loading) return loading;
    loading = (async () => {
      const data = await deps.storage.load();
      if (signal.aborted) { deps.storage.close(); return; }
      const currentOwner = ownerKey();
      let migrated = false;
      for (const row of data.conversations as unknown[]) {
        if (!asLocal(row)) { unknownRecords.push(row); continue; }
        if (!Array.isArray(row.messages)) row.messages = [];
        // L’ancien format est migré seulement avec un propriétaire cohérent.
        const previousOwner = identity(row.accountOwner || row.owner || row.pendingResponse?.owner);
        if (!row.accountOwner && previousOwner) {
          row.accountOwner = previousOwner;
          migrated = true;
        } else if (!row.accountOwner && currentOwner && currentOwner === identity(deps.cachedOwner)) {
          row.accountOwner = currentOwner;
          migrated = true;
        }
        entries.push(row);
      }
      ready = true;
      if (migrated) commit();
      else changed();
    })();
    return loading;
  }

  function fromServer(row: ServerRow, projectId?: string | null) {
    const account = ownerKey();
    if (!account || !row.id) return undefined;
    let local = entries.find(item => item.chatId === row.id && owned(item));
    // Un résultat authentifié permet d’adopter une conversation historique dont l’identifiant serveur est confirmé.
    local ??= entries.find(item => item.chatId === row.id && !item.accountOwner && !item.owner);
    if (serverLocked(row)) {
      if (local) local.serverLocked = true;
      return undefined;
    }
    if (!local) {
      local = { id: crypto.randomUUID(), chatId: row.id, messages: [], needsLoad: true, accountOwner: account };
      entries.push(local);
    }
    local.accountOwner = account;
    if (local.serverLocked) return undefined;
    const remoteTime = time(row.lastMessageAt) || time(row.createdAt);
    if (!local.pendingResponse && remoteTime > (local.updatedAt || 0) + 1000) {
      local.needsLoad = true;
      local.updatedAt = remoteTime;
    }
    local.updatedAt ??= remoteTime || Date.now();
    if (row.isArchived === true || row.serverArchived === true) local.serverArchived = true;
    if (projectId !== undefined) local.projectId = projectId;
    else if ("projectId" in row) local.projectId = row.projectId || null;
    if (typeof row.title === "string" && row.title) local.title = row.title;
    if (typeof row.isPinned === "boolean") local.pinned = row.isPinned;
    if (row.agent && Number.isInteger(Number(row.agent.id))) {
      local.agentId = Number(row.agent.id);
      if (row.agent.name) local.agentName = row.agent.name;
      const provider = providerLabel(row.agent.modelProvider, row.agent.name);
      if (provider) local.agentProvider = provider;
    }
    return local;
  }

  async function sync() {
    if (syncTask) return syncTask;
    const task = (async () => {
      const data = await deps.api.json("/chats?limit=100&sortedBy=lastMessageAt", { signal });
      if (signal.aborted) return;
      for (const item of pageRows(data)) fromServer(item);
      commit();
    })();
    syncTask = task;
    try { await task; }
    finally { if (syncTask === task) syncTask = null; }
  }

  async function fetchDetail(id: string) {
    const row = get(id);
    if (!row?.chatId || row.pendingResponse || (!row.needsLoad && row.messages.length)) return;
    const chatId = row.chatId;
    const messagesBefore = row.messages;
    const data = await deps.api.json<ServerRow & { chatMessages?: Record<string, unknown>[] }>(
      "/chats/" + encodeURIComponent(chatId), { signal }
    );
    if (signal.aborted || get(id) !== row || row.messages !== messagesBefore || row.pendingResponse || row.chatId !== chatId) return;
    if (serverLocked(data)) {
      row.serverLocked = true;
      if (selected === id) selected = null;
      commit();
      return;
    }
    if (!Array.isArray(data?.chatMessages)) throw new Error("Messages du serveur illisibles.");
    const localUsers = row.messages.filter(item => item.role === "user");
    const localAssistants = row.messages.filter(item => item.role === "assistant");
    const messages: NativeMessage[] = [];
    let userIndex = 0;
    let assistantIndex = 0;
    for (const item of [...data.chatMessages].sort((a, b) => time(a?.createdAt) - time(b?.createdAt))) {
      const role = text(item?.role).toLowerCase();
      if (role !== "user" && role !== "assistant") continue;
      const serverMessageId = text(item.id) || undefined;
      const message: NativeMessage = { role, content: text(item.content), serverMessageId };
      if (typeof item.isUpvoted === "boolean") message.feedback = item.isUpvoted ? "up" : "down";
      if (role === "user") {
        const index = userIndex++;
        const exact = serverMessageId ? localUsers.find(item => item.serverMessageId === serverMessageId) : undefined;
        const fallback = localUsers[index];
        const saved = exact ?? (fallback && !fallback.serverMessageId &&
          (fallback.content === message.content || fallback.prompt === message.content) ? fallback : undefined);
        if (saved && saved.prompt === message.content) {
          message.content = saved.content;
          message.prompt = saved.prompt;
        }
        const attachments = serverAttachments(item, Array.isArray(saved?.attachments) ? saved.attachments : []);
        if (attachments.length) message.attachments = attachments;
      } else {
        const index = assistantIndex++;
        const saved = serverMessageId ? localAssistants.find(item => item.serverMessageId === serverMessageId) ?? localAssistants[index] : localAssistants[index];
        const sources: ChatSource[] = [];
        collectSourceUrls({ parts: item.parts, webSearchDomains: item.webSearchDomains }, sources, new Set());
        message.sources = sources.length ? sources : saved?.content === message.content ? saved.sources : undefined;
        const images = collectGeneratedImages(item).map(image =>
          image.id && serverMessageId ? { ...image, chatId, messageId: serverMessageId } : image);
        message.images = images.length ? images : saved?.content === message.content ? saved.images : undefined;
      }
      messages.push(message);
    }
    // Une réponse partielle du serveur ne doit pas écraser les messages encore présents sur l’appareil.
    const locallyKnown = row.messages.filter(message => message?.role !== "error");
    if (messages.length >= locallyKnown.length && messages.length) row.messages = messages;
    else if (messages.length) {
      const unread = new Set(messages);
      const merged = row.messages.map(local => {
        const newer = messages.find(item => unread.has(item) && item.role === local?.role &&
          (local.serverMessageId ? item.serverMessageId === local.serverMessageId : item.content === local.content));
        if (!newer) return local;
        unread.delete(newer);
        return newer;
      });
      row.messages = [...merged, ...unread];
    }
    if (data.title) row.title = data.title;
    if ("projectId" in data) row.projectId = data.projectId || null;
    row.needsLoad = false;
    commit();
  }

  function detail(id: string) {
    const prior = details.get(id);
    if (prior) return prior;
    const task = fetchDetail(id).finally(() => { if (details.get(id) === task) details.delete(id); });
    details.set(id, task);
    return task;
  }

  return {
    load, sync, detail, get, commit, owner,
    all: () => entries.filter(owned),
    current,
    currentId: () => current()?.id ?? null,
    project: () => project,
    projectId: () => project?.id ?? null,
    isArchived: id => get(id)?.serverArchived === true,
    canShow: row => !serverLocked(row) && !entries.some(local => local.chatId === row.id && local.serverLocked),
    mergeServer(row, projectId) {
      const local = fromServer(row, projectId);
      commit();
      return local;
    },
    setProject(next, rows = []) {
      if (signal.aborted) return;
      project = next;
      selected = null;
      if (next && rows.length) {
        for (const row of rows) fromServer(row, next.id);
        commit();
      } else changed();
    },
    editProject(next) {
      if (!signal.aborted && project?.id === next.id) { project = next; changed(); }
    },
    add(conversation) {
      if (!ready || signal.aborted || !owner()) throw new Error("Le compte n’est pas encore disponible.");
      if (entries.includes(conversation)) return;
      conversation.accountOwner = owner();
      entries.push(conversation);
      commit();
    },
    select(id) {
      if (signal.aborted || (id && (!get(id) || get(id)?.serverArchived)) || selected === id) return;
      selected = id;
      changed();
    },
    remove(id) {
      const row = get(id);
      if (signal.aborted || !row) return;
      entries = entries.filter(item => item !== row);
      if (selected === id) selected = null;
      commit();
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispose() {
      lifetime.abort();
      listeners.clear();
      void deps.storage.flush().finally(() => deps.storage.close());
    }
  };
}
