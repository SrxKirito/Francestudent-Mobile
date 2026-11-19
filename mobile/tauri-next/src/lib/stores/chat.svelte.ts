// État du chat Svelte (surcouche posée sur l'iframe historique, qui reste le moteur : session, transport, enregistrement).
// Tout ce qui est décidable sans DOM vit dans lib/services (testé sous Node) ; ce magasin ne fait que relier les
// contrôleurs aux composants. Aucun jeton, aucun code PIN n'est conservé ici.
import { createLiveTracker, emptyLive } from "../services/chat-live.ts";
import type { LiveState, LiveTracker } from "../services/chat-live.ts";
import { EMPTY_CHAT_STATE } from "../services/chat-engine.ts";
import type { ChatEngine } from "../services/chat-engine.ts";
import { processChatStream } from "../services/chat-stream.ts";
import { createSharesController } from "../services/chat-shares.ts";
import type { SharesController, ShareView } from "../services/chat-shares.ts";
import { createImportController } from "../services/conversation-import.ts";
import type { ImportController, ImportModel } from "../services/conversation-import.ts";
import { connectLockedChats, createLockedController, lockedBadge, lockedRows, pinFailureMessage } from "../services/locked-chats.ts";
import type { LockedApi, LockedController, LockedRow, LockedState, PinRequest } from "../services/locked-chats.ts";
import type { ChatState } from "../types/chat.ts";
import type { ShellStore } from "./shell.svelte.ts";

export interface ToastItem {
  id: number;
  text: string;
  error: boolean;
}

export interface ConfirmRequest {
  message: string;
  resolve(ok: boolean): void;
}

export interface PinDialogRequest {
  request: PinRequest;
  resolve(ok: boolean): void;
}

export interface ImportDialogInfo {
  models: ImportModel[];
  selectedId: number | null;
}

const NO_LOCKED: LockedState = { hasPin: null, accessOpen: false, lockedIds: [], loaded: false };
const LOCKED_EVENT = "francestudent:locked-chats";
const TOAST_MS = 4000;

export class ChatStore {
  readonly shell: ShellStore;

  state = $state.raw<ChatState>(EMPTY_CHAT_STATE);
  live = $state.raw<LiveState>(emptyLive());
  toasts = $state.raw<ToastItem[]>([]);
  confirmRequest = $state.raw<ConfirmRequest | null>(null);
  pinRequest = $state.raw<PinDialogRequest | null>(null);
  /** KaTeX chargé : les messages se redessinent (les formules ne sont rendues qu'une fois la bibliothèque présente). */
  katexReady = $state(false);

  locked = $state.raw<LockedState>(NO_LOCKED);
  lockedList = $state.raw<LockedRow[]>([]);
  lockedPanel = $state(false);
  lockedStatus = $state("");
  lockedBusy = $state(false);
  lockedAvailable = $state(false);

  importDialog = $state.raw<ImportDialogInfo | null>(null);
  importStatus = $state.raw<{ text: string; error: boolean }>({ text: "", error: false });
  importing = $state(false);

  sharesOpen = $state(false);
  sharesView = $state.raw<ShareView | null>(null);

  /** L'iframe historique doit montrer sa propre fenêtre (réglages, projets, bibliothèque…) : la surcouche s'efface. */
  get visible(): boolean {
    return this.shell.ready && this.state.ready && !this.state.legacyOverlay;
  }

  get lockedCount(): number {
    return lockedBadge(this.locked);
  }

  #engine: ChatEngine | null = null;
  #frame: Window | null = null;
  #tracker: LiveTracker | null = null;
  #lockedApi: LockedApi | null = null;
  #lockedCtl: LockedController | null = null;
  #importCtl: ImportController | null = null;
  #sharesCtl: SharesController | null = null;
  #toastSeq = 0;
  #onLockedEvent: (() => void) | null = null;

  constructor(shell: ShellStore) {
    this.shell = shell;
  }

  get engine(): ChatEngine | null {
    return this.#engine;
  }

  /** Relie le chat au moteur de l'iframe (rappelé à chaque rechargement de l'iframe). */
  connect(frameWindow: Window | null, engine: ChatEngine): void {
    this.disconnect();
    this.#engine = engine;
    this.#frame = frameWindow;
    const tracker = createLiveTracker(live => {
      this.live = live;
    });
    this.#tracker = tracker;
    engine.attach({
      changed: () => this.refresh(),
      toast: (text, isError) => this.toast(text, isError),
      readStream: options => processChatStream(tracker.wrap(options))
    });
    this.#wireLocked(frameWindow, engine);
    this.#wireImport(engine);
    this.#wireShares(engine);
    this.refresh();
  }

  disconnect(): void {
    const engine = this.#engine;
    const frame = this.#frame;
    if (frame && this.#onLockedEvent) {
      try {
        frame.removeEventListener(LOCKED_EVENT, this.#onLockedEvent);
      } catch {
        // Fenêtre déjà détruite.
      }
    }
    this.#onLockedEvent = null;
    this.#engine = null;
    this.#frame = null;
    this.#tracker = null;
    this.#lockedApi = null;
    this.#lockedCtl = null;
    this.#importCtl = null;
    this.#sharesCtl = null;
    this.state = EMPTY_CHAT_STATE;
    this.live = emptyLive();
    this.lockedAvailable = false;
    this.lockedPanel = false;
    this.importDialog = null;
    this.sharesOpen = false;
    this.#resolveDialogs(false);
    if (!engine) return;
    try {
      engine.detach();
    } catch {
      // Page de l'iframe déjà remplacée : rien à restaurer.
    }
  }

  refresh(): void {
    const engine = this.#engine;
    if (!engine) return;
    let next: ChatState;
    try {
      next = engine.state();
    } catch (error) {
      console.error("Chat Svelte : état du moteur illisible", error);
      return;
    }
    const wasBusy = this.state.busy;
    this.state = next;
    if ((wasBusy || this.live.active) && !next.busy) this.#tracker?.reset();
    this.#syncLocked();
  }

  // ---------- notifications et dialogues génériques ----------
  toast(text: string, isError = false): void {
    this.#toastSeq += 1;
    const id = this.#toastSeq;
    this.toasts = [...this.toasts, { id, text, error: isError }];
    setTimeout(() => this.dismissToast(id), TOAST_MS);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter(item => item.id !== id);
  }

  /** Remplace `window.confirm` (non fiable dans une WebView iOS). */
  confirm(message: string): Promise<boolean> {
    this.confirmRequest?.resolve(false);
    return new Promise<boolean>(resolve => {
      this.confirmRequest = { message, resolve };
    });
  }

  answerConfirm(ok: boolean): void {
    const request = this.confirmRequest;
    this.confirmRequest = null;
    request?.resolve(ok);
  }

  resolvePin(ok: boolean): void {
    const request = this.pinRequest;
    this.pinRequest = null;
    request?.resolve(ok);
  }

  #resolveDialogs(ok: boolean): void {
    this.answerConfirm(ok);
    this.resolvePin(ok);
  }

  // ---------- conversations verrouillées ----------
  #wireLocked(frameWindow: Window | null, engine: ChatEngine): void {
    const api = connectLockedChats(frameWindow);
    this.#lockedApi = api;
    this.lockedAvailable = api !== null;
    if (!api) return;
    this.#lockedCtl = createLockedController({
      api,
      ui: {
        askPin: request => {
          this.pinRequest?.resolve(false);
          return new Promise<boolean>(resolve => {
            this.pinRequest = { request, resolve };
          });
        },
        cancelPin: () => this.resolvePin(false),
        confirm: message => this.confirm(message),
        toast: (text, isError) => this.toast(text, isError === true),
        setPanel: open => {
          this.lockedPanel = open;
          if (!open) this.lockedStatus = "";
        },
        panelOpen: () => this.lockedPanel,
        setStatus: text => {
          this.lockedStatus = text;
        }
      },
      session: () => this.shell.ready,
      conversations: () => engine.lockableConversations(),
      chatBusy: () => this.state.busy,
      onBusy: busy => {
        this.lockedBusy = busy;
        this.#syncLocked();
      }
    });
    const onEvent = (): void => this.#syncLocked();
    this.#onLockedEvent = onEvent;
    frameWindow?.addEventListener(LOCKED_EVENT, onEvent);
  }

  #syncLocked(): void {
    const api = this.#lockedApi;
    const engine = this.#engine;
    if (!api || !engine) return;
    let state: LockedState;
    try {
      state = api.state();
    } catch {
      return;
    }
    this.locked = state;
    // Confidentialité : tant que l'accès est fermé, ni la liste ni le panneau ne contiennent quoi que ce soit.
    if (!state.accessOpen) {
      this.lockedList = [];
      this.lockedPanel = false;
      return;
    }
    this.lockedList = lockedRows(engine.lockableConversations(), state, this.state.id);
  }

  /** Libellé de l'entrée « Verrouiller / Déverrouiller » du menu ⋯ d'une conversation. */
  lockLabelFor(localId: string | null): string | null {
    const api = this.#lockedApi;
    const engine = this.#engine;
    if (!api || !engine || !localId) return null;
    const chatId = engine.lockableConversations().find(item => item.id === localId)?.chatId;
    return chatId && api.isChatLocked(chatId) ? "Déverrouiller" : "Verrouiller";
  }

  toggleLockedAccess(): void {
    void this.#lockedCtl?.toggleAccess().then(() => this.#syncLocked());
  }

  closeLockedNow(): void {
    void this.#lockedCtl?.closeAccessNow().then(() => this.#syncLocked());
  }

  lockMenuConversation(localId: string): void {
    void this.#lockedCtl?.toggleConversationLock(localId).then(() => this.#syncLocked());
  }

  unlockFromPanel(chatId: string): void {
    void this.#lockedCtl?.unlockFromPanel(chatId).then(() => this.#syncLocked());
  }

  changePin(): void {
    void this.#lockedCtl?.changePinFlow().then(() => this.#syncLocked());
  }

  /** Validation du dialogue de code PIN : l'erreur reste dans la boîte, qui reste ouverte. */
  async submitPin(pin: string): Promise<string> {
    const current = this.pinRequest;
    if (!current) return "";
    try {
      await current.request.submit(pin);
    } catch (failure) {
      return pinFailureMessage(failure);
    }
    if (this.pinRequest === current) this.resolvePin(true);
    return "";
  }

  // ---------- import de conversation ----------
  #wireImport(engine: ChatEngine): void {
    this.#importCtl = createImportController({
      api: engine.importApi,
      loggedIn: () => this.shell.ready,
      chatBusy: () => this.state.busy,
      ui: {
        setStatus: (text, isError) => {
          this.importStatus = { text, error: isError };
        },
        toast: (text, isError) => this.toast(text, isError === true),
        closeDialog: () => {
          this.importDialog = null;
          this.importStatus = { text: "", error: false };
        },
        openConversation: async id => {
          this.shell.open(id);
        },
        setImporting: on => {
          this.importing = on;
        }
      }
    });
  }

  openImport(): void {
    // Le statut est remis à zéro AVANT l'ouverture : le contrôleur y écrit « aucun modèle disponible » le cas échéant.
    this.importStatus = { text: "", error: false };
    const info = this.#importCtl?.open();
    if (!info) return;
    this.importDialog = { models: info.models, selectedId: info.selectedId };
  }

  submitImport(link: string, agentId: number): void {
    void this.#importCtl?.submit({ link, agentId });
  }

  closeImport(): void {
    if (this.#importCtl && !this.#importCtl.close()) return;
    this.importDialog = null;
    this.importStatus = { text: "", error: false };
  }

  // ---------- partage ----------
  #wireShares(engine: ChatEngine): void {
    this.#sharesCtl = createSharesController({
      api: engine.sharesApi,
      ui: {
        openDialog: () => {
          this.sharesOpen = true;
        },
        setView: view => {
          this.sharesView = view;
        },
        toast: text => this.toast(text, false),
        confirm: message => this.confirm(message),
        closeDialog: () => {
          this.sharesOpen = false;
          this.sharesView = null;
        }
      }
    });
  }

  openShares(localId: string): void {
    void this.#sharesCtl?.open(localId);
  }

  grantShare(email: string, permission: "View" | "Write"): void {
    void this.#sharesCtl?.grant(email, permission);
  }

  changeShare(key: string): void {
    void this.#sharesCtl?.changePermission(key);
  }

  removeShare(key: string): void {
    void this.#sharesCtl?.remove(key);
  }

  closeShares(): void {
    this.#sharesCtl?.close();
    this.sharesOpen = false;
    this.sharesView = null;
  }

  // ---------- KaTeX ----------
  /** Charge KaTeX (script du dossier legacy) une seule fois ; les formules n'apparaissent qu'ensuite. */
  loadKatex(): void {
    const scope = window as unknown as { katex?: unknown };
    if (scope.katex) {
      this.katexReady = true;
      return;
    }
    if (document.getElementById("fs-katex")) return;
    const script = document.createElement("script");
    script.id = "fs-katex";
    script.src = "/legacy/katex/katex.min.js";
    script.onload = () => {
      this.katexReady = true;
    };
    script.onerror = () => {
      console.error("Chat Svelte : KaTeX introuvable, les formules restent en texte.");
    };
    document.head.appendChild(script);
  }
}
