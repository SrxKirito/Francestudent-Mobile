export const editorTextLimit = 16_000;
export type EditorTarget = number | "message";

export interface EditorSource {
  title: string;
  text: string;
  language?: string;
  fileName?: string;
}

export function isEditorTarget(value: unknown): value is EditorTarget {
  return value === "message" || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
const historyLimit = 8;

export interface EditorHistory {
  current: string;
  past: string[];
  future: string[];
}

export function editorRevision(title: string, initial: string): string {
  return JSON.stringify([title, initial]);
}

export type SavedEditorDraft = { revision: string; history: EditorHistory };

function editorText(value: unknown): value is string {
  return typeof value === "string" && value.length <= editorTextLimit;
}

export function isEditorHistory(value: unknown): value is EditorHistory {
  if (!value || typeof value !== "object") return false;
  const { current, past, future } = value as Partial<EditorHistory>;
  return editorText(current) && Array.isArray(past) && Array.isArray(future) &&
    past.length + future.length <= historyLimit && past.every(editorText) && future.every(editorText);
}

export function parseEditorHistory(snapshot?: string): EditorHistory | undefined {
  if (!snapshot) return undefined;
  try {
    const value: unknown = JSON.parse(snapshot);
    if (isEditorHistory(value)) return value;
  } catch { /* une ancienne copie locale peut être illisible */ }
}

export function readEditorHistory(initial: string, saved?: string): EditorHistory {
  return parseEditorHistory(saved) ?? { current: initial, past: [], future: [] };
}

export function reviseEditor(history: EditorHistory, current: string): EditorHistory {
  if (current === history.current) return history;
  return { current, past: [...history.past.slice(1 - historyLimit), history.current], future: [] };
}

export function undoEditor(history: EditorHistory): EditorHistory {
  if (!history.past.length) return history;
  return { current: history.past.at(-1)!, past: history.past.slice(0, -1), future: [history.current, ...history.future] };
}

export function redoEditor(history: EditorHistory): EditorHistory {
  if (!history.future.length) return history;
  return { current: history.future[0], past: [...history.past, history.current], future: history.future.slice(1) };
}
