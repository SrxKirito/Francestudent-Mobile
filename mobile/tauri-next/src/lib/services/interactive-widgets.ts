
export type Cell = string | number | boolean | null;
export interface Card { title: string; text: string; label: string; href: string; image: string }
export interface Place { title: string; text: string; lat: number; lon: number }
export type FieldType = "text" | "textarea" | "number" | "range" | "date" | "checkbox" | "select" | "radio";
export interface Field {
  id: string; label: string; type: FieldType; required: boolean;
  value: string | number | boolean; min: number; max: number; step: number; choices: string[];
}
const operations = {
  add: (a: number, b: number) => a + b,
  sub: (a: number, b: number) => a - b,
  mul: (a: number, b: number) => a * b,
  div: (a: number, b: number) => a / b,
  pow: (a: number, b: number) => a ** b,
  min: Math.min,
  max: Math.max,
  sin: Math.sin,
  cos: Math.cos,
  sqrt: Math.sqrt,
  abs: Math.abs
};
type Operation = keyof typeof operations;
export type Formula = number | { field: number } | { choice: number; labels: string[]; values: number[] } | { op: Operation; args: Formula[] };
type Result = { label: string; unit: string; formula: Formula };
type Named<T> = T & { title: string };
export type InteractiveWidget =
  | Named<{ kind: "table"; columns: string[]; rows: Cell[][] }>
  | Named<{ kind: "cards" | "carousel" | "timeline" | "animation"; items: Card[] }>
  | Named<{ kind: "diagram"; items: Card[]; edges: [number, number][] }>
  | Named<{ kind: "map"; places: Place[]; route: boolean }>
  | Named<{ kind: "form" | "simulator"; fields: Field[]; results: Result[] }>
  | Named<{ kind: "editor"; text: string }>;

export const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const number = (value: unknown): value is number => typeof value === "number" && Math.abs(value) <= 1e12;
const list = (value: unknown, limit: number): unknown[] => Array.isArray(value) ? value.slice(0, limit) : [];
const fallbackNumber = (value: unknown, fallback: number) => number(value) ? value : fallback;
const choices = (value: unknown, max: number, length: number) =>
  [...new Set(list(value, max).map(item => text(item, length)).filter(Boolean))];

function https(value: unknown, image = false): string {
  if (typeof value !== "string" || value.length > 2_048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    if (image && (url.hostname !== "upload.wikimedia.org" && url.hostname !== "thumb.wikimedia.org")) return "";
    if (image && !/\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)) return "";
    return url.href;
  } catch { return ""; }
}

function cards(value: unknown): Card[] {
  return list(value, 24).flatMap(raw => {
    const row = object(raw);
    const title = text(row?.title, 150);
    return row && title ? [{
      title, text: text(row.text, 1600), label: text(row.label, 100), href: https(row.url), image: https(row.image, true)
    }] : [];
  });
}

function cell(value: unknown): Cell {
  if (number(value) || typeof value === "boolean") return value;
  return typeof value === "string" ? value.slice(0, 400) : null;
}

const fieldTypes = new Set<string>(["text", "textarea", "number", "range", "date", "checkbox", "select", "radio"]);
function fields(value: unknown): Field[] {
  const ids = new Set<string>();
  return list(value, 20).flatMap(raw => {
    const row = object(raw);
    const id = text(row?.id, 40);
    const label = text(row?.label, 120);
    if (!row || !/^[a-z][a-z0-9_-]*$/i.test(id) || ids.has(id) || !label ||
      typeof row.type !== "string" || !fieldTypes.has(row.type)) return [];
    const type = row.type as FieldType;
    const options = choices(row.choices, 20, 120);
    if ((type === "radio" || type === "select") && !options.length) return [];
    ids.add(id);
    const min = fallbackNumber(row.min, type === "range" ? 0 : -1e12);
    const max = Math.max(min, fallbackNumber(row.max, type === "range" ? 100 : 1e12));
    const step = Math.max(0.000001, fallbackNumber(row.step, 1));
    let initial: Field["value"] = text(row.value, 2_000);
    if (type === "checkbox") initial = row.value === true;
    else if (type === "number" || type === "range") initial = Math.min(max, Math.max(min, fallbackNumber(row.value, 0)));
    else if (type === "radio" || type === "select") initial = options.includes(String(initial)) ? initial : options[0];
    else if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(initial))) initial = "";
    return [{ id, label, type, required: row.required === true, value: initial, min, max, step, choices: options }];
  });
}

const unary = new Set<string>(["sin", "cos", "sqrt", "abs"]);
function readFormula(raw: unknown, inputs: Field[], depth = 0): Formula | null {
  if (depth > 6) return null;
  if (number(raw)) return raw;
  const row = object(raw);
  if (!row) return null;
  if (typeof row.choice === "string") {
    const index = inputs.findIndex(field => field.id === row.choice && (field.type === "select" || field.type === "radio"));
    const labels = inputs[index]?.choices;
    if (!labels || !Array.isArray(row.values) || row.values.length !== labels.length || !row.values.every(number)) return null;
    return { choice: index, labels, values: row.values };
  }
  if (typeof row.field === "string") {
    const index = inputs.findIndex(field => field.id === row.field && typeof field.value !== "string");
    return index >= 0 ? { field: index } : null;
  }
  if (typeof row.op !== "string" || !Object.hasOwn(operations, row.op) || !Array.isArray(row.args)) return null;
  const count = unary.has(row.op) ? 1 : 2;
  if (row.args.length !== count) return null;
  const args = row.args.map(arg => readFormula(arg, inputs, depth + 1));
  return args.every((arg): arg is Formula => arg !== null) ? { op: row.op as Operation, args } : null;
}

export function calculate(formula: Formula, values: unknown[]): number {
  if (typeof formula === "number") return formula;
  if ("choice" in formula) return formula.values[formula.labels.indexOf(String(values[formula.choice]))] ?? NaN;
  if ("field" in formula) {
    const value = values[formula.field];
    return typeof value === "boolean" ? Number(value) : typeof value === "number" ? value : NaN;
  }
  const [a, b] = formula.args.map(arg => calculate(arg, values));
  if (!Number.isFinite(a) || (formula.args.length > 1 && !Number.isFinite(b))) return NaN;
  return unary.has(formula.op) ? operations[formula.op](a, a) : operations[formula.op](a, b);
}

export function parseWidget(row: Record<string, unknown>, title: string): InteractiveWidget | null {
  switch (row.kind) {
    case "table": {
      const columns = list(row.columns, 12).map(value => text(value, 80));
      const rows = list(row.rows, 120).flatMap(raw =>
        Array.isArray(raw) && raw.length ? [columns.map((_, index) => cell(raw[index]))] : []);
      return columns.length && columns.every(Boolean) && rows.length ? { kind: "table", title: title || "Tableau", columns, rows } : null;
    }
    case "cards":
    case "carousel":
    case "timeline":
    case "animation": {
      const items = cards(row.items);
      return items.length ? { kind: row.kind, title: title || "Présentation", items } : null;
    }
    case "diagram": {
      // Garder les indices d’origine jusqu’à la validation des liaisons.
      const nodes = list(row.items, 24).map(value => cards([value])[0]);
      if (!nodes.length || nodes.some(node => !node)) return null;
      const edges = list(row.edges, 48).flatMap(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(n => Number.isInteger(n) && n >= 0 && n < nodes.length)) return [];
        return [[pair[0] as number, pair[1] as number] satisfies [number, number]];
      });
      return { kind: "diagram", title: title || "Schéma", items: nodes, edges };
    }
    case "map": {
      const places = list(row.places, 48).flatMap(raw => {
        const place = object(raw);
        const title = text(place?.title, 120);
        if (!place || !title || !number(place.lat) || Math.abs(place.lat) > 90 ||
          !number(place.lon) || Math.abs(place.lon) > 180) return [];
        return [{ title, text: text(place.text, 1_000), lat: place.lat, lon: place.lon }];
      });
      return places.length ? { kind: "map", title: title || "Carte", places, route: row.route === true } : null;
    }
    case "form":
    case "simulator": {
      const inputs = fields(row.fields);
      const results = list(row.results, 8).flatMap(raw => {
        const result = object(raw);
        const label = text(result?.label, 120);
        const formula = readFormula(result?.formula, inputs);
        return label && formula !== null ? [{ label, formula, unit: text(result?.unit, 24) }] : [];
      });
      if (!inputs.length || (row.kind === "simulator" && !results.length)) return null;
      return { kind: row.kind, title: title || (row.kind === "form" ? "Formulaire" : "Simulation"), fields: inputs, results };
    }
    case "editor": {
      const body = text(row.text, 16_000);
      return body ? { kind: "editor", title: title || "Document", text: body } : null;
    }
    default: return null;
  }
}
