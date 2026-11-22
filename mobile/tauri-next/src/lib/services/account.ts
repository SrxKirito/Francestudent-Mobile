import type { ApiClient } from "./api-client.ts";

// Paramètres > Compte : profil, quota du jour, activité en tokens, sessions actives, photo de profil.
// Port des règles et des messages de mobile/www/js/{models,account-activity,settings}.js ; seules les sessions
// (`/user/sessions`) sont nouvelles. Aucun accès au DOM ni à Tauri ici : tout se teste sous Node avec un faux client.

export interface Profile {
  name: string;
  email: string;
  firstName?: string;
}

export type QuotaLevel = "" | "warn" | "danger";

export interface QuotaView {
  /** Part utilisée, bornée entre 0 et 100 (largeur de la barre). */
  percent: number;
  label: string;
  level: QuotaLevel;
  note: string;
}

export interface ActivityRow {
  date: string;
  input: number;
  output: number;
  reasoning: number;
  total: number;
}

export interface ActivityPeak {
  date: string;
  total: number;
  input?: number;
  output?: number;
  reasoning?: number;
}

export interface ActivitySummary {
  rows: ActivityRow[];
  days: Map<string, ActivityRow>;
  total: number;
  input: number;
  output: number;
  reasoning: number;
  active: number;
  average: number;
  peak: ActivityPeak;
  lifetime: number | null;
}

export interface ActivityMetric {
  label: string;
  value: string;
}

export interface ActivityCell {
  date: string;
  level: number;
  reported: boolean;
  label: string;
}

export interface ActivityCalendar {
  cells: ActivityCell[];
  months: string[];
}

export interface UserSession {
  id: string;
  since: string;
  os: string;
  location: string;
  lastActiveAt: string;
}

export const ACTIVITY_DAYS = 343;
export const ACTIVITY_CSV_NAME = "activite-francestudent.csv";
export const ACTIVITY_SHARE_TITLE = "Mon activité FranceStudent";
export const AVATAR_SIZE = 256;
export const AVATAR_QUALITY = 0.85;

const UNREADABLE = "Réponse du serveur illisible.";
const DAY_MS = 86400000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// --- Profil ------------------------------------------------------------------------

export function parseProfile(data: unknown): Profile {
  const record = isRecord(data) ? data : {};
  return { name: text(record.name).trim(), email: text(record.email).trim() };
}

export function profileName(profile: Profile): string {
  return profile.name || profile.email || "Mon compte";
}

export function profileFirstName(profile: Profile): string {
  const name = profile.name.trim();
  const preferred = profile.firstName?.trim();
  return preferred && (name === preferred || name.startsWith(preferred + " ")) ? preferred : name.split(/\s+/, 1)[0];
}

export async function loadProfile(api: ApiClient, signal?: AbortSignal): Promise<Profile> {
  return parseProfile(await api.json("/user/me", { signal }));
}

export async function updateFirstName(api: ApiClient, profile: Profile, value: string, signal?: AbortSignal): Promise<Profile> {
  const firstName = value.trim().replace(/\s+/g, " ").normalize();
  const familyName = profile.name.trim().slice(profileFirstName(profile).length).trim();
  const name = [firstName, familyName].filter(Boolean).join(" ");
  if (!firstName || name.length < 2 || name.length > 100) {
    throw new Error("Saisis un prénom valide. Le nom du compte doit contenir de 2 à 100 caractères.");
  }
  const updated = parseProfile(await api.json("/user/@me", { method: "PATCH", body: { name }, signal }));
  if (updated.name.normalize() !== name.normalize()) throw new Error("Le serveur n’a pas confirmé le prénom.");
  return { name: updated.name, email: updated.email || profile.email, firstName };
}

// --- Quota du jour ---------------------------------------------------------------------

export const compactNumber = (value: number): string => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
export const exactNumber = (value: number): string => new Intl.NumberFormat("fr-FR").format(value);

function clock(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function shortDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function formatReset(value: unknown, now: Date): string {
  if (!value || (typeof value !== "string" && typeof value !== "number")) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === now.toDateString();
  return "Réinitialisation " + (sameDay ? "à " + clock(date) : "le " + shortDate(date) + " à " + clock(date));
}

export function quotaView(data: unknown, now: Date): QuotaView | null {
  const budget = isRecord(data) ? data.chatBudget : null;
  if (!isRecord(budget)) return null;
  const percent = Math.max(0, Math.min(100, Number(budget.usedPercent) || 0));
  const level: QuotaLevel = percent >= 90 ? "danger" : percent >= 70 ? "warn" : "";
  const detail = Math.round(Number(budget.remainingPercent) || 0) + " % restant";
  const note = [detail, formatReset(budget.resetAt, now)].filter(Boolean).join(" \u00B7 ");
  return { percent, label: Math.round(percent) + " %", level, note };
}

export async function loadQuota(api: ApiClient, signal?: AbortSignal, now: Date = new Date()): Promise<QuotaView | null> {
  return quotaView(await api.json("/user/usage", { signal }), now);
}

// --- Activité en tokens ---------------------------------------------------------------------

export function summarizeActivity(data: unknown): ActivitySummary {
  const record = isRecord(data) ? data : {};
  const days = new Map<string, ActivityRow>();
  const source = Array.isArray(record.last7DaysTokenUsage) ? record.last7DaysTokenUsage : [];
  const count = (value: unknown): number => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const date = String(entry.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    days.set(date, {
      date,
      input: count(entry.inputTokens),
      output: count(entry.outputTokens),
      reasoning: count(entry.reasoningTokens),
      total: entry.totalTokens != null ? count(entry.totalTokens) : count(entry.inputTokens) + count(entry.outputTokens)
    });
  }
  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (key: "input" | "output" | "reasoning" | "total"): number => rows.reduce((total, row) => total + row[key], 0);
  const peak = rows.reduce<ActivityPeak>((best, row) => (row.total > best.total ? row : best), { date: "", total: 0 });
  const lifetime = typeof record.totalTokenCount === "number" && Number.isFinite(record.totalTokenCount) ? record.totalTokenCount : null;
  return {
    rows,
    days,
    total: sum("total"),
    input: sum("input"),
    output: sum("output"),
    reasoning: sum("reasoning"),
    active: rows.filter(row => row.total > 0).length,
    average: rows.length ? sum("total") / rows.length : 0,
    peak,
    lifetime
  };
}

export function activityMetrics(summary: ActivitySummary): ActivityMetric[] {
  const filled = summary.rows.length > 0;
  const entries: [string, number | null][] = [
    ["Tokens totaux", summary.lifetime],
    ["Pic journalier", filled ? summary.peak.total : null],
    ["Jours actifs", filled ? summary.active : null],
    ["Moyenne / jour renseigné", filled ? summary.average : null]
  ];
  return entries.map(([label, value]) => ({ label, value: value == null ? "—" : compactNumber(value) }));
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau de l'application, comme le calendrier historique. */
export function todayInParis(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function activityCalendar(summary: ActivitySummary, todayKey: string): ActivityCalendar {
  const end = new Date(todayKey + "T00:00:00Z");
  const start = new Date(end.getTime() - (ACTIVITY_DAYS - 1) * DAY_MS);
  const monthFormat = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
  const cells: ActivityCell[] = [];
  const months: string[] = [];
  let lastMonth = -1;
  for (let index = 0; index < ACTIVITY_DAYS; index++) {
    const date = new Date(start.getTime() + index * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    if (index % 7 === 0) {
      months.push(date.getUTCMonth() !== lastMonth ? monthFormat.format(date) : "");
      lastMonth = date.getUTCMonth();
    }
    const row = summary.days.get(key);
    const level = row && row.total > 0 ? Math.max(1, Math.ceil((row.total / Math.max(summary.peak.total, 1)) * 4)) : 0;
    cells.push({ date: key, level, reported: !!row, label: key + " : " + (row ? exactNumber(row.total) + " tokens" : "aucune donnée reçue") });
  }
  return { cells, months };
}

export function activityShareText(summary: ActivitySummary): string {
  return ACTIVITY_SHARE_TITLE + " : " + exactNumber(summary.total) + " tokens sur " + summary.rows.length + " jours renseignés, " + summary.active + " jours actifs.";
}

export function activityCsv(summary: ActivitySummary): string {
  return "Date;Input;Output;Reasoning;Total\n" + summary.rows.map(row => [row.date, row.input, row.output, row.reasoning, row.total].join(";")).join("\n");
}

export async function loadActivity(api: ApiClient, signal?: AbortSignal): Promise<ActivitySummary> {
  const data = await api.json("/user/tokenusage?tokenUsageDays=" + ACTIVITY_DAYS, { signal });
  if (!data || typeof data !== "object") throw new Error(UNREADABLE);
  return summarizeActivity(data);
}

// --- Sessions actives (nouveau : absent de l'écran historique) -----------------------------------

export async function listSessions(api: ApiClient, signal?: AbortSignal): Promise<UserSession[]> {
  const data = await api.json("/user/sessions", { signal });
  if (!Array.isArray(data)) throw new Error(UNREADABLE);
  const sessions: UserSession[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    if (!id) continue;
    sessions.push({ id, since: text(entry.since), os: text(entry.os), location: text(entry.location), lastActiveAt: text(entry.lastActiveAt) });
  }
  return sessions;
}

/** « 20 nov. à 18:05 » ; vide si la date est absente ou illisible. */
export function sessionDateLabel(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return shortDate(date) + " à " + clock(date);
}

export async function revokeSession(api: ApiClient, id: string): Promise<void> {
  if (!id) throw new Error("Session inconnue : identifiant manquant.");
  await api.json("/user/sessions/" + encodeURIComponent(id), { method: "DELETE" });
}

export async function revokeAllSessions(api: ApiClient): Promise<void> {
  await api.json("/user/sessions", { method: "DELETE" });
}

// --- Photo de profil ---------------------------------------------------------------------------

export function isAvatarDataUrl(value: unknown): boolean {
  return typeof value === "string" && /^data:image\//i.test(value);
}

export function isImageFile(file: { type?: string } | null | undefined): boolean {
  return String(file?.type || "").startsWith("image/");
}
