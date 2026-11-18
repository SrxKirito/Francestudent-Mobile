// Forme des conversations stockées dans IndexedDB (`francestudent-conversations`, clé `conversations`).
// Elle reproduit celle de mobile/www/js/conversations.js : les discussions des utilisateurs existants sont relues telles quelles.
// Tous les champs sauf `id` sont optionnels à la lecture : d'anciennes versions de l'app n'écrivaient pas tout.

export type MessageRole = "user" | "assistant" | "error";

export type MessageImage =
  | { id: string; messageId: string; chatId: string }
  | { data: string }
  | { url: string };

export interface ChatMessage {
  role: MessageRole;
  content: string;
  sources?: unknown[];
  images?: MessageImage[];
  attachments?: unknown;
  feedback?: "up" | "down";
  serverMessageId?: string;
  prompt?: string;
}

export interface Conversation {
  id: string;
  /** Identifiant côté serveur ; absent tant que la discussion n'a pas été créée en ligne. */
  chatId?: string;
  projectId?: string | null;
  title?: string;
  agentId?: number;
  agentName?: string;
  agentProvider?: string;
  messages?: ChatMessage[];
  /** Millisecondes depuis l'époque. */
  updatedAt?: number;
  pinned?: boolean;
  /** Vrai quand la liste serveur l'a créée sans charger ses messages. */
  needsLoad?: boolean;
  pendingResponse?: boolean;
}
