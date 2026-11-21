import type { ApiClient } from "./api-client.ts";

export interface Project {
  id: string;
  name: string;
  customInstructions?: string;
  lastActivityAt?: string;
  updatedAt?: string;
  createdAt?: string;
  sharedWithMe: boolean;
}

export interface ProjectChat {
  id: string;
  title?: string;
}

export interface ProjectShare {
  userId?: number;
  userEmail?: string;
  owner?: boolean;
  permission?: string;
}

const route = (id: string) => "/projects/" + encodeURIComponent(id);
export const projectPath = route;

export function rows<T>(value: unknown, field: string): T[] {
  if (Array.isArray(value)) return value;
  const data = value as Record<string, unknown> | null;
  const result = data?.[field] ?? data?.data ?? data?.items;
  if (!Array.isArray(result)) throw new Error("Liste du serveur illisible.");
  return result;
}

export function projectResult(value: Partial<Project> | null | undefined, sharedWithMe: boolean): Project {
  if (typeof value?.id !== "string" || !value.id) throw new Error("Projet introuvable.");
  return {
    id: value.id, name: typeof value.name === "string" && value.name ? value.name : "Projet",
    customInstructions: typeof value.customInstructions === "string" ? value.customInstructions : undefined,
    lastActivityAt: value.lastActivityAt, updatedAt: value.updatedAt, createdAt: value.createdAt,
    sharedWithMe
  };
}

export async function listProjects(api: ApiClient, signal: AbortSignal) {
  const requests = ["/projects", "/projects/shared"].map((path, index) => api.json(path, { signal }).then(value =>
    (index === 1 && value === null ? [] : rows<Partial<Project>>(value, "projects")).filter(row => typeof row?.id === "string" && row.id).map(row => projectResult(row, index === 1))));
  const [owned, shared] = await Promise.allSettled(requests);
  if (owned.status === "rejected" && shared.status === "rejected") throw new Error("Les deux listes de projets sont indisponibles.");
  const projects = new Map<string, Project>();
  for (const result of [owned, shared]) {
    if (result.status === "fulfilled") for (const project of result.value) if (!projects.has(project.id)) projects.set(project.id, project);
  }
  const message = owned.status === "rejected" ? "Tes projets sont indisponibles." : shared.status === "rejected" ? "Les projets partagés sont indisponibles." : "";
  return { projects: [...projects.values()], message };
}

export async function projectChats(api: ApiClient, id: string, signal: AbortSignal): Promise<ProjectChat[]> {
  const all = new Map<string, ProjectChat>();
  const seen = new Set<string>();
  let cursor = "";
  for (let count = 0; count < 100; count++) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor_chat_id", cursor);
    const response = await api.json<{ chats?: ProjectChat[]; hasMore?: boolean }>(route(id) + "/chats?" + query, { signal });
    const page = rows<ProjectChat>(response, "chats");
    for (const chat of page) if (typeof chat?.id === "string" && chat.id) all.set(chat.id, chat);
    if (response.hasMore !== true) return [...all.values()];
    cursor = page.at(-1)?.id ?? "";
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);
  }
  throw new Error("Pagination des discussions du projet invalide.");
}

export function projectForm(name: string, customInstructions: string) {
  const label = name.trim();
  if (!label || label.length > 50) throw new Error("Indique un nom de 1 à 50 caractères.");
  if (customInstructions.length > 10000) throw new Error("Les instructions sont limitées à 10 000 caractères.");
  return { name: label, customInstructions };
}
