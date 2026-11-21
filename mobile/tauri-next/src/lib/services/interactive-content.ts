import { parseStudyContent, type StudyContent } from "./study-content.ts";
import { number, object, parseWidget, text, type InteractiveWidget } from "./interactive-widgets.ts";

type ChartKind = "line" | "bar" | "pie" | "scatter";
export interface ChartPoint { label: string; x: number; y: number }
export interface ChartSeries { name: string; points: ChartPoint[] }
export type InteractiveContent =
  | InteractiveWidget
  | { kind: "study"; content: StudyContent }
  | { kind: "chart"; title: string; chart: ChartKind; numericX?: boolean; series: ChartSeries[] }
  | { kind: "checklist"; title: string; items: string[] }
  | { kind: "accordion" | "popover"; title: string; items: { title: string; content: string }[] };

const chartKinds = ["line", "bar", "pie", "scatter"] as const;
const charts = new Set<string>(chartKinds);

function parseSeries(raw: unknown[], chart: ChartKind, numericX: boolean): ChartSeries[] {
  return raw.slice(0, chart === "pie" ? 1 : 6).flatMap((input, index) => {
    const row = object(input);
    if (!row || !Array.isArray(row.points)) return [];
    const points: ChartPoint[] = row.points.slice(0, chart === "pie" ? 12 : 60).flatMap((item, i) => {
      const point = object(item);
      if (!point || !number(point.y) || (chart === "pie" && point.y <= 0)) return [];
      if (numericX && !number(point.x)) return [];
      const x = numericX && number(point.x) ? point.x : i;
      return [{ label: text(point.label, 80) || String(i + 1), x, y: point.y }];
    });
    return points.length ? [{ name: text(row.name, 80) || "Série " + (index + 1), points }] : [];
  });
}

/** Les réponses transportent des données. Le registre local décide seul de ce qui est rendu. */
export function parseInteractiveContent(language: string, source: string): InteractiveContent | null {
  if (language.toLowerCase() !== "frst-ui") {
    const content = parseStudyContent(language, source);
    return content ? { kind: "study", content } : null;
  }
  if (source.length > 50_000) return null;
  let row: Record<string, unknown> | null;
  try { row = object(JSON.parse(source)); }
  catch { return null; }
  if (!row || row.version !== 1) return null;
  const title = text(row.title, 120);
  if (row.kind === "chart" && typeof row.chart === "string" && charts.has(row.chart) && Array.isArray(row.series)) {
    const chart = row.chart as ChartKind;
    const numericX = chart === "scatter" || (chart === "line" && row.axis === "numeric");
    const series = parseSeries(row.series, chart, numericX);
    return series.length ? { kind: "chart", title: title || "Graphique", chart, numericX, series } : null;
  }
  if (row.kind === "checklist" && Array.isArray(row.items)) {
    const items = row.items.slice(0, 30).map(item => text(item, 300)).filter(Boolean);
    return items.length ? { kind: "checklist", title: title || "Liste à cocher", items } : null;
  }
  if ((row.kind === "accordion" || row.kind === "popover") && Array.isArray(row.items)) {
    const items = row.items.slice(0, 15).flatMap(item => {
      const entry = object(item);
      const heading = text(entry?.title, 120);
      const content = text(entry?.content, 2_000);
      return heading && content ? [{ title: heading, content }] : [];
    });
    return items.length ? { kind: row.kind, title: title || "Détails", items } : null;
  }
  return parseWidget(row, title);
}
