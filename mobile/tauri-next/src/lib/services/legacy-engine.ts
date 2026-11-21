import type { Agent } from "../types/agent.ts";
import type { Conversation } from "../types/conversation.ts";
import type { SidebarProject } from "../types/sidebar.ts";
import type { Theme } from "../types/state.ts";

// Liaison avec le moteur de l'ancienne interface (iframe, même origine) : `window.__fsEngine`, défini par svelte-engine.js.
// Tant que le chat reste dans l'iframe, l'état (discussions, projet, compte) y est écrit et la coque Svelte le lit ici ;
// elle ne l'écrit jamais elle-même. Les valeurs voyagent en JSON pour ne garder aucune référence vers l'iframe.

export type EngineAgent = Pick<Agent, "id" | "name" | "provider" | "available"> & Partial<Pick<Agent, "model" | "isDefault">>;

/** Une ligne du panneau « Conversations archivées » (identifiant serveur, pas celui de l'appareil). */
export interface ArchivedRow {
  id: string;
  title: string;
  /** Restauration ou téléchargement en cours : les boutons de la ligne sont inactifs. */
  busy: boolean;
}

/** Panneau des archives, tel que l'ancienne interface (archived-chats.js) le montre. */
export interface ArchiveState {
  /** Le script des archives est présent dans l'ancienne interface. */
  available: boolean;
  open: boolean;
  status: string;
  rows: ArchivedRow[];
  moreHidden: boolean;
  moreLabel: string;
  moreDisabled: boolean;
}

/** Résultats de la recherche sur le serveur (remote-chat-search.js) : seulement ce qui est affiché. */
export interface RemoteSearchState {
  status: string;
  /** Titres des résultats, dans l'ordre ; on les ouvre par leur rang. */
  results: string[];
}

export const NO_ARCHIVE: ArchiveState = { available: false, open: false, status: "", rows: [], moreHidden: true, moreLabel: "", moreDisabled: false };
export const NO_REMOTE_SEARCH: RemoteSearchState = { status: "", results: [] };

export interface EngineSnapshot {
  /** L'ancienne interface a fini de démarrer (son écran de chargement est parti). */
  ready: boolean;
  /** Discussions SANS leurs messages, hors archivées et verrouillées (l'ancienne liste ne les montre pas non plus). */
  conversations: Conversation[];
  archive: ArchiveState;
  remoteSearch: RemoteSearchState;
  currentId: string | null;
  project: SidebarProject | null;
  /** Identifiant du projet ouvert (filtre de l'historique) ; `null` = page principale. */
  projectId: string | null;
  projectStatus: string;
  userName: string;
  /** Vide = logo France Student par défaut. */
  avatar: string;
  settingsOpen: boolean;
  theme: Theme;
  agents: EngineAgent[];
}

/** Ce que la coque offre au moteur : il l'appelle quand son état change ou qu'il veut piloter la barre latérale. */
export interface EngineHost {
  changed(): void;
  openSidebar(): void;
  closeSidebar(): void;
  menuToggle(): void;
  closeMenus(): void;
}

export type EngineAction = "new-chat" | "projects" | "library" | "project-settings" | "leave-project" | "settings";

export interface EngineLayout {
  /** La barre latérale de la coque est affichée en permanence (grand écran, non repliée). */
  sidebarVisible: boolean;
  collapsed: boolean;
}

export interface ShellEngine {
  attach(host: EngineHost): void;
  detach(): void;
  snapshot(): EngineSnapshot;
  /** Identifiants des discussions dont le titre ou les messages contiennent `query` (règle de l'ancienne recherche). */
  matches(query: string): Set<string>;
  setLayout(layout: EngineLayout): void;
  act(action: EngineAction): void;
  closeMenus(): void;
  openConversation(id: string): void;
  togglePin(id: string): void;
  renameConversation(id: string): void;
  deleteConversation(id: string): void;
  /** Archive une discussion sur le serveur (confirmation demandée par l'ancienne interface). */
  archiveConversation(id: string): void;
  /** Recopie la recherche de la coque dans l'ancien champ : déclenche la recherche locale et celle du serveur. */
  search(query: string): void;
  /** Début ou fin de saisie composée (la recherche sur le serveur attend la fin). */
  composition(active: boolean): void;
  toggleArchive(): void;
  restoreArchived(chatId: string): void;
  downloadArchived(chatId: string): void;
  moreArchived(): void;
  /** Ouvre le résultat de recherche du serveur de rang `index`. */
  openRemote(index: number): void;
}

export type LegacyEngine = ShellEngine;

/** Forme brute exposée par svelte-engine.js. */
interface RawEngine {
  attach(host: EngineHost): void;
  detach(): void;
  snapshot(): string;
  matches(query: string): string;
  setLayout(layout: EngineLayout): void;
  act(action: string): void;
  closeMenus(): void;
  openConversation(id: string): void;
  togglePin(id: string): void;
  renameConversation(id: string): void;
  deleteConversation(id: string): void;
  archiveConversation(id: string): void;
  search(query: string): void;
  composition(active: boolean): void;
  toggleArchive(): void;
  restoreArchived(chatId: string): void;
  downloadArchived(chatId: string): void;
  moreArchived(): void;
  openRemote(index: number): void;
}

const METHODS = [
  "attach", "detach", "snapshot", "matches", "setLayout", "act", "closeMenus",
  "openConversation", "togglePin", "renameConversation", "deleteConversation", "archiveConversation",
  "search", "composition", "toggleArchive", "restoreArchived", "downloadArchived", "moreArchived", "openRemote"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bridgeId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
}

function toConversation(raw: Record<string, unknown>): Conversation | null {
  const id = bridgeId(raw.id);
  if (id === null) return null;
  const conversation: Conversation = { id, projectId: bridgeId(raw.projectId) };
  if (typeof raw.title === "string") conversation.title = raw.title;
  if (typeof raw.updatedAt === "number") conversation.updatedAt = raw.updatedAt;
  if (raw.pinned === true) conversation.pinned = true;
  if (typeof raw.agentId === "number") conversation.agentId = raw.agentId;
  if (typeof raw.agentName === "string") conversation.agentName = raw.agentName;
  if (typeof raw.agentProvider === "string") conversation.agentProvider = raw.agentProvider;
  return conversation;
}

function toAgent(raw: unknown): EngineAgent | null {
  if (!isRecord(raw) || typeof raw.id !== "number") return null;
  // Un pont plus ancien n'envoie pas « available » : le modèle est alors considéré disponible (comportement d'avant).
  return { id: raw.id, name: text(raw.name), provider: text(raw.provider), available: raw.available !== false };
}

function toTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

function toArchive(raw: unknown): ArchiveState {
  if (!isRecord(raw) || raw.available !== true) return NO_ARCHIVE;
  const rows: ArchivedRow[] = [];
  if (Array.isArray(raw.rows)) {
    for (const item of raw.rows) {
      if (isRecord(item) && typeof item.id === "string" && item.id !== "") rows.push({ id: item.id, title: text(item.title), busy: item.busy === true });
    }
  }
  return {
    available: true,
    open: raw.open === true,
    status: text(raw.status),
    rows,
    moreHidden: raw.moreHidden !== false,
    moreLabel: text(raw.moreLabel),
    moreDisabled: raw.moreDisabled === true
  };
}

function toRemoteSearch(raw: unknown): RemoteSearchState {
  if (!isRecord(raw)) return NO_REMOTE_SEARCH;
  const results = Array.isArray(raw.results) ? raw.results.filter((title): title is string => typeof title === "string") : [];
  return { status: text(raw.status), results };
}

export function parseSnapshot(json: string): EngineSnapshot {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw) || !Array.isArray(raw.conversations)) throw new Error("Instantané du moteur historique invalide");
  const conversations: Conversation[] = [];
  for (const item of raw.conversations) {
    const conversation = isRecord(item) ? toConversation(item) : null;
    if (conversation) conversations.push(conversation);
  }
  const agents: EngineAgent[] = [];
  if (Array.isArray(raw.agents)) {
    for (const item of raw.agents) {
      const agent = toAgent(item);
      if (agent) agents.push(agent);
    }
  }
  const project = isRecord(raw.project) ? { name: text(raw.project.name), sharedWithMe: raw.project.sharedWithMe === true } : null;
  return {
    ready: raw.ready === true,
    conversations,
    archive: toArchive(raw.archive),
    remoteSearch: toRemoteSearch(raw.remoteSearch),
    currentId: bridgeId(raw.currentId),
    project,
    projectId: project ? bridgeId(raw.projectId) : null,
    projectStatus: text(raw.projectStatus),
    userName: text(raw.userName) || "Mon compte",
    avatar: text(raw.avatar),
    settingsOpen: raw.settingsOpen === true,
    theme: toTheme(raw.theme),
    agents
  };
}

export function parseIds(json: string): Set<string> {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Résultat de recherche du moteur historique invalide");
  return new Set(raw.map(bridgeId).filter((id): id is string => id !== null));
}

function isRawEngine(value: unknown): value is RawEngine {
  return isRecord(value) && METHODS.every(method => typeof value[method] === "function");
}

/**
 * Se relie au moteur d'une fenêtre d'iframe. Renvoie `null` si la fenêtre n'est pas accessible (autre origine,
 * iframe pas encore chargée) ou si le script de pont n'est pas dans la page.
 */
export function connectLegacyEngine(frameWindow: unknown): LegacyEngine | null {
  let raw: unknown;
  try {
    raw = typeof frameWindow === "object" && frameWindow !== null ? (frameWindow as Record<string, unknown>).__fsEngine : undefined;
  } catch {
    return null;
  }
  if (!isRawEngine(raw)) return null;
  const engine = raw;
  return {
    attach: host => engine.attach(host),
    detach: () => engine.detach(),
    snapshot: () => parseSnapshot(engine.snapshot()),
    matches: query => parseIds(engine.matches(query)),
    setLayout: layout => engine.setLayout(layout),
    act: action => engine.act(action),
    closeMenus: () => engine.closeMenus(),
    openConversation: id => engine.openConversation(id),
    togglePin: id => engine.togglePin(id),
    renameConversation: id => engine.renameConversation(id),
    deleteConversation: id => engine.deleteConversation(id),
    archiveConversation: id => engine.archiveConversation(id),
    search: query => engine.search(query),
    composition: active => engine.composition(active),
    toggleArchive: () => engine.toggleArchive(),
    restoreArchived: chatId => engine.restoreArchived(chatId),
    downloadArchived: chatId => engine.downloadArchived(chatId),
    moreArchived: () => engine.moreArchived(),
    openRemote: index => engine.openRemote(index)
  };
}
