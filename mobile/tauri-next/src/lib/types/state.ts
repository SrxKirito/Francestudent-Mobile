// Forme de l'état persisté dans localStorage (clé `fs-chat-state`).
// Elle doit rester identique à `loadStore()` de mobile/www/js/core.js : les données
// des utilisateurs existants sont relues telles quelles.

export type Theme = "system" | "light" | "dark";
export type WebSearchMode = "open" | "filtered" | "disabled";
export type StudyMode = "" | "fiches" | "quiz" | "cartes";
export type LibraryColumns = 1 | 2 | 3 | 4;
export type ImageModel = "gpt-image-2.5-sunburst" | "gpt-image-2.5-flare" | "gpt-image-2";

export interface StoredState {
  session: string;
  deviceId: string;
  agentId: number;
  defaultAgentId: number | null;
  webSearch: boolean;
  webSearchMode: WebSearchMode;
  customInstructionsManaged: boolean;
  libraryColumns: LibraryColumns;
  completionNotifications: boolean;
  imageMode: boolean;
  powerpointMode: false;
  imageTool: boolean;
  studyMode: StudyMode;
  imageModel: ImageModel;
  theme: Theme;
  profile: Record<string, unknown> | null;
  avatar: string;
  /** Les conversations vivent dans IndexedDB (`francestudent-conversations`) ; ce champ n'est qu'une migration. */
  conversations: unknown[];
}
