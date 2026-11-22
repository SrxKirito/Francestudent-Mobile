import { number, object, text } from "./interactive-widgets.ts";

export interface InteractiveApp {
  kind: "app";
  title: string;
  code: string;
  initial: string;
}

export interface AppEvent {
  id: string;
  value: string | number | boolean | null;
}

type Control = { id: string; label: string; disabled: boolean };
export type AppElement =
  | { kind: "heading" | "text"; text: string }
  | { kind: "metric"; label: string; value: string }
  | { kind: "list"; items: string[] }
  | (Control & { kind: "button" })
  | (Control & { kind: "text-input"; value: string })
  | (Control & { kind: "checkbox"; value: boolean })
  | (Control & { kind: "select"; value: string; choices: string[] })
  | (Control & { kind: "range"; value: number; min: number; max: number; step: number });

export type AppRequest = { code: string; state: string; event: AppEvent | null };
export type AppResponse = { state: string; view: AppElement[] } | { error: true };

export const appStateLimit = 24_000;

export function parseApp(row: Record<string, unknown>, title: string): InteractiveApp | null {
  const code = row.code;
  if (typeof code !== "string" || !code.trim() || code.length > 24_000 || !object(row.initial)) return null;
  const initial = JSON.stringify(row.initial);
  return initial.length <= appStateLimit ? { kind: "app", title: title || "Application interactive", code, initial } : null;
}

export function parseAppView(raw: unknown): AppElement[] {
  if (!Array.isArray(raw) || raw.length > 60) return [];
  const controls = new Set<string>();
  return raw.flatMap<AppElement>(entry => {
    const row = object(entry);
    if (!row) return [];
    const body = text(row.text, 2_000);
    if (row.kind === "heading" || row.kind === "text") return body ? [{ kind: row.kind, text: body }] : [];
    const label = text(row.label, 160);
    if (row.kind === "metric") {
      const value = number(row.value) ? String(row.value) : text(row.value, 160);
      return label && value ? [{ kind: "metric", label, value }] : [];
    }
    if (row.kind === "list" && Array.isArray(row.items)) {
      const items = row.items.slice(0, 40).map(item => text(item, 350)).filter(Boolean);
      return items.length ? [{ kind: "list", items }] : [];
    }

    const id = text(row.id, 60);
    if (!label || !/^[a-zA-Z0-9_-]+$/.test(id) || controls.has(id)) return [];
    const control = { id, label, disabled: row.disabled === true };
    let element: AppElement;
    switch (row.kind) {
      case "button": element = { ...control, kind: row.kind }; break;
      case "text-input": element = { ...control, kind: row.kind, value: text(row.value, 500) }; break;
      case "checkbox": element = { ...control, kind: row.kind, value: row.value === true }; break;
      case "select": {
        if (!Array.isArray(row.choices)) return [];
        const choices = [...new Set(row.choices.slice(0, 30).map(choice => text(choice, 120)).filter(Boolean))];
        if (!choices.length) return [];
        const value = text(row.value, 120);
        element = { ...control, kind: row.kind, choices, value: choices.includes(value) ? value : choices[0] };
        break;
      }
      case "range": {
        const { min, max, step, value } = row;
        if (!number(min) || !number(max) || min >= max || !number(step) || step <= 0 ||
            !Number.isFinite(max - min) || !number(value)) return [];
        element = { ...control, kind: row.kind, min, max, step, value: Math.max(min, Math.min(max, value)) };
        break;
      }
      default: return [];
    }
    controls.add(id);
    return [element];
  });
}
