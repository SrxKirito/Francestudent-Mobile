import type { Project, ProjectChat } from "./projects.ts";

export interface RemoteFile {
  id: string;
  filename?: string;
  bytes?: number;
  created_at?: number;
}

export interface FileUsage {
  usedBytes: number;
  maxBytes: number;
  remainingBytes?: number;
  filesBytes?: number;
  skillsBytes?: number;
}

export interface FileThumbnail {
  type: "image" | "text" | "icon";
  text?: string;
  url?: string;
  release(): void;
}

export interface LibraryRecord {
  id: string;
  name: string;
  kind: string;
  direction: "sent" | "generated" | "found";
  attribution?: { url: string; artist: string; license: string };
  created: number;
  projectId: string;
  conversationId: string;
}

export interface PendingResponse {
  id: string;
  title: string;
  resume: boolean;
}

export interface WorkspaceEngine {
  files(): RemoteFile[];
  moreFiles(): boolean;
  usage(force: boolean): Promise<FileUsage>;
  refreshFiles(): Promise<unknown>;
  loadFiles(): Promise<unknown>;
  loadMore(): Promise<unknown>;
  removeFile(id: string): Promise<unknown>;
  uploadRemote?(file: File, signal: AbortSignal, progress: (sent: number, total: number) => void): Promise<void>;
  watchFiles(listener: () => void): () => void;
  arrange(rows: RemoteFile[], options: { query: string; kind: string; sort: string }): RemoteFile[];
  fileKind(name: string): string;
  thumbnail(id: string, signal: AbortSignal): Promise<FileThumbnail>;
  previewRemote(id: string): Promise<unknown>;
  saveRemote(id: string): Promise<unknown>;
  localFiles(): Promise<LibraryRecord[]>;
  localThumbnail(id: string, signal: AbortSignal): Promise<FileThumbnail>;
  localFileAction(id: string, action: "preview" | "save" | "chat"): Promise<void>;
  classifyLocal(id: string, projectId: string): Promise<void>;
  libraryColumns(): number;
  projectReady(): boolean;
  enterProject(project: Project, chats: ProjectChat[]): void;
  updateProject(project: Project): void;
  deleteProjectContext(id: string): void;
  chatTarget(id: string): { id: string; projectId: string | null } | null;
  movedChat(chatId: string, projectId: string | null): void;
  pending(): PendingResponse[];
  pendingAction(id: string, action: "resume" | "cancel"): Promise<void>;
}

export function connectWorkspaceEngine(frame: Window | null): WorkspaceEngine | null {
  try {
    const engine = (frame as (Window & { __fsWorkspace?: WorkspaceEngine }) | null)?.__fsWorkspace;
    return typeof engine?.watchFiles === "function" ? engine : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "Non communiqué";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const unit = bytes < 1000 ? 0 : Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  return (bytes / 1000 ** unit).toLocaleString("fr-FR", { maximumFractionDigits: unit ? 2 : 0 }) + " " + units[unit];
}

export const FILE_KINDS = [
  ["*", "Tous les types"], ["image", "Images"], ["document", "Documents"],
  ["presentation", "PowerPoint"], ["code", "Code"], ["other", "Autres fichiers"]
] as const;

export const FILE_SORTS = [
  ["date-desc", "Plus récents"], ["date-asc", "Plus anciens"], ["size-desc", "Plus volumineux"],
  ["size-asc", "Plus petits"], ["name-asc", "Nom A → Z"], ["name-desc", "Nom Z → A"]
] as const;
