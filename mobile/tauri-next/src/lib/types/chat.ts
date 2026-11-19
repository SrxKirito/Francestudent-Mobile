// Types du chat Svelte : instantané renvoyé par le pont de l'ancienne interface (svelte-chat-engine.js).
// Aucun import à l'exécution : ce fichier est effacé à la compilation.

export type ChatRole = "user" | "assistant" | "error";
export type AttachmentKind = "image" | "file" | "text";
export type StudyMode = "" | "fiches" | "quiz" | "cartes";

export interface ChatSource {
  url: string;
  title: string;
  host: string;
}

/** Image d'une réponse : `inline` = données déjà dans la page (récupérées via `image()`), sinon id serveur ou URL. */
export interface ChatImage {
  index: number;
  id?: string;
  messageId?: string;
  chatId?: string;
  url?: string;
  inline: boolean;
}

export interface MessageAttachment {
  name: string;
  kind: AttachmentKind;
  mime: string;
}

export interface ChatMessage {
  index: number;
  role: ChatRole;
  content: string;
  serverMessageId?: string;
  feedback?: "up" | "down";
  sources?: ChatSource[];
  images?: ChatImage[];
  attachments?: MessageAttachment[];
}

export interface ComposerAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** État du téléversement tant qu'il n'est pas terminé (absent : prêt à être envoyé). */
  upload?: UploadState;
  /** Avancement de 0 à 1, seulement pendant `uploading`. */
  progress?: number;
}

export type UploadState = "queued" | "uploading" | "error";

export interface ComposerState {
  agentId: number | string | null;
  webSearch: boolean;
  webSearchMode: string;
  imageMode: boolean;
  powerpointMode: boolean;
  studyMode: StudyMode;
  imageModel: string;
  attachments: ComposerAttachment[];
}

export interface ConversationAgent {
  id: number | string;
  name: string;
  provider: string;
}

export interface ChatState {
  ready: boolean;
  id: string | null;
  chatId: string | null;
  title: string;
  busy: boolean;
  stopping: boolean;
  /** Réponse interrompue à reprendre (conversation.pendingResponse). */
  pending: boolean;
  /** Une fenêtre de l'ancienne interface (réglages, projets, bibliothèque…) est ouverte. */
  legacyOverlay: boolean;
  conversationAgent: ConversationAgent | null;
  messages: ChatMessage[];
  composer: ComposerState;
  draft: { seq: number; text: string };
}

export type ChatOptionName = "webSearch" | "imageMode" | "studyMode";

export interface PreviewTarget {
  messageIndex?: number;
  attachmentIndex?: number;
  pending?: string;
}
