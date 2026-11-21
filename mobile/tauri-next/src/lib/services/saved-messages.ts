import type { ApiClient } from "./api-client.ts";

const ROOT = "/user/@me/saved-messages";

export interface SavedMessage {
  chatId: string;
  messageId: string;
  content: string;
}

export function savedMessages(api: ApiClient) {
  function set(chatId: string, messageId: string, saved: boolean, signal: AbortSignal) {
    return api.json(ROOT + "/" + encodeURIComponent(chatId) + "/" + encodeURIComponent(messageId), {
      method: saved ? "PUT" : "DELETE", signal
    });
  }

  async function page(cursor: string | null, signal: AbortSignal): Promise<{ rows: SavedMessage[]; next: string | null }> {
    const query = new URLSearchParams({ limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const data = await api.json<{
      savedMessages?: { chatId: string; messageId: string; message?: { content?: unknown } }[];
      hasMore?: boolean;
      nextCursor?: unknown;
    }>(ROOT + "?" + query, { signal });
    if (!Array.isArray(data?.savedMessages)) throw new Error("Réponse inattendue du serveur.");
    const rows = data.savedMessages.flatMap(item =>
      typeof item?.chatId === "string" && item.chatId && typeof item.messageId === "string" && item.messageId
        ? [{ chatId: item.chatId, messageId: item.messageId, content: typeof item.message?.content === "string" ? item.message.content : "" }]
        : []);
    const next = typeof data.nextCursor === "string" && data.nextCursor !== cursor ? data.nextCursor : "";
    if (data.hasMore && !next) throw new Error("La suite des messages est indisponible : curseur manquant.");
    return { rows, next: data.hasMore ? next : null };
  }

  return { set, page };
}
