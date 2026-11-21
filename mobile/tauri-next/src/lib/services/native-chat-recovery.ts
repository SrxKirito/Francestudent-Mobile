import type { NativeRequest } from "./native-chat-network.ts";
import type { NativeConversation } from "./native-conversations.ts";
import type { NativePending } from "./native-chat-types.ts";

interface ServerMessage {
  id: string;
  role: string;
  createdAt?: string;
  content?: unknown;
  parts?: unknown;
  isUpvoted?: boolean;
}

interface ServerChat {
  id: string;
  createdAt?: string;
  projectId?: string | null;
  agent?: { id?: string | number };
  isLocked?: boolean;
  serverLocked?: boolean;
  isArchived?: boolean;
  serverArchived?: boolean;
}

const DETAIL_TIMEOUT = 8_000;

export function chatPath(id: string) {
  return "/chats/" + encodeURIComponent(id);
}

export function messageText(item: Pick<ServerMessage, "content" | "parts">): string {
  if (typeof item.content === "string") return item.content;
  return [item.content, item.parts].flatMap(value => Array.isArray(value) ? value : []).map(part => {
    if (typeof part === "string") return part;
    if (part && typeof part.text === "string") return part.text;
    if (part && typeof part.content === "string" && /text/i.test(String(part.type))) return part.content;
    return "";
  }).filter(Boolean).join("\n\n");
}

async function readJson(request: NativeRequest, path: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abandon = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abandon, { once: true });
  const timeout = setTimeout(() => controller.abort(), DETAIL_TIMEOUT);
  try {
    const response = await request(path, { signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abandon);
  }
}

export async function detailMessages(request: NativeRequest, id: string, signal: AbortSignal): Promise<ServerMessage[] | null> {
  const detail = await readJson(request, chatPath(id), signal) as {
    chatMessages?: unknown; isLocked?: boolean; serverLocked?: boolean; isArchived?: boolean; serverArchived?: boolean;
  } | null;
  if (detail?.isLocked || detail?.serverLocked || detail?.isArchived || detail?.serverArchived || !Array.isArray(detail?.chatMessages)) return null;
  return detail.chatMessages.filter(item => item && typeof item.id === "string" && typeof item.role === "string")
    .sort((a, b) => (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0));
}

const RECENT_CHATS_PATH = "/chats?limit=100&sortedBy=lastMessageAt";

export async function recentChats(request: NativeRequest, signal: AbortSignal): Promise<ServerChat[] | null> {
  const list = await readJson(request, RECENT_CHATS_PATH, signal) as { chats?: unknown } | null;
  return Array.isArray(list?.chats) ? list.chats.filter(row => row && typeof row.id === "string" && row.id) : null;
}

function matchesRequest(message: ServerMessage, pending: NativePending): boolean {
  const text = messageText(message);
  const known = pending.requestText || pending.text;
  return Boolean(known) && (text === known || (!pending.requestText && text.endsWith(known ?? "")));
}

export function matchingAnswer(list: ServerMessage[], pending: NativePending): ServerMessage | undefined {
  const baseline = pending.baselineIds;
  let from = list.length - 1;
  for (; from >= 0; from--) {
    const row = list[from];
    if (row.role !== "user") continue;
    const matches = pending.userServerId ? row.id === pending.userServerId :
      Array.isArray(baseline) && !baseline.includes(row.id) && matchesRequest(row, pending);
    if (matches) break;
  }
  if (from < 0) return undefined;
  for (const row of list.slice(from + 1)) {
    if (row.role === "user") return undefined;
    if (row.role === "assistant" && (!baseline || !baseline.includes(row.id))) return row;
  }
  return undefined;
}

/** Ne reprend un nouvel échange sans identifiant que si un seul chat correspond à l’envoi. */
export async function recoverChatId(request: NativeRequest, conversation: NativeConversation, pending: NativePending, signal: AbortSignal): Promise<string | undefined> {
  if (!Array.isArray(pending.recentChatIds) || !pending.startedAt) return undefined;
  const since = pending.startedAt - 5000;
  const known = new Set(pending.recentChatIds);
  const list = await recentChats(request, signal);
  if (!list) return undefined;
  const plausible = list.filter(row => !known.has(row.id) && !row.isLocked && !row.serverLocked && !row.isArchived && !row.serverArchived &&
    Date.parse(row.createdAt || "") >= since && (row.projectId || null) === (conversation.projectId || null) &&
    (!row.agent || Number(row.agent.id) === conversation.agentId));
  // Une liste importante ne permet pas d'écarter d'autres correspondances sans lecture coûteuse.
  if (plausible.length > 5) return undefined;
  let match: { chatId: string; messageId: string } | undefined;
  for (const row of plausible) {
    const messages = await detailMessages(request, row.id, signal);
    if (!messages) continue;
    const user = messages.find(item => item.role === "user" && matchesRequest(item, pending));
    if (!user) continue;
    if (match) return undefined;
    match = { chatId: row.id, messageId: user.id };
  }
  if (match) pending.userServerId = match.messageId;
  return match?.chatId;
}

export function waitUntilRetry(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, delay);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
