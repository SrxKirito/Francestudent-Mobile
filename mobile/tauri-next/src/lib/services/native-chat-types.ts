import type { AttachmentKind, ChatSource } from "../types/chat.ts";
import type { GeneratedImage, PendingResponse } from "../types/chat-stream.ts";

/** Format compatible avec les pièces jointes déjà enregistrées dans IndexedDB. */
export interface NativeAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime?: string;
  size?: number;
  data?: string;
  remoteId?: string;
  remoteKind?: "file" | "legacy" | "image";
  previewId?: string | null;
}

/** Point de reprise partagé avec l'index de la bibliothèque et les anciennes versions. */
export interface NativePending extends PendingResponse {
  text?: string;
  requestText?: string;
  /** false signifie que l’envoi préparé n’a pas atteint la commande réseau. */
  dispatchStarted?: boolean;
  startedAt?: number;
  userIndex?: number;
  owner?: string;
  state?: "interrupted";
  sources?: ChatSource[];
  images?: GeneratedImage[];
  recentChatIds?: string[];
  baselineIds?: string[];
  userServerId?: string;
  imageMode?: boolean;
}
