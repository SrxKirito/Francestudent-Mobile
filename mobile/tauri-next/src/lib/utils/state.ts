import type { ImageModel, LibraryColumns, StoredState, StudyMode, Theme, WebSearchMode } from "../types/state.ts";

export const STORE_KEY = "fs-chat-state";
export const DEFAULT_AGENT_ID = -1002;

const WEB_MODES: readonly WebSearchMode[] = ["open", "filtered", "disabled"];
const STUDY_MODES: readonly StudyMode[] = ["fiches", "quiz", "cartes"];
const IMAGE_MODELS: readonly ImageModel[] = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"];
const COLUMNS: readonly LibraryColumns[] = [1, 2, 3, 4];

function pick<T>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find(item => item === value);
}

/** Reproduit `loadStore()` de core.js : JSON corrompu ou valeurs inattendues retombent sur les défauts. */
export function parseStoredState(raw: string | null, makeId: () => string): StoredState {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    saved = {};
  }
  const defaultAgentId = Number.isInteger(saved.defaultAgentId) ? (saved.defaultAgentId as number) : null;
  const theme: Theme = saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system";
  return {
    session: typeof saved.session === "string" ? saved.session : "",
    deviceId: typeof saved.deviceId === "string" && saved.deviceId ? saved.deviceId : makeId(),
    agentId: Number.isInteger(saved.agentId) ? (saved.agentId as number) : defaultAgentId ?? DEFAULT_AGENT_ID,
    defaultAgentId,
    webSearch: saved.webSearch === true,
    webSearchMode: pick(WEB_MODES, saved.webSearchMode) ?? "open",
    customInstructionsManaged: saved.customInstructionsManaged === true,
    libraryColumns: pick(COLUMNS, saved.libraryColumns) ?? 3,
    completionNotifications: saved.completionNotifications === true,
    imageMode: saved.imageMode === true,
    powerpointMode: false,
    imageTool: saved.imageTool !== false,
    studyMode: pick(STUDY_MODES, saved.studyMode) ?? "",
    imageModel: pick(IMAGE_MODELS, saved.imageModel) ?? "gpt-image-2.5-flare",
    theme,
    profile: saved.profile && typeof saved.profile === "object" ? (saved.profile as Record<string, unknown>) : null,
    avatar: typeof saved.avatar === "string" && /^data:image\//i.test(saved.avatar) ? saved.avatar : "",
    conversations: Array.isArray(saved.conversations) ? saved.conversations : []
  };
}

/** Quand IndexedDB est disponible, les conversations ne sont plus écrites dans localStorage. */
export function serializeState(state: StoredState, conversationsInIndexedDb: boolean): string {
  return JSON.stringify(conversationsInIndexedDb ? { ...state, conversations: [] } : state);
}
