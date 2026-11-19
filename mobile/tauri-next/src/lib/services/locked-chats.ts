// Conversations verrouillées côté Svelte. L'API réseau, le jeton d'accès (gardé en mémoire seulement) et le masquage
// des discussions restent dans l'ancienne interface (locked-chats.js, window.FranceStudentLockedChats) : ce module
// n'en fait que l'interface (PIN, panneau, actions) et ne manipule JAMAIS le jeton.
//
// Confidentialité : tant que l'accès est fermé, aucune ligne ni aucun compteur n'est produit (`lockedRows`, `lockedBadge`).

export interface LockedState {
  /** `null` = état pas encore chargé. */
  hasPin: boolean | null;
  accessOpen: boolean;
  lockedIds: string[];
  loaded: boolean;
}

export interface LockedApi {
  getStatus(): Promise<LockedState>;
  openAccess(pin: string): Promise<LockedState>;
  closeAccess(options?: { silent?: boolean }): Promise<LockedState>;
  list(): Promise<unknown>;
  lockChat(chatId: string): Promise<boolean>;
  unlockChat(chatId: string): Promise<boolean>;
  createPin(pin: string): Promise<LockedState>;
  changePin(currentPin: string, newPin: string): Promise<LockedState>;
  isChatLocked(chatId: string): boolean;
  state(): LockedState;
}

export interface LockedConversation {
  id: string;
  chatId?: string;
  title?: string;
  updatedAt?: number;
  pendingResponse?: boolean;
}

export interface LockedRow {
  id: string;
  chatId: string;
  title: string;
  current: boolean;
}

export interface PinRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Peut lever : le message est affiché et la boîte reste ouverte. */
  submit(pin: string): Promise<void>;
}

export interface LockedUi {
  /** Résout `true` si validé, `false` si annulé. */
  askPin(request: PinRequest): Promise<boolean>;
  cancelPin(): void;
  confirm(message: string): Promise<boolean>;
  toast(text: string, isError?: boolean): void;
  setPanel(open: boolean): void;
  panelOpen(): boolean;
  setStatus(text: string): void;
}

export interface LockedContext {
  api: LockedApi;
  ui: LockedUi;
  /** Une session est ouverte (l'application a fini de démarrer et l'utilisateur est connecté). */
  session(): boolean;
  conversations(): LockedConversation[];
  /** Une réponse est en cours de génération. */
  chatBusy(): boolean;
  onBusy?(busy: boolean): void;
}

const PIN_PATTERN = /^[0-9]{4}$/;
const UNTITLED = "Sans titre";

export function isValidPin(value: string): boolean {
  return PIN_PATTERN.test(value);
}

export function sanitizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return String(message || error || "Erreur inconnue");
}

export function pinFailureMessage(failure: unknown): string {
  const status = (failure as { status?: unknown } | null | undefined)?.status;
  return status === 401 || status === 403 ? "Code PIN incorrect." : errorText(failure);
}

/** Lignes du panneau : vide tant que l'accès est fermé (la liste des titres est confidentielle). */
export function lockedRows(conversations: LockedConversation[], state: LockedState, currentId: string | null): LockedRow[] {
  if (!state.accessOpen) return [];
  const rows: { row: LockedRow; updatedAt: number }[] = [];
  for (const chatId of state.lockedIds) {
    const conversation = conversations.find(item => item.chatId === chatId);
    if (conversation) {
      rows.push({
        row: { id: conversation.id, chatId, title: conversation.title || UNTITLED, current: conversation.id === currentId },
        updatedAt: conversation.updatedAt || 0
      });
    }
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).map(item => item.row);
}

/** Le nombre n'est révélé que pendant que l'accès est ouvert. */
export function lockedBadge(state: LockedState): number {
  return state.accessOpen ? state.lockedIds.length : 0;
}

export function lockedStatusText(state: LockedState, rowCount: number, busy: boolean): string {
  if (!state.loaded) return busy ? "Chargement…" : "Liste indisponible.";
  return rowCount ? "" : "Aucune conversation verrouillée.";
}

export function pinHint(loggedIn: boolean, state: LockedState): string {
  if (!loggedIn) return "Connecte-toi pour gérer le code PIN.";
  if (state.hasPin === null) return "État du code PIN non chargé.";
  return state.hasPin ? "Un code PIN protège tes conversations verrouillées." : "Aucun code PIN défini.";
}

export interface LockedController {
  isBusy(): boolean;
  toggleAccess(): Promise<void>;
  closeAccessNow(): Promise<void>;
  toggleConversationLock(localId: string): Promise<void>;
  unlockFromPanel(chatId: string): Promise<void>;
  createPinFlow(): Promise<boolean>;
  changePinFlow(): Promise<void>;
  onLogout(): Promise<void>;
}

export function createLockedController(ctx: LockedContext): LockedController {
  const { api, ui } = ctx;
  let busy = false;

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    ctx.onBusy?.(true);
    try {
      return await task();
    } catch (error) {
      ui.toast("Opération impossible : " + errorText(error), true);
      return undefined;
    } finally {
      busy = false;
      ctx.onBusy?.(false);
    }
  }

  async function refreshStatus(): Promise<LockedState> {
    if (!ctx.session()) throw new Error("Connecte-toi pour utiliser les conversations verrouillées.");
    return api.getStatus();
  }

  // Demande un nouveau code deux fois puis appelle `save`. Le premier code ne vit que dans cette fermeture.
  async function askNewPin(title: string, intro: string, save: (pin: string) => Promise<void>): Promise<boolean> {
    let first = "";
    const chosen = await ui.askPin({ title, description: intro, confirmLabel: "Continuer", submit: async pin => { first = pin; } });
    if (!chosen) return false;
    try {
      return await ui.askPin({
        title,
        description: "Saisis le même code pour confirmer.",
        confirmLabel: "Enregistrer",
        submit: async pin => {
          if (pin !== first) throw new Error("Les deux codes ne correspondent pas.");
          await save(pin);
        }
      });
    } finally {
      first = "";
    }
  }

  async function createPinFlow(): Promise<boolean> {
    const created = await askNewPin("Créer un code PIN", "Ce code (4 chiffres) protège tes conversations verrouillées.", async pin => { await api.createPin(pin); });
    if (created) ui.toast("Code PIN créé.");
    return created;
  }

  async function unlockFlow(): Promise<boolean> {
    const opened = await ui.askPin({
      title: "Conversations verrouillées",
      description: "Saisis ton code PIN pour afficher tes conversations verrouillées.",
      confirmLabel: "Déverrouiller",
      submit: async pin => { await api.openAccess(pin); }
    });
    if (opened) {
      ui.setPanel(true);
      if (!api.state().loaded) ui.setStatus("Liste indisponible.");
    }
    return opened;
  }

  async function toggleAccess(): Promise<void> {
    await run(async () => {
      if (api.state().accessOpen) {
        ui.setPanel(!ui.panelOpen());
        return;
      }
      let state: LockedState;
      try {
        state = await refreshStatus();
      } catch (error) {
        ui.toast("Conversations verrouillées indisponibles : " + errorText(error), true);
        return;
      }
      if (state.accessOpen) {
        ui.setPanel(true);
        try { await api.list(); } catch (error) { ui.setStatus("Chargement impossible : " + errorText(error)); }
        return;
      }
      if (!state.hasPin) {
        if (await createPinFlow()) {
          if (api.state().accessOpen) ui.setPanel(true);
          else await unlockFlow();
        }
        return;
      }
      await unlockFlow();
    });
  }

  async function closeAccessNow(): Promise<void> {
    await run(async () => {
      await api.closeAccess();
      ui.setPanel(false);
      ui.toast("Conversations verrouillées masquées.");
    });
  }

  async function toggleConversationLock(localId: string): Promise<void> {
    const conversation = ctx.conversations().find(item => item.id === localId);
    if (!conversation) return;
    if (!conversation.chatId) {
      ui.toast("Cette conversation n’est pas encore enregistrée sur le serveur.", true);
      return;
    }
    if (ctx.chatBusy() || conversation.pendingResponse) {
      ui.toast("Termine ou annule la réponse en cours d’abord.", true);
      return;
    }
    const chatId = conversation.chatId;
    await run(async () => {
      try {
        if (api.isChatLocked(chatId)) {
          const question = "Déverrouiller définitivement « " + (conversation.title || UNTITLED) + " » ? Elle réapparaîtra dans l’historique normal.";
          if (!(await ui.confirm(question))) return;
          await api.unlockChat(chatId);
          ui.toast("Conversation déverrouillée.");
          return;
        }
        let state = api.state();
        if (state.hasPin === null) state = await refreshStatus();
        if (!state.hasPin && !(await createPinFlow())) return;
        if (!api.state().accessOpen && !(await unlockFlow())) return;
        await api.lockChat(chatId);
        ui.toast(api.state().accessOpen ? "Conversation verrouillée." : "Conversation verrouillée et masquée.");
      } catch (error) {
        ui.toast("Opération impossible : " + errorText(error), true);
      }
    });
  }

  async function unlockFromPanel(chatId: string): Promise<void> {
    const conversation = ctx.conversations().find(item => item.chatId === chatId);
    if (!(await ui.confirm("Déverrouiller définitivement « " + (conversation?.title || UNTITLED) + " » ?"))) return;
    await run(async () => {
      try {
        await api.unlockChat(chatId);
        ui.toast("Conversation déverrouillée.");
      } catch (error) {
        ui.setStatus("Déverrouillage impossible : " + errorText(error));
      }
    });
  }

  async function changePinFlow(): Promise<void> {
    await run(async () => {
      let current = "";
      const entered = await ui.askPin({
        title: "Changer le code PIN",
        description: "Saisis ton code PIN actuel.",
        confirmLabel: "Continuer",
        submit: async pin => { current = pin; }
      });
      if (!entered) return;
      try {
        const changed = await askNewPin("Nouveau code PIN", "Choisis un nouveau code (4 chiffres).", async pin => { await api.changePin(current, pin); });
        if (changed) ui.toast("Code PIN modifié.");
      } finally {
        current = "";
      }
    });
  }

  async function onLogout(): Promise<void> {
    ui.cancelPin();
    ui.setPanel(false);
    ui.setStatus("");
    await api.closeAccess({ silent: true });
  }

  return {
    isBusy: () => busy,
    toggleAccess,
    closeAccessNow,
    toggleConversationLock,
    unlockFromPanel,
    createPinFlow: () => run(createPinFlow).then(Boolean),
    changePinFlow,
    onLogout
  };
}

const API_METHODS = ["getStatus", "openAccess", "closeAccess", "list", "lockChat", "unlockChat", "createPin", "changePin", "isChatLocked", "state"] as const;

function toState(raw: unknown): LockedState {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    hasPin: typeof value.hasPin === "boolean" ? value.hasPin : null,
    accessOpen: value.accessOpen === true,
    lockedIds: Array.isArray(value.lockedIds) ? Array.from(value.lockedIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
    loaded: value.loaded === true
  };
}

/** Se relie à l'API de l'ancienne interface. `null` si la fenêtre est inaccessible ou si le script n'y est pas. */
export function connectLockedChats(frameWindow: unknown): LockedApi | null {
  let raw: Record<string, unknown> | null = null;
  try {
    const candidate = typeof frameWindow === "object" && frameWindow !== null ? (frameWindow as Record<string, unknown>).FranceStudentLockedChats : undefined;
    raw = typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>) : null;
    if (!raw || !API_METHODS.every(name => typeof raw![name] === "function")) return null;
  } catch {
    return null;
  }
  const api = raw as unknown as LockedApi;
  return {
    getStatus: async () => toState(await api.getStatus()),
    openAccess: async pin => toState(await api.openAccess(pin)),
    closeAccess: async options => toState(await api.closeAccess(options)),
    list: () => api.list(),
    lockChat: async chatId => (await api.lockChat(chatId)) === true,
    unlockChat: async chatId => (await api.unlockChat(chatId)) === true,
    createPin: async pin => toState(await api.createPin(pin)),
    changePin: async (currentPin, newPin) => toState(await api.changePin(currentPin, newPin)),
    isChatLocked: chatId => api.isChatLocked(chatId) === true,
    state: () => toState(api.state())
  };
}
