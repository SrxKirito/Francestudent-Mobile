import type { ChartSeries } from "./interactive-content.ts";
import { number, object, parseWidget, text, type Cell } from "./interactive-widgets.ts";

type Aggregate = { op: "count" } | { op: "sum" | "average" | "min" | "max"; column: number };
type Metric = { label: string; unit: string; aggregate: Aggregate };
export type DashboardChart = { label: string; chart: "bar" | "line" | "pie"; group: number; aggregate: Aggregate };
export interface InteractiveDashboard {
  kind: "dashboard";
  title: string;
  description: string;
  columns: string[];
  rows: Cell[][];
  filters: number[];
  metrics: Metric[];
  charts: DashboardChart[];
}

export function dashboardCellLabel(cell: Cell): string {
  if (cell === null || cell === "") return "Non renseigné";
  if (typeof cell === "boolean") return cell ? "Oui" : "Non";
  return String(cell);
}

function columnIndex(value: unknown, count: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;
}

function parseAggregate(row: Record<string, unknown>, size: number): Aggregate | null {
  const op = row.op;
  if (op === "count") return { op };
  if ((op !== "sum" && op !== "average" && op !== "min" && op !== "max") || !columnIndex(row.column, size)) return null;
  return { op, column: row.column };
}

export function parseDashboard(row: Record<string, unknown>, title: string): InteractiveDashboard | null {
  const table = parseWidget({ kind: "table", columns: row.columns, rows: row.rows }, title);
  if (!table || table.kind !== "table") return null;
  const size = table.columns.length;
  const filters = Array.isArray(row.filters)
    ? [...new Set(row.filters.filter(value => columnIndex(value, size)))].slice(0, 4) : [];
  const metrics = (Array.isArray(row.metrics) ? row.metrics.slice(0, 6) : []).flatMap(raw => {
    const item = object(raw);
    if (!item) return [];
    const label = text(item.label, 80);
    const aggregate = parseAggregate(item, size);
    return label && aggregate ? [{ label, unit: aggregate.op === "count" ? "" : text(item.unit, 24), aggregate }] : [];
  });
  const charts = (Array.isArray(row.charts) ? row.charts.slice(0, 4) : []).flatMap<DashboardChart>(raw => {
    const item = object(raw);
    if (!item || !columnIndex(item.group, size)) return [];
    const { group, chart } = item;
    if (chart !== "bar" && chart !== "line" && chart !== "pie") return [];
    const aggregate = parseAggregate(item, size);
    const label = text(item.label, 100);
    return label && aggregate ? [{ label, chart, group, aggregate }] : [];
  });
  if (!charts.length && !metrics.length && !filters.length) return null;
  return { kind: "dashboard", title: title || "Tableau de bord", description: text(row.description, 600),
    columns: table.columns, rows: table.rows, filters, metrics, charts };
}

export function dashboardRows(dashboard: InteractiveDashboard, filters: ReadonlyMap<number, Cell>, search: string): Cell[][] {
  const query = search.trim().toLocaleLowerCase("fr");
  return dashboard.rows.filter(row => [...filters].every(([column, value]) => row[column] === value) &&
    (!query || row.some(cell => dashboardCellLabel(cell).toLocaleLowerCase("fr").includes(query))));
}

export function dashboardValue(rows: Cell[][], aggregate: Aggregate): number | null {
  if (aggregate.op === "count") return rows.length;
  const values = rows.flatMap(row => number(row[aggregate.column]) ? [row[aggregate.column] as number] : []);
  if (!values.length) return null;
  if (aggregate.op === "min") return Math.min(...values);
  if (aggregate.op === "max") return Math.max(...values);
  const sum = values.reduce((total, value) => total + value, 0);
  return aggregate.op === "average" ? sum / values.length : sum;
}

export function dashboardSeries(rows: Cell[][], chart: DashboardChart): { series: ChartSeries[]; omitted: boolean } {
  const groups = new Map<Cell, Cell[][]>();
  for (const row of rows) {
    const key = row[chart.group];
    const items = groups.get(key);
    if (items) items.push(row);
    else groups.set(key, [row]);
  }
  const points = [...groups].flatMap(([key, items]) => {
    const value = dashboardValue(items, chart.aggregate);
    return value === null || (chart.chart === "pie" && value <= 0) ? [] : [{ label: dashboardCellLabel(key), y: value }];
  });
  const limit = chart.chart === "pie" ? 12 : 60;
  return { series: points.length ? [{ name: chart.label, points: points.slice(0, limit).map((point, x) => ({ ...point, x })) }] : [],
    omitted: points.length > limit || (chart.chart === "pie" && points.length !== groups.size) };
}

export function dashboardCsv(columns: string[], rows: Cell[][]): string {
  const encode = (cell: Cell) => {
    let value = cell === null ? "" : typeof cell === "boolean" ? dashboardCellLabel(cell) : String(cell);
    if (typeof cell === "string" && /^[\u0000-\u0020\u007f-\u009f]*[=+@\-]/.test(value.normalize("NFKC"))) value = "'" + value;
    return '"' + value.replace(/"/g, '""') + '"';
  };
  return [columns, ...rows].map(row => row.map(encode).join(",")).join("\r\n") + "\r\n";
}
