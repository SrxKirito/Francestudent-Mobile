import { providerLabel } from "../utils/agents.ts";
import { DEFAULT_AGENT_ID } from "../utils/state.ts";
import { errorMessage } from "../utils/errors.ts";
import type { Theme } from "../types/state.ts";
import type { ApiClient } from "./api-client.ts";
import type { EngineAgent, EngineHost, ShellEngine } from "./legacy-engine.ts";
import { NO_ARCHIVE, NO_REMOTE_SEARCH } from "./legacy-engine.ts";
import type { NativeConversations } from "./native-conversations.ts";
import { projectChats, projectPath, projectResult } from "./projects.ts";
import type { Project, ProjectChat } from "./projects.ts";

type RemoteChat = ProjectChat & { projectId?: string | null };
type RemotePage = { chats: RemoteChat[]; hasMore?: boolean };
type NativeRequest = (path: string, options?: { accept?: string; signal?: AbortSignal }) => Promise<Response>;

export async function loadAgentCatalog(api: ApiClient, signal: AbortSignal): Promise<EngineAgent[]> {
  try {
    const result = await api.json("/chats/agents?include-disabled=true", { signal })
      .catch(() => api.json("/chats/agents", { signal }));
    const rows = Array.isArray(result) ? result : (result as { agents?: unknown[] } | null)?.agents;
    if (!Array.isArray(rows)) throw new Error("Liste de modèles illisible.");
    const agents = new Map<number, EngineAgent>();
    for (const item of rows) {
      if (!item || typeof item !== "object" || item.id === null || item.id === "" || !Number.isInteger(Number(item.id))) continue;
      const id = Number(item.id);
      const name = String(item.name || item.model || id);
      const model = typeof item.model === "string" ? item.model : "";
      agents.set(id, { id, name, model, provider: providerLabel(item.modelProvider || item.provider, name + " " + model),
        available: item.isActive !== false, isDefault: item.isDefault === true });
    }
    if (agents.size) return [...agents.values()];
  } catch {
    if (signal.aborted) return [];
  }
  return [{ id: DEFAULT_AGENT_ID, name: "Modèle par défaut", provider: "", available: true, isDefault: true }];
}

export interface NativeShellOptions {
  api: ApiClient;
  request: NativeRequest;
  repository: NativeConversations;
  ready(): boolean;
  busy(): boolean;
  agents(): EngineAgent[];
  profile(): { label: string; avatar: string };
  theme(): Theme;
  refreshAgent(): void;
  confirm(text: string): Promise<boolean>;
  rename(title: string): Promise<string | null>;
  notify(text: string, isError?: boolean): void;
  saveResponse(name: string, response: Response): Promise<unknown>;
}

export function createNativeShell(deps: NativeShellOptions): ShellEngine {
  const { api, repository } = deps;
  let host: EngineHost | null = null;
  let lifetime = new AbortController();
  let unsubscribe: (() => void) | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searching: AbortController | null = null;
  let query = "";
  let composing = false;
  let remote: RemoteChat[] = [];
  let remoteStatus = "";
  let archiveOpen = false;
  let archiveLoading = false;
  let archiveMore = false;
  let archiveError = false;
  let archiveStatus = "";
  let archiveCursor = "";
  let navigation = 0;
  const archiveRows = new Map<string, RemoteChat>();
  const archiveBusy = new Set<string>();
  const mutations = new Set<string>();
  const notify = () => host?.changed();

  async function act(task: (signal: AbortSignal) => Promise<unknown>, prefix: string) {
    const signal = lifetime.signal;
    try { await task(signal); }
    catch (error) {
      if (!signal.aborted) deps.notify(prefix + errorMessage(error), true);
    }
  }

  function canNavigate() {
    if (deps.busy()) { deps.notify("Attends la fin de la réponse en cours.", true); return false; }
    return deps.ready();
  }

  async function open(id: string, signal: AbortSignal) {
    const row = repository.get(id);
    if (!canNavigate() || !row || row.serverArchived) return;
    const turn = ++navigation;
    const projectId = row.projectId || null;
    if (projectId && projectId !== repository.projectId()) {
      const [data, chats, owned] = await Promise.all([
        api.json<Partial<Project>>(projectPath(projectId), { signal }), projectChats(api, projectId, signal),
        api.json<Project[] | { projects?: Project[]; data?: Project[] }>("/projects", { signal }).catch(() => [])
      ]);
      if (signal.aborted || turn !== navigation || !canNavigate()) return;
      const items = Array.isArray(owned) ? owned : owned?.projects ?? owned?.data ?? [];
      repository.setProject(projectResult(data, !items.some(item => item.id === projectId)), chats);
    } else if (!projectId && repository.projectId()) repository.setProject(null);
    if (signal.aborted || turn !== navigation || !repository.get(id)) return;
    repository.select(id);
    deps.refreshAgent();
    host?.closeSidebar();
    await repository.detail(id);
    if (repository.currentId() === id) deps.refreshAgent();
  }

  function scheduleSearch(value: string, force = false) {
    const next = value.trim();
    if (!force && query === next) return;
    query = next;
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
    searching?.abort();
    searching = null;
    remote = [];
    remoteStatus = "";
    if (!next || composing || !deps.ready()) { notify(); return; }
    const controller = searching = new AbortController();
    remoteStatus = "Recherche en ligne…";
    notify();
    searchTimer = setTimeout(async () => {
      searchTimer = null;
      try {
        const result = await api.json<RemotePage>("/chats/search?" + new URLSearchParams({ query: next, limit: "20" }), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!Array.isArray(result?.chats)) throw new Error("Résultats du serveur illisibles.");
        remote = [...new Map(result.chats.filter(row => row?.id && repository.canShow(row)).map(row => [row.id, row])).values()];
        remoteStatus = "Résultats en ligne : " + remote.length + (result.hasMore ? " · résultats limités" : "");
      } catch (error) {
        if (!controller.signal.aborted) remoteStatus = "Recherche en ligne indisponible : " + errorMessage(error);
      }
      if (!controller.signal.aborted) notify();
    }, 350);
  }

  async function mutation(id: string, prefix: string, task: (signal: AbortSignal) => Promise<void>) {
    if (mutations.has(id) || !repository.get(id)) return;
    mutations.add(id);
    try { await act(task, prefix); }
    finally { mutations.delete(id); }
  }

  const chatPath = (id: string) => "/chats/" + encodeURIComponent(id);

  async function loadArchives() {
    if (!archiveOpen || archiveLoading) return;
    archiveLoading = true;
    archiveError = false;
    archiveStatus = "Chargement des archives…";
    notify();
    const signal = lifetime.signal;
    const params = new URLSearchParams({ limit: "20" });
    if (archiveCursor) params.set("cursor_chat_id", archiveCursor);
    try {
      const result = await api.json<RemotePage>("/chats/archived?" + params, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(result?.chats)) throw new Error("Liste d’archives invalide.");
      const last = result.chats.at(-1)?.id;
      if (result.hasMore && (!last || last === archiveCursor)) throw new Error("Curseur de pagination indisponible.");
      for (const row of result.chats) {
        if (!row?.id || !repository.canShow(row)) continue;
        archiveRows.set(row.id, row);
        const local = repository.all().find(item => item.chatId === row.id);
        if (local && !local.pendingResponse) local.serverArchived = true;
      }
      repository.commit();
      archiveCursor = last ?? archiveCursor;
      archiveMore = result.hasMore === true;
      archiveStatus = archiveRows.size ? "" : "Aucune conversation archivée.";
    } catch (error) {
      if (signal.aborted) return;
      archiveError = true;
      archiveStatus = "Chargement impossible : " + errorMessage(error);
    } finally { archiveLoading = false; notify(); }
  }

  async function archiveAction(chatId: string, restore: boolean) {
    if (archiveBusy.has(chatId) || !archiveRows.has(chatId) || (restore && !canNavigate())) return;
    archiveBusy.add(chatId);
    notify();
    await act(async signal => {
      if (!restore) {
        const response = await deps.request(chatPath(chatId) + "/archive/download", { accept: "application/json", signal });
        if (!response.ok) { void response.body?.cancel(); throw new Error("Erreur " + response.status); }
        await deps.saveResponse("conversation-" + chatId + ".json", response);
        if (!signal.aborted) deps.notify("Archive enregistrée.");
        return;
      }
      await api.json(chatPath(chatId) + "/restore", { method: "PUT", signal });
      if (signal.aborted) return;
      const server = archiveRows.get(chatId);
      if (server) {
        const local = repository.mergeServer(server);
        if (local) { delete local.serverArchived; local.needsLoad = !local.pendingResponse; }
        repository.commit();
      }
      archiveRows.delete(chatId);
      if (!archiveRows.size && !archiveMore) archiveStatus = "Aucune conversation archivée.";
      deps.notify("Conversation restaurée.");
    }, restore ? "Restauration impossible : " : "Téléchargement impossible : ");
    archiveBusy.delete(chatId);
    notify();
  }

  return {
    attach(next) {
      if (lifetime.signal.aborted) lifetime = new AbortController();
      host = next;
      unsubscribe = repository.subscribe(notify);
    },
    detach() {
      host = null;
      lifetime.abort();
      searching?.abort();
      if (searchTimer !== null) clearTimeout(searchTimer);
      unsubscribe?.();
    },
    snapshot() {
      const { label, avatar } = deps.profile();
      const project = repository.project();
      return {
        ready: deps.ready(), currentId: repository.currentId(), projectId: repository.projectId(),
        project: project ? { name: project.name, sharedWithMe: project.sharedWithMe } : null, projectStatus: "",
        userName: label, avatar, theme: deps.theme(), settingsOpen: false, agents: deps.agents(),
        conversations: repository.all().filter(row => !row.serverLocked && !row.serverArchived).map(row =>
          ({ id: row.id, title: row.title, pinned: row.pinned, projectId: row.projectId, agentId: row.agentId,
            agentName: row.agentName, agentProvider: row.agentProvider, updatedAt: row.updatedAt, chatId: row.chatId })),
        archive: { ...NO_ARCHIVE, available: true, open: archiveOpen, status: archiveStatus,
          rows: [...archiveRows.values()].map(row => ({ id: row.id, title: row.title || "Sans titre", busy: archiveBusy.has(row.id) })),
          moreHidden: !archiveMore && !archiveError, moreDisabled: archiveLoading, moreLabel: archiveError ? "Réessayer" : "Charger plus" },
        remoteSearch: remoteStatus ? { status: remoteStatus, results: remote.map(row => (row.title || "Sans titre") + (row.projectId ? " · Projet" : "")) } : NO_REMOTE_SEARCH
      };
    },
    matches(value) {
      const wanted = value.trim().toLowerCase();
      return new Set(repository.all().filter(row => !row.serverArchived && !row.serverLocked &&
        [row.title ?? "", ...row.messages.map(message => message.content)].some(text => String(text).toLowerCase().includes(wanted)))
        .map(row => row.id));
    },
    setLayout() {},
    closeMenus() {},
    act(action) {
      if (!["new-chat", "leave-project"].includes(action) || !canNavigate()) return;
      navigation++;
      if (action === "leave-project") repository.setProject(null);
      else repository.select(null);
      deps.refreshAgent();
      host?.closeSidebar();
    },
    openConversation(id) { void act(signal => open(id, signal), "Ouverture impossible : "); },
    togglePin(id) {
      void mutation(id, "Épinglage impossible : ", async signal => {
        const row = repository.get(id);
        if (!row) return;
        const pinned = !row.pinned;
        if (row.chatId) await api.json(chatPath(row.chatId) + "/pins", { method: pinned ? "PUT" : "DELETE", signal });
        if (signal.aborted) return;
        row.pinned = pinned;
        repository.commit();
      });
    },
    renameConversation(id) {
      void mutation(id, "Renommage impossible : ", async signal => {
        const row = repository.get(id);
        if (!row) return;
        const title = (await deps.rename(row.title || ""))?.trim().slice(0, 100);
        if (!title || title === row.title || signal.aborted) return;
        if (row.chatId) await api.json(chatPath(row.chatId), { method: "PATCH", body: { title }, signal });
        if (signal.aborted) return;
        row.title = title;
        repository.commit();
      });
    },
    deleteConversation(id) {
      void mutation(id, "Suppression impossible : ", async signal => {
        const row = repository.get(id);
        if (!row || !canNavigate()) return;
        if (!await deps.confirm("Supprimer la conversation « " + (row.title || "Sans titre") + " » ?") || signal.aborted || !canNavigate()) return;
        if (row.pendingResponse) { deps.notify("Annule la réponse en attente avant de supprimer la discussion.", true); return; }
        if (row.chatId) await api.json(chatPath(row.chatId), { method: "DELETE", signal });
        if (!signal.aborted) repository.remove(id);
      });
    },
    archiveConversation(id) {
      void mutation(id, "Archivage impossible : ", async signal => {
        const row = repository.get(id);
        if (!row || !canNavigate()) return;
        if (row.pendingResponse || !row.chatId) { deps.notify("Seule une discussion synchronisée sans réponse en cours peut être archivée.", true); return; }
        if (!await deps.confirm("Archiver « " + (row.title || "Sans titre") + " » ?") || signal.aborted || !canNavigate()) return;
        await api.json(chatPath(row.chatId) + "/archive", { method: "PUT", signal });
        if (signal.aborted) return;
        row.serverArchived = true;
        archiveRows.set(row.chatId, { id: row.chatId, title: row.title, projectId: row.projectId });
        if (repository.currentId() === id) repository.select(null);
        repository.commit();
        deps.notify("Conversation archivée.");
      });
    },
    search: scheduleSearch,
    composition(active) { composing = active; scheduleSearch(query, true); },
    toggleArchive() {
      archiveOpen = !archiveOpen;
      if (archiveOpen && !archiveRows.size) void loadArchives();
      notify();
    },
    restoreArchived(id) { void archiveAction(id, true); },
    downloadArchived(id) { void archiveAction(id, false); },
    moreArchived() { void loadArchives(); },
    openRemote(index) {
      const row = remote[index];
      if (!row || !canNavigate() || !repository.canShow(row)) return;
      void act(async signal => {
        if (signal.aborted) return;
        const local = repository.mergeServer(row, "projectId" in row ? row.projectId || null : undefined);
        if (local) await open(local.id, signal);
      }, "Ouverture impossible : ");
    }
  };
}
