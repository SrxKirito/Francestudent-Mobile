
export type Cell = string | number | boolean | null;
export interface Card { title: string; text: string; label: string; href: string; image: string }
export interface Place { title: string; text: string; lat: number; lon: number }
export type FieldType = "text" | "textarea" | "number" | "range" | "date" | "checkbox" | "select" | "radio";
export interface Field {
  id: string; label: string; type: FieldType; required: boolean;
  value: string | number | boolean; min: number; max: number; step: number; choices: string[];
  choiceValues?: number[];
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
export type Formula = number | { x: true } | { field: number } | { choice: number; labels: string[]; values: number[] } | { op: Operation; args: Formula[] };
type Result = { label: string; unit: string; formula: Formula };
export type SimulationPlot = {
  title: string; xLabel: string; yLabel: string; min: number; max: number;
  cursorField?: number; curves: { label: string; formula: Formula }[];
};
export type SimulationPlayback = { field: number; durationMs: number };
export type SimulationDrawing = {
  title: string; bounds: [number, number, number, number];
  points: { id: string; label: string; x: Formula; y: Formula; dragX?: number; dragY?: number }[];
  shapes: ({ kind: "path"; points: string[]; closed: boolean; arrow: boolean } |
    { kind: "circle"; center: string; radius: Formula })[];
};
export type Point3D = [number, number, number];
type ScenePosition = [Formula, Formula, Formula];
type SceneObject = { center: ScenePosition; color: string } & (
  { kind: "box"; size: ScenePosition } | { kind: "sphere"; radius: Formula } |
  { kind: "cylinder" | "cone"; radius: Formula; height: Formula }
);
export type SimulationScene = {
  title: string; bounds: [Point3D, Point3D]; objects: SceneObject[];
  points: { id: string; label: string; position: ScenePosition }[];
  faces: { ids: string[]; color: string }[];
};
type Named<T> = T & { title: string };
export type InteractiveWidget =
  | Named<{ kind: "table"; columns: string[]; rows: Cell[][] }>
  | Named<{ kind: "cards" | "carousel" | "timeline" | "animation"; items: Card[] }>
  | Named<{ kind: "diagram"; items: Card[]; edges: [number, number][] }>
  | Named<{ kind: "map"; places: Place[]; route: boolean }>
  | Named<{ kind: "form" | "simulator"; fields: Field[]; results: Result[]; plot?: SimulationPlot; drawing?: SimulationDrawing;
    playback?: SimulationPlayback; scene?: SimulationScene; equation: string; explanation: string }>
  | Named<{ kind: "editor"; text: string }>;

export const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const number = (value: unknown): value is number => typeof value === "number" && Math.abs(value) <= 1e12;
const list = (value: unknown, limit: number): unknown[] => Array.isArray(value) ? value.slice(0, limit) : [];
const fallbackNumber = (value: unknown, fallback: number) => number(value) ? value : fallback;
function numericChoice(value: unknown): number | null {
  if (number(value)) return value;
  if (typeof value !== "string" || !/^[+-]?\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value.replace(",", "."));
  return number(parsed) ? parsed : null;
}

function fieldChoices(source: unknown): { labels: string[]; values: (number | null)[] } {
  const options = new Map<string, number | null>();
  for (const item of list(source, 20)) {
    const option = object(item);
    const labelValue = option ? option.label ?? option.value : item;
    const label = text(number(labelValue) ? String(labelValue) : labelValue, 120);
    if (label && !options.has(label)) options.set(label, numericChoice(option ? option.value : item));
  }
  return { labels: [...options.keys()], values: [...options.values()] };
}

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
    const { labels: options, values } = fieldChoices(row.choices ?? row.options);
    const isChoice = type === "radio" || type === "select";
    if (isChoice && !options.length) return [];
    ids.add(id);
    const min = fallbackNumber(row.min, type === "range" ? 0 : -1e12);
    const max = Math.max(min, fallbackNumber(row.max, type === "range" ? 100 : 1e12));
    const step = Math.max(0.000001, fallbackNumber(row.step, 1));
    const value = row.value ?? row.defaultValue ?? row.default;
    let initial: Field["value"] = text(value, 2_000);
    if (type === "checkbox") initial = value === true;
    else if (type === "number" || type === "range") initial = Math.min(max, Math.max(min, numericChoice(value) ?? 0));
    else if (isChoice && !options.includes(initial)) {
      const numeric = numericChoice(value);
      const index = numeric === null ? -1 : values.indexOf(numeric);
      initial = options[index] ?? options[0];
    }
    else if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(initial))) initial = "";
    const choiceValues = isChoice && values.every(number) ? values : undefined;
    return [{ id, label, type, required: row.required === true, value: initial, min, max, step, choices: options, choiceValues }];
  });
}

const unary = new Set<string>(["sin", "cos", "sqrt", "abs"]);
function readFormula(raw: unknown, inputs: Field[], depth = 0, allowX = false): Formula | null {
  if (depth > 6) return null;
  if (number(raw)) return raw;
  const row = object(raw);
  if (!row) return null;
  if (allowX && row.x === true) return { x: true };
  if (typeof row.choice === "string") {
    const index = inputs.findIndex(field => field.id === row.choice && (field.type === "select" || field.type === "radio"));
    const labels = inputs[index]?.choices;
    if (!labels || !Array.isArray(row.values) || row.values.length !== labels.length || !row.values.every(number)) return null;
    return { choice: index, labels, values: row.values };
  }
  if (typeof row.field === "string") {
    const index = inputs.findIndex(field => field.id === row.field);
    const input = inputs[index];
    if (!input) return null;
    if (input.choiceValues) return { choice: index, labels: input.choices, values: input.choiceValues };
    return typeof input.value !== "string" ? { field: index } : null;
  }
  if (typeof row.op !== "string" || !Object.hasOwn(operations, row.op) || !Array.isArray(row.args)) return null;
  const count = unary.has(row.op) ? 1 : 2;
  if (row.args.length !== count) return null;
  const args = row.args.map(arg => readFormula(arg, inputs, depth + 1, allowX));
  return args.every((arg): arg is Formula => arg !== null) ? { op: row.op as Operation, args } : null;
}

export function calculate(formula: Formula, values: unknown[], x = NaN): number {
  if (typeof formula === "number") return formula;
  if ("x" in formula) return x;
  if ("choice" in formula) return formula.values[formula.labels.indexOf(String(values[formula.choice]))] ?? NaN;
  if ("field" in formula) {
    const value = values[formula.field];
    return typeof value === "boolean" ? Number(value) : typeof value === "number" ? value : NaN;
  }
  const [a, b] = formula.args.map(arg => calculate(arg, values, x));
  if (!Number.isFinite(a) || (formula.args.length > 1 && !Number.isFinite(b))) return NaN;
  return unary.has(formula.op) ? operations[formula.op](a, a) : operations[formula.op](a, b);
}

function readPlot(raw: unknown, inputs: Field[]): SimulationPlot | undefined {
  const plot = object(raw);
  if (!plot || !number(plot.min) || !number(plot.max) || plot.max - plot.min < 1e-9) return undefined;
  const curves = list(plot.curves, 4).flatMap(item => {
    const row = object(item);
    const formula = readFormula(row?.formula, inputs, 0, true);
    const label = text(row?.label, 80);
    return formula !== null && label ? [{ label, formula }] : [];
  });
  const cursor = inputs.findIndex(field => field.id === plot.cursor && (field.type === "range" || field.type === "number"));
  const cursorField = cursor >= 0 && inputs[cursor].max >= plot.min && inputs[cursor].min <= plot.max ? cursor : undefined;
  return curves.length ? { title: text(plot.title, 120) || "Courbes", xLabel: text(plot.xLabel, 60) || "x",
    yLabel: text(plot.yLabel, 60) || "y", min: plot.min, max: plot.max, cursorField, curves } : undefined;
}

function readPlayback(raw: unknown, inputs: Field[]): SimulationPlayback | undefined {
  const playback = object(raw);
  if (!playback || !number(playback.duration) || playback.duration < 1 || playback.duration > 30) return undefined;
  const field = inputs.findIndex(input => input.id === playback.field && input.type === "range" && snapSimulationField(input, input.max) > input.min);
  return field >= 0 ? { field, durationMs: playback.duration * 1000 } : undefined;
}

export function sampleSimulationPlot(plot: SimulationPlot, values: unknown[]) {
  return plot.curves.map(curve => {
    const points: { x: number; y: number; label: string; breakBefore?: boolean }[] = [];
    let breakBefore = false;
    for (let index = 0; index <= 64; index++) {
      const x = plot.min + (plot.max - plot.min) * index / 64;
      const y = calculate(curve.formula, values, x);
      if (!number(y)) { breakBefore = true; continue; }
      points.push({ x, y, label: Number(x.toPrecision(6)).toString(), breakBefore });
      breakBefore = false;
    }
    return { name: curve.label, points };
  }).filter(curve => curve.points.length);
}

export function simulationPlotProbe(plot: SimulationPlot, values: unknown[]) {
  const x = plot.cursorField === undefined ? undefined : values[plot.cursorField];
  if (!number(x) || x < plot.min || x > plot.max) return undefined;
  const points = plot.curves.flatMap(curve => {
    const y = calculate(curve.formula, values, x);
    return number(y) ? [{ series: curve.label, y }] : [];
  });
  return { x, points };
}

export function advanceSimulationPlayback(progress: number, elapsedMs: number, durationMs: number, loop: boolean) {
  const next = progress + elapsedMs / durationMs;
  if (next < 1) return { progress: next, ended: false };
  return loop ? { progress: next % 1, ended: false } : { progress: 1, ended: true };
}

export function snapSimulationField(field: Pick<Field, "min" | "max" | "step">, value: number): number {
  const { min, max, step } = field;
  if (!Number.isFinite(value)) return min;
  const clamped = Math.max(min, Math.min(max, value));
  const last = Math.floor((max - min) / step + 1e-8);
  const offset = Math.min(last, Math.round((clamped - min) / step));
  return Math.max(min, Math.min(max, Number((min + offset * step).toPrecision(15))));
}

function directNumericField(formula: Formula, inputs: Field[]): number | undefined {
  if (typeof formula === "number" || !("field" in formula)) return undefined;
  const field = inputs[formula.field];
  return field && (field.type === "range" || field.type === "number") ? formula.field : undefined;
}

function readDrawing(raw: unknown, inputs: Field[]): SimulationDrawing | undefined {
  const drawing = object(raw);
  const bounds = drawing?.bounds;
  if (!drawing || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(number) ||
    bounds[2] - bounds[0] < 1e-9 || bounds[3] - bounds[1] < 1e-9) return undefined;
  const points = new Map<string, SimulationDrawing["points"][number]>();
  for (const item of list(drawing.points, 20)) {
    const row = object(item);
    const id = text(row?.id, 40);
    const x = readFormula(row?.x, inputs);
    const y = readFormula(row?.y, inputs);
    if (!id || points.has(id) || x === null || y === null) continue;
    const dragX = row?.drag === true ? directNumericField(x, inputs) : undefined;
    const dragY = row?.drag === true ? directNumericField(y, inputs) : undefined;
    points.set(id, { id, x, y, label: text(row?.label, 60), dragX, dragY: dragY === dragX ? undefined : dragY });
  }
  const shapes = list(drawing.shapes, 16).flatMap<SimulationDrawing["shapes"][number]>(item => {
    const row = object(item);
    if (row?.kind === "circle") {
      const center = text(row.center, 40);
      const radius = readFormula(row.radius, inputs);
      return points.has(center) && radius !== null ? [{ kind: "circle", center, radius }] : [];
    }
    if (row?.kind && row.kind !== "path") return [];
    const ids = list(row?.points, 20);
    if (ids.length < 2 || !ids.every((id): id is string => typeof id === "string" && points.has(id))) return [];
    const closed = row?.closed === true && ids.length >= 3;
    return [{ kind: "path", points: ids, closed, arrow: !closed && row?.arrow === true }];
  });
  return points.size ? { title: text(drawing.title, 120) || "Figure", bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    points: [...points.values()], shapes } : undefined;
}

function readScene(raw: unknown, inputs: Field[]): SimulationScene | undefined {
  const scene = object(raw);
  const bounds = scene?.bounds;
  if (!scene || !Array.isArray(bounds) || bounds.length !== 6 || !bounds.every(number)) return undefined;
  const [x0, y0, z0, x1, y1, z1] = bounds;
  if (Math.min(x1 - x0, y1 - y0, z1 - z0) < 1e-9) return undefined;

  function position(rawPosition: unknown): ScenePosition | undefined {
    if (!Array.isArray(rawPosition) || rawPosition.length !== 3) return undefined;
    const [x, y, z] = rawPosition.map(value => readFormula(value, inputs));
    return x !== null && y !== null && z !== null ? [x, y, z] : undefined;
  }
  const color = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "";
  const objects = list(scene.objects, 4).flatMap<SceneObject>(item => {
    const row = object(item);
    if (!row) return [];
    const center = position(row.center);
    if (!center) return [];
    const fill = color(row.color);
    if (row.kind === "box") {
      const size = position(row.size);
      return size ? [{ kind: "box", center, size, color: fill }] : [];
    }
    const radius = readFormula(row.radius, inputs);
    if (radius === null) return [];
    if (row.kind === "sphere") return [{ kind: "sphere", center, radius, color: fill }];
    if (row.kind !== "cylinder" && row.kind !== "cone") return [];
    const height = readFormula(row.height, inputs);
    return height === null ? [] : [{ kind: row.kind, center, radius, height, color: fill }];
  });
  const points = new Map<string, SimulationScene["points"][number]>();
  for (const item of list(scene.points, 36)) {
    const row = object(item);
    const id = text(row?.id, 40);
    const point = position(row?.position);
    if (id && point && !points.has(id)) points.set(id, { id, position: point, label: text(row?.label, 60) });
  }
  const faces = list(scene.faces, 48).flatMap(item => {
    const row = object(item);
    const ids = list(row?.points, 12);
    return ids.length >= 2 && new Set(ids).size === ids.length &&
      ids.every((id): id is string => typeof id === "string" && points.has(id)) ? [{ ids, color: color(row?.color) }] : [];
  });
  return objects.length || points.size ? { title: text(scene.title, 120) || "Figure 3D",
    bounds: [[x0, y0, z0], [x1, y1, z1]], objects, points: [...points.values()], faces } : undefined;
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
      const plot = row.kind === "simulator" ? readPlot(row.plot, inputs) : undefined;
      const drawing = row.kind === "simulator" ? readDrawing(row.drawing, inputs) : undefined;
      const playback = row.kind === "simulator" ? readPlayback(row.playback, inputs) : undefined;
      const scene = row.kind === "simulator" ? readScene(row.scene, inputs) : undefined;
      if ((!inputs.length && !scene) || (row.kind === "simulator" && !results.length && !plot && !drawing && !scene)) return null;
      return { kind: row.kind, title: title || (row.kind === "form" ? "Formulaire" : "Simulation"), fields: inputs, results,
        plot, drawing, playback, scene, equation: text(row.equation, 300), explanation: text(row.explanation, 1200) };
    }
    case "editor": {
      const body = text(row.text, 16_000).replace(/\r\n?/g, "\n");
      return body ? { kind: "editor", title: title || "Document", text: body } : null;
    }
    default: return null;
  }
}
