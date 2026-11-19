import type { ArchiveState, EngineAgent, EngineHost, EngineLayout, EngineSnapshot, LegacyEngine, RemoteSearchState } from "../services/legacy-engine.ts";
import { NO_ARCHIVE, NO_REMOTE_SEARCH } from "../services/legacy-engine.ts";
import { PROVIDER_LOGOS } from "../data/provider-logos.ts";
import type { Conversation } from "../types/conversation.ts";
import type { SidebarProject } from "../types/sidebar.ts";
import type { Theme } from "../types/state.ts";
import { agentLabel, conversationAgent, providerMark } from "../utils/agents.ts";
import type { AnchorRect } from "../utils/menu.ts";
import { ConversationsStore } from "./conversations.svelte.ts";

/** Au-delà de cette largeur (en pixels), la barre latérale est fixe ; en dessous, c'est un tiroir (comme l'ancienne interface). */
export const WIDE_ABOVE = 768;

export interface ShellOptions {
  /** Largeur de la fenêtre au démarrage. */
  width: number;
  /** Le thème de l'application a changé (la page parente doit l'appliquer à son propre document). */
  onTheme?: (theme: Theme) => void;
}

export interface OpenMenu {
  id: string;
  anchor: AnchorRect;
}

export type MenuAction = "togglePin" | "renameConversation" | "deleteConversation" | "archiveConversation";

function sameProject(a: SidebarProject | null, b: SidebarProject | null): boolean {
  if (a === b) return true;
  return a !== null && b !== null && a.name === b.name && a.sharedWithMe === b.sharedWithMe;
}

/**
 * État de la coque (barre latérale, tiroir, menu) tel que l'écran l'affiche. Les données viennent de l'ancienne
 * interface via `LegacyEngine` ; la coque ne les écrit jamais, elle demande au moteur d'agir.
 */
export class ShellStore {
  // Initialisé comme champ (et non dans le constructeur) : `menuPinned` ci-dessous le lit. Le rappel n'est appelé
  // qu'à la recherche, longtemps après la construction, donc `#engine` est alors défini.
  readonly conversations: ConversationsStore = new ConversationsStore(null, query => this.#engine?.matches(query) ?? null);

  /** L'ancienne interface a fini de démarrer. */
  ready = $state(false);
  /** Le pont vers l'ancienne interface est introuvable : la coque s'efface, l'ancienne barre latérale reste utilisable. */
  unavailable = $state(false);
  project = $state.raw<SidebarProject | null>(null);
  projectStatus = $state("");
  userName = $state("Mon compte");
  avatar = $state("");
  settingsOpen = $state(false);
  theme = $state<Theme>("system");
  agents = $state.raw<EngineAgent[]>([]);
  /** Panneau des archives (lu dans l'ancienne interface). */
  archive = $state.raw<ArchiveState>(NO_ARCHIVE);
  /** Résultats de la recherche sur le serveur (lus dans l'ancienne interface). */
  remoteSearch = $state.raw<RemoteSearchState>(NO_REMOTE_SEARCH);
  /** Tiroir ouvert (écrans étroits). */
  drawerOpen = $state(false);
  /** Barre latérale repliée (grands écrans). */
  collapsed = $state(false);
  width = $state(0);
  menu = $state.raw<OpenMenu | null>(null);

  readonly wide = $derived(this.width > WIDE_ABOVE);
  readonly layout = $derived<EngineLayout>({ sidebarVisible: this.wide && !this.collapsed, collapsed: this.collapsed });
  readonly menuPinned = $derived(this.menu !== null && this.conversations.items.some(item => item.id === this.menu?.id && item.pinned === true));

  #engine = $state.raw<LegacyEngine | null>(null);
  readonly #onTheme: ((theme: Theme) => void) | undefined;

  /** Ce que le moteur historique appelle. Fonctions fléchées : le moteur les invoque sans les lier. */
  readonly host: EngineHost = {
    changed: () => this.refresh(),
    openSidebar: () => {
      this.drawerOpen = true;
    },
    closeSidebar: () => {
      this.drawerOpen = false;
    },
    menuToggle: () => this.menuToggle(),
    closeMenus: () => {
      this.menu = null;
    }
  };

  constructor(options: ShellOptions) {
    this.width = options.width;
    this.#onTheme = options.onTheme;
  }

  /** Moteur relié (réactif : la mise en page est renvoyée à chaque nouveau moteur). */
  get engine(): LegacyEngine | null {
    return this.#engine;
  }

  connect(engine: LegacyEngine): void {
    this.disconnect();
    this.unavailable = false;
    this.#engine = engine;
    engine.attach(this.host);
    this.refresh();
  }

  /** L'iframe a chargé une page sans pont (ancien fichier préparé, autre origine) : on n'affiche rien de plus. */
  markUnavailable(): void {
    this.disconnect();
    this.unavailable = true;
  }

  disconnect(): void {
    const engine = this.#engine;
    this.#engine = null;
    this.ready = false;
    if (!engine) return;
    try {
      engine.detach();
    } catch {
      // Page de l'iframe déjà remplacée ou détruite : rien à restaurer.
    }
  }

  refresh(): void {
    const engine = this.#engine;
    if (!engine) return;
    let snapshot: EngineSnapshot;
    try {
      snapshot = engine.snapshot();
    } catch (error) {
      console.error("Coque Svelte : état de l'ancienne interface illisible", error);
      return;
    }
    this.apply(snapshot);
  }

  apply(snapshot: EngineSnapshot): void {
    this.ready = snapshot.ready;
    this.conversations.replace(snapshot.conversations);
    this.conversations.currentId = snapshot.currentId;
    this.conversations.projectId = snapshot.projectId;
    if (!sameProject(this.project, snapshot.project)) this.project = snapshot.project;
    this.projectStatus = snapshot.projectStatus;
    this.userName = snapshot.userName;
    this.avatar = snapshot.avatar;
    this.settingsOpen = snapshot.settingsOpen;
    this.agents = snapshot.agents;
    this.archive = snapshot.archive;
    this.remoteSearch = snapshot.remoteSearch;
    if (this.theme !== snapshot.theme) {
      this.theme = snapshot.theme;
      this.#onTheme?.(snapshot.theme);
    }
  }

  // --- Barre latérale ---

  markFor = (conversation: Conversation): { html: string; label: string } => {
    const agent = conversationAgent(conversation, this.agents);
    return { html: providerMark(agent, PROVIDER_LOGOS), label: agentLabel(agent) };
  };

  resize(width: number): void {
    this.width = width;
    this.menu = null;
    if (this.wide) this.drawerOpen = false;
  }

  menuToggle(): void {
    if (this.wide) this.collapsed = false;
    else this.drawerOpen = true;
  }

  collapse(): void {
    this.closeMenus();
    if (this.wide) this.collapsed = true;
    else this.drawerOpen = false;
  }

  overlayClick(): void {
    this.closeMenus();
    this.drawerOpen = false;
  }

  /** Ferme le menu de la coque et ceux de l'ancienne interface (paramètres, etc.). */
  closeMenus(): void {
    this.menu = null;
    this.#engine?.closeMenus();
  }

  searched(): void {
    this.closeMenus();
  }

  /** Recopie la recherche dans l'ancienne interface (recherche locale historique et recherche sur le serveur). */
  syncSearch(query: string): void {
    this.#engine?.search(query);
  }

  composition(active: boolean): void {
    this.#engine?.composition(active);
  }

  toggleArchive(): void {
    this.#engine?.toggleArchive();
  }

  restoreArchived(chatId: string): void {
    this.#engine?.restoreArchived(chatId);
  }

  downloadArchived(chatId: string): void {
    this.#engine?.downloadArchived(chatId);
  }

  moreArchived(): void {
    this.#engine?.moreArchived();
  }

  openRemote(index: number): void {
    this.#engine?.openRemote(index);
    if (!this.wide) this.drawerOpen = false;
  }

  historyScrolled(): void {
    this.closeMenus();
  }

  toggleMenu(id: string, anchor: AnchorRect): void {
    this.menu = this.menu?.id === id ? null : { id, anchor };
  }

  menuAction(action: MenuAction): void {
    const id = this.menu?.id;
    this.menu = null;
    if (id) this.#engine?.[action](id);
  }

  open(id: string): void {
    this.#engine?.openConversation(id);
  }

  newChat(): void {
    this.#engine?.act("new-chat");
  }

  projects(): void {
    this.#engine?.act("projects");
  }

  library(): void {
    this.#engine?.act("library");
  }

  projectSettings(): void {
    this.#engine?.act("project-settings");
  }

  leaveProject(): void {
    this.#engine?.act("leave-project");
  }

  settings(): void {
    this.#engine?.act("settings");
    if (!this.wide) this.drawerOpen = false;
  }
}
