// Types du service de streaming du chat (port typé de mobile/www/js/stream.js).
// Aucun import à l'exécution : ce fichier est effacé à la compilation.

/** Site consulté, extrait des événements du flux (web_search, url_citation…). */
export interface StreamSource {
  url: string;
  title: string;
  host: string;
}

/** Image générée repérée dans un événement : base64/URL directe, ou identifiant à télécharger. */
export interface GeneratedImage {
  data?: string;
  id?: string;
  url?: string;
  messageId?: string | null;
  chatId?: string | null;
}

/** Charge utile de l'événement `image` transmis à l'interface. */
export interface ImageEventData {
  data: string | null;
  url: string | null;
  id: string | null;
  messageId: string | null;
  chatId: string | null;
}

export interface ToolProgress {
  id: string;
  label?: string;
  status: "in_progress" | "completed" | "failed";
}

export type StreamEvent =
  | { name: "image_start"; data: null }
  | { name: "image"; data: ImageEventData }
  | { name: "sources"; data: StreamSource[] }
  | { name: "message_saved"; data: Record<string, unknown> }
  | { name: "web_search"; data: Record<string, unknown> }
  | { name: "tool_progress"; data: ToolProgress };

export type SseHandler = (name: string, payload: string, eventId: string, explicitId: boolean) => void;

export interface SseParser {
  feed(chunk: string): void;
  end(): void;
}

/** Réponse en cours, sauvegardée pour pouvoir reprendre le flux après une suspension. */
export interface PendingResponse {
  output?: string;
  lastEventId?: string;
  imageStarted?: boolean;
}

/** Partie de la conversation dont le service a besoin (il ne connaît pas le reste). */
export interface StreamConversation {
  chatId: string | null;
  pendingResponse?: PendingResponse | null;
}

export interface StreamReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel(): Promise<unknown>;
}

/** Sous-ensemble de `Response` utilisé : compatible avec fetch, CapacitorHttp ou le pont Tauri. */
export interface StreamResponse {
  ok: boolean;
  status: number;
  body?: { getReader(): StreamReader } | null;
  text(): Promise<string>;
}

export interface ChatDetailResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ProcessChatStreamOptions {
  response: StreamResponse;
  conversation: StreamConversation;
  /** Reprise d'un flux interrompu (GET /chats/{id}/stream). */
  resume: boolean;
  /** Mode image actif côté interface : active le repli /chats/{id} même sans indice dans le flux. */
  imageMode: boolean;
  onDelta: (output: string) => void;
  onEvent?: (event: StreamEvent) => void;
  shouldStop: () => boolean;
  fetchChatDetail?: (chatId: string) => Promise<ChatDetailResponse>;
  resolveImage?: (image: GeneratedImage) => Promise<string | null>;
  save?: () => void;
  now?: () => number;
  /** Journal de diagnostic (60 entrées au plus). */
  log?: string[];
}

/** Erreur de flux enrichie, lue par `friendlyError`. */
export interface StreamError extends Error {
  status?: number;
  code?: string;
  type?: string;
  retryable?: boolean;
  moderation?: unknown;
  fromStream?: boolean;
  auth?: boolean;
  upload?: boolean;
}
