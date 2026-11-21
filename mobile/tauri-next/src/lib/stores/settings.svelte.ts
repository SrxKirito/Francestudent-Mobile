import type { EngineAgent } from "../services/legacy-engine.ts";
import type { GeneralSettingsService, PromptCompression, ReasoningLevel, WebDomainSettings, WebFilterType } from "../services/general-settings.ts";
import { instructionsError, webModeSummary } from "../services/general-settings.ts";
import type { LocalSettings, LocalSettingsGateway, LocalSettingsPatch, SettingsCatalog } from "../services/local-settings.ts";
import type { LibraryColumns, Theme, WebSearchMode } from "../types/state.ts";
import { errorMessage } from "../utils/errors.ts";
import { chooseInterface } from "../utils/interface-choice.ts";
import type { InterfaceAction, InterfaceChoice } from "../utils/interface-choice.ts";
import { defaultAgentValid, modelGroups } from "../utils/model-menu.ts";
import type { ModelGroup } from "../utils/model-menu.ts";
import type { UiMode } from "../utils/ui-flag.ts";
import type { ApiClient } from "../services/api-client.ts";
import type { WorkspaceEngine } from "../services/workspace-engine.ts";
import type { SkillsStore } from "./skills.svelte.ts";
import type { AccountStore } from "./account.svelte.ts";

// Fenêtre Paramètres : les onglets sont rendus par Svelte quand leur service est disponible.

export type SettingsTab = "account" | "general" | "skills" | "mcp" | "storage";

export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Compte" },
  { id: "general", label: "Général" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" }
];

const NATIVE_TABS: readonly SettingsTab[] = ["general"];
const NOT_READY_WEB = "Charge les listes avec Réessayer avant d’enregistrer.";

export const NOTIFICATIONS_HINT = "Notifications locales en arrière-plan ; pas de notification distante quand l’app est fermée.";
export const INTERFACE_HINT = "L’interface Svelte 5 est en cours de migration. Tu peux revenir à l’interface classique ici à tout moment.";

const LOADING_PREFERENCES = "Chargement des préférences…";
const LOADING_SUMMARY = "Chargement…";

export interface InterfaceHost {
  state(): InterfaceChoice;
  /** Écrit le choix ; renvoie l'adresse à ouvrir, ou `null` si le stockage local est refusé. */
  apply(choice: InterfaceChoice): string | null;
  reload(href: string): void;
}

export interface SettingsDeps {
  service: GeneralSettingsService;
  local: LocalSettingsGateway;
  agents: () => readonly EngineAgent[];
  interfaceHost: InterfaceHost;
  /** Ouvre l'onglet demandé dans l'écran classique (moteur historique). */
  openClassic: (tab: SettingsTab) => void;
  /** Store de l'onglet Compte ; absent : le Compte s'ouvre dans l'écran classique. */
  account?: AccountStore;
  skills?: SkillsStore;
  api?: ApiClient;
  workspace?: WorkspaceEngine;
}

type LoadState = "idle" | "loading" | "ready" | "error";

export class SettingsStore {
  open = $state(false);
  tab = $state<SettingsTab>("general");
  settings = $state.raw<LocalSettings>(undefined as unknown as LocalSettings);
  catalog = $state.raw<SettingsCatalog>(undefined as unknown as SettingsCatalog);
  localError = $state("");

  notificationsStatus = $state(NOTIFICATIONS_HINT);
  notificationsBusy = $state(false);

  loadState = $state<LoadState>("idle");
  reasoning = $state<ReasoningLevel>("none");
  compression = $state<PromptCompression | undefined>(undefined);
  instructions = $state("");
  status = $state("");
  statusError = $state(false);
  saving = $state(false);
  webSummary = $state(LOADING_SUMMARY);

  webOpen = $state(false);
  webMode = $state<string>("open");
  webFilterType = $state<WebFilterType>("allowlist");
  webAllowed = $state("");
  webBlocked = $state("");
  webStatus = $state("");
  webStatusError = $state(false);
  webLoading = $state(false);
  webSaving = $state(false);
  webRetryVisible = $state(false);
  /** Listes lues sur le serveur pour cette ouverture ; `null` tant qu'elles ne sont pas chargées (ou si le chargement a échoué). */
  webLoaded = $state.raw<WebDomainSettings | null>(null);

  interfaceChoice = $state.raw<InterfaceChoice>({ ui: "legacy", chat: false });
  interfaceStatus = $state(INTERFACE_HINT);

  readonly #deps: SettingsDeps;
  #generation = 0;
  #webToken = 0;
  #controller = new AbortController();
  #personalizationMode: WebSearchMode = "open";
  #fileInstructions = false;

  constructor(deps: SettingsDeps) {
    this.#deps = deps;
    this.settings = deps.local.read();
    this.catalog = deps.local.catalog();
    this.interfaceChoice = deps.interfaceHost.state();
  }

  get fieldsDisabled(): boolean {
    return this.loadState !== "ready" || this.saving;
  }

  get retryVisible(): boolean {
    return this.loadState === "error";
  }

  /** Les listes du serveur sont chargées : seul état dans lequel on peut modifier les filtres et enregistrer. */
  get webReady(): boolean {
    return this.webLoaded !== null && !this.webLoading;
  }

  get webFieldsDisabled(): boolean {
    return !this.webReady || this.webSaving;
  }

  get webSaveDisabled(): boolean {
    return !this.webReady || this.webSaving;
  }

  /** Store de l'onglet Compte, quand il est branché. */
  get accountPanel(): AccountStore | undefined {
    return this.#deps.account;
  }

  get tabs(): readonly { id: SettingsTab; label: string }[] {
    return this.workspace ? [...SETTINGS_TABS, { id: "storage", label: "Stockage" }] : SETTINGS_TABS;
  }

  get workspace() { return this.#deps.workspace; }

  get api() { return this.#deps.api; }

  get skillsPanel() { return this.#deps.skills; }

  get defaultValid(): boolean {
    return defaultAgentValid(this.#deps.agents(), this.settings.defaultAgentId);
  }

  get groups(): ModelGroup[] {
    return modelGroups(this.#deps.agents());
  }

  /** Ouvre la fenêtre sur l'onglet demandé ; un onglet non migré ouvre l'écran classique à la place. */
  show(tab: SettingsTab = "general"): void {
    if (!this.#isNative(tab)) {
      this.#deps.openClassic(tab);
      return;
    }
    this.#refresh();
    if (this.open) {
      this.#switchTab(tab);
      return;
    }
    this.tab = tab;
    this.#generation += 1;
    this.#controller = new AbortController();
    this.open = true;
    void this.loadPreferences();
    if (tab === "account") void this.#deps.account?.activate();
  }

  close(): void {
    if (!this.open) return;
    if (this.tab === "account") this.#deps.account?.stop();
    this.open = false;
    this.#generation += 1;
    this.#webToken += 1;
    this.#controller.abort();
    if (this.loadState === "loading") this.loadState = "idle";
    this.saving = false;
    this.webOpen = false;
    this.webLoading = false;
    this.webSaving = false;
  }

  selectTab(tab: SettingsTab): void {
    if (this.#isNative(tab)) {
      this.#switchTab(tab);
      return;
    }
    this.close();
    this.#deps.openClassic(tab);
  }

  async loadPreferences(): Promise<void> {
    if (this.loadState === "loading") return;
    const generation = this.#generation;
    const signal = this.#controller.signal;
    this.loadState = "loading";
    this.status = LOADING_PREFERENCES;
    this.statusError = false;
    this.webSummary = LOADING_SUMMARY;
    try {
      const prefs = await this.#deps.service.loadPersonalization(signal);
      if (generation !== this.#generation) return;
      this.#personalizationMode = prefs.webSearchMode;
      this.#fileInstructions = prefs.fileInstructions === true;
      this.#apply({ webSearchMode: prefs.webSearchMode });
      this.reasoning = prefs.gptReasoning;
      this.compression = prefs.promptCompression;
      this.instructions = prefs.customInstructions;
      this.webSummary = webModeSummary(prefs.webSearchMode);
      this.status = "";
      this.loadState = "ready";
    } catch (error) {
      if (generation !== this.#generation) return;
      this.loadState = "error";
      this.status = `Impossible de charger les préférences : ${errorMessage(error)}`;
      this.statusError = true;
    }
  }

  async savePreferences(): Promise<void> {
    if (this.fieldsDisabled) return;
    const fileInstructions = this.#fileInstructions;
    const tooLong = instructionsError(this.instructions, fileInstructions);
    if (tooLong) {
      this.status = tooLong;
      this.statusError = true;
      return;
    }
    const generation = this.#generation;
    this.saving = true;
    this.status = "Enregistrement…";
    this.statusError = false;
    try {
      await this.#deps.service.savePersonalization({ gptReasoning: this.reasoning, customInstructions: this.instructions, fileInstructions, ...(this.compression === undefined ? {} : { promptCompression: this.compression }) });
    } catch (error) {
      if (generation !== this.#generation) return;
      this.status = `Enregistrement impossible : ${errorMessage(error)}`;
      this.statusError = true;
      this.saving = false;
      return;
    }
    // Le serveur a bien enregistré : le moteur ne doit plus réécrire les instructions, même si la fenêtre a été fermée entre-temps.
    try {
      this.#deps.local.instructionsSaved();
    } catch {
      // Sans effet sur l'enregistrement du compte.
    }
    if (generation !== this.#generation) return;
    this.status = "Préférences enregistrées sur ton compte.";
    this.saving = false;
  }

  setTheme(theme: Theme): void {
    this.#apply({ theme });
  }

  setLibraryColumns(columns: LibraryColumns): void {
    this.#apply({ libraryColumns: columns });
  }

  setDefaultAgent(id: number | null): void {
    this.#apply({ defaultAgentId: id });
  }

  setImageTool(enabled: boolean): void {
    this.#apply({ imageTool: enabled });
  }

  setImageModel(id: string): void {
    this.#apply({ imageModel: id });
  }

  async toggleNotifications(): Promise<void> {
    if (this.notificationsBusy) return;
    this.notificationsBusy = true;
    try {
      this.notificationsStatus = await this.#deps.local.toggleNotifications();
    } catch (error) {
      this.notificationsStatus = errorMessage(error);
    } finally {
      this.notificationsBusy = false;
      this.#refresh();
    }
  }

  openWeb(): void {
    if (this.loadState !== "ready" || this.webOpen) return;
    this.webMode = this.#personalizationMode;
    this.webOpen = true;
    void this.#loadWeb();
  }

  closeWeb(): void {
    if (this.webSaving) return;
    this.#webToken += 1;
    this.webOpen = false;
    this.webLoading = false;
  }

  reloadWeb(): void {
    if (!this.webOpen || this.webLoading || this.webSaving) return;
    void this.#loadWeb();
  }

  async saveWeb(): Promise<void> {
    if (!this.webOpen || this.webSaving || this.webLoading) return;
    if (!this.webReady) {
      // Les listes du serveur ne sont pas là : les enregistrer maintenant pourrait écraser les filtres du compte.
      this.webStatus = NOT_READY_WEB;
      this.webStatusError = true;
      return;
    }
    const generation = this.#generation;
    this.webSaving = true;
    this.webStatus = "Enregistrement…";
    this.webStatusError = false;
    this.webRetryVisible = false;
    const result = await this.#deps.service.saveWebSettings({
      mode: this.webMode,
      filterType: this.webFilterType,
      allowedText: this.webAllowed,
      blockedText: this.webBlocked,
      loaded: this.webLoaded
    });
    if (generation !== this.#generation) return;
    this.webSaving = false;
    if (result.domains) this.webLoaded = result.domains;
    if (!result.ok) {
      this.webStatus = result.message;
      this.webStatusError = true;
      return;
    }
    this.#personalizationMode = result.mode;
    this.#apply({ webSearchMode: result.mode });
    this.webSummary = webModeSummary(result.mode);
    this.status = "Préférences de recherche web enregistrées.";
    this.statusError = false;
    this.webStatus = "";
    this.#webToken += 1;
    this.webOpen = false;
  }

  chooseUi(ui: UiMode): void {
    this.#chooseInterface({ kind: "ui", ui });
  }

  toggleChat(): void {
    this.#chooseInterface({ kind: "chat" });
  }

  #chooseInterface(action: InterfaceAction): void {
    const current = this.#deps.interfaceHost.state();
    const next = chooseInterface(current, action);
    if (next.ui === current.ui && next.chat === current.chat) return;
    if (this.#deps.local.busy()) {
      this.interfaceStatus = "Attends la fin de la réponse en cours avant de changer d’interface.";
      return;
    }
    const href = this.#deps.interfaceHost.apply(next);
    if (href === null) {
      this.interfaceStatus = "Changement impossible : le stockage local de l’application est refusé.";
      this.interfaceChoice = this.#deps.interfaceHost.state();
      return;
    }
    this.interfaceStatus = "Rechargement de l’interface…";
    this.#deps.interfaceHost.reload(href);
  }

  async #loadWeb(): Promise<void> {
    const generation = this.#generation;
    this.#webToken += 1;
    const token = this.#webToken;
    const signal = this.#controller.signal;
    this.webLoaded = null;
    this.webLoading = true;
    this.webStatus = "Chargement des filtres…";
    this.webStatusError = false;
    this.webRetryVisible = false;
    try {
      const domains = await this.#deps.service.loadWebDomains(signal);
      if (generation !== this.#generation || token !== this.#webToken) return;
      this.webLoaded = domains;
      this.webFilterType = domains.filterType;
      this.webAllowed = domains.allowedDomains.join("\n");
      this.webBlocked = domains.blockedDomains.join("\n");
      this.webStatus = "";
      this.webLoading = false;
    } catch (error) {
      if (generation !== this.#generation || token !== this.#webToken) return;
      this.webStatus = `Impossible de charger les filtres : ${errorMessage(error)}`;
      this.webStatusError = true;
      this.webRetryVisible = true;
      this.webLoading = false;
    }
  }

  #isNative(tab: SettingsTab): boolean {
    return NATIVE_TABS.includes(tab) || (tab === "account" && this.#deps.account !== undefined) || (tab === "skills" && this.#deps.skills !== undefined) || (tab === "mcp" && this.#deps.api !== undefined) || (tab === "storage" && this.#deps.workspace !== undefined);
  }

  /** Change d'onglet dans la fenêtre ouverte ; le Compte ne charge ses données que tant que son onglet est affiché. */
  #switchTab(next: SettingsTab): void {
    const previous = this.tab;
    if (previous === next) return;
    if (previous === "account") this.#deps.account?.stop();
    this.tab = next;
    if (next === "account") void this.#deps.account?.activate();
  }

  /** Relit les réglages locaux : le moteur historique peut les avoir modifiés depuis la dernière lecture. */
  #refresh(): void {
    this.settings = this.#deps.local.read();
    this.catalog = this.#deps.local.catalog();
    this.interfaceChoice = this.#deps.interfaceHost.state();
  }

  #apply(patch: LocalSettingsPatch): void {
    try {
      this.#deps.local.update(patch);
    } catch (error) {
      this.localError = errorMessage(error);
      return;
    }
    this.localError = "";
    this.settings = this.#deps.local.read();
  }
}
