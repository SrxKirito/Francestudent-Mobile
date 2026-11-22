// État réactif du chat et raccordement à son moteur.
// Tout ce qui est décidable sans DOM vit dans lib/services (testé sous Node) ; ce magasin ne fait que relier les
// contrôleurs aux composants. Aucun jeton, aucun code PIN n'est conservé ici.
import { memoryEntryLimit } from "../services/chat-memory.ts";
import { editorRevision, editorTextLimit, readEditorHistory, reviseEditor, type EditorTarget } from "../services/document-editor.ts";
import { assistantEditorSource } from "../services/interactive-content.ts";
import { validInteractiveFollowUp } from "../services/interactive-prompts.ts";
import { createAppSessions, type AppSession, type EditorFollowUp, type InteractiveFollowUp } from "../services/interactive-app-session.ts";
import { createLiveTracker, emptyLive } from "../services/chat-live.ts";
import type { LiveState, LiveTracker } from "../services/chat-live.ts";
import { EMPTY_CHAT_STATE } from "../services/chat-engine.ts";
import type { ChatEngine } from "../services/chat-engine.ts";
import { processChatStream } from "../services/chat-stream.ts";
import { createSharesController } from "../services/chat-shares.ts";
import type { SharesController, ShareView } from "../services/chat-shares.ts";
import { createImportController } from "../services/conversation-import.ts";
import type { ImportController, ImportModel } from "../services/conversation-import.ts";
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

export interface ImportDialogInfo {
  models: ImportModel[];
  selectedId: number | null;
}

const TOAST_MS = 4000;

export class ChatStore {
  readonly shell: ShellStore;

  state = $state.raw<ChatState>(EMPTY_CHAT_STATE);
  live = $state.raw<LiveState>(emptyLive());
  toasts = $state.raw<ToastItem[]>([]);
  confirmRequest = $state.raw<ConfirmRequest | null>(null);
  /** KaTeX chargé : les messages se redessinent (les formules ne sont rendues qu'une fois la bibliothèque présente). */
  katexReady = $state(false);
  readonly appSessions = createAppSessions();
  interactiveContext = $state.raw<{ data: InteractiveFollowUp; conversationId: string | null; projectId: string | null } | null>(null);

  useInteractiveContext(conversationId: string | null, data: InteractiveFollowUp): void {
    if (this.state.id !== conversationId || !this.engine?.sendWithInteractiveContext) return;
    this.interactiveContext = { data, conversationId, projectId: this.shell.conversations.projectId };
  }


  editorSession(conversationId: string, index: number, block: EditorTarget, followUp?: AppSession["followUp"]): AppSession {
    const state = this.appSessions.forBlock(conversationId, index, block, followUp);
    const engine = this.engine;
    return {
      ...state,
      read: revision => state.read(revision) ?? engine?.readEditorDraft?.(conversationId, index, block, revision),
      save: (revision, snapshot) => {
        state.save(revision, snapshot);
        engine?.saveEditorDraft?.(conversationId, index, block, revision, snapshot);
      },
      publish: (revision, snapshot) => {
        state.publish(revision, snapshot);
        engine?.saveEditorDraft?.(conversationId, index, block, revision, snapshot);
      }
    };
  }

  applyEditorSuggestion(conversationId: string, request: EditorFollowUp, replacement: string): string {
    if (this.state.id !== conversationId || !validInteractiveFollowUp(request)) return "Ce document n’est plus ouvert.";
    const source = this.state.messages[request.message];
    const document = source?.role === "assistant" ? assistantEditorSource(source.content, request.block) : undefined;
    if (!document || editorRevision(document.title, document.text) !== request.revision || document.language !== request.language) {
      return "Le document d’origine n’est plus disponible.";
    }
    const session = this.editorSession(conversationId, request.message, request.block);
    const history = readEditorHistory(document.text, session.read(request.revision));
    if (history.current !== request.text) return "Le document a été modifié depuis la demande. Renvoie le passage à réviser.";
    const updated = request.text.slice(0, request.start) + replacement + request.text.slice(request.end);
    if (updated.length > editorTextLimit) return "Le document révisé dépasse 16 000 caractères.";
    session.publish(request.revision, JSON.stringify(reviseEditor(history, updated)));
    return "";
  }

  importDialog = $state.raw<ImportDialogInfo | null>(null);
  importStatus = $state.raw<{ text: string; error: boolean }>({ text: "", error: false });
  importing = $state(false);

  sharesOpen = $state(false);
  sharesView = $state.raw<ShareView | null>(null);

  /** L'iframe historique doit montrer sa propre fenêtre (réglages, projets, bibliothèque…) : la surcouche s'efface. */
  get visible(): boolean {
    return this.shell.ready && this.state.ready && !this.state.legacyOverlay;
  }

  #engine: ChatEngine | null = null;
  #tracker: LiveTracker | null = null;
  #importCtl: ImportController | null = null;
  #sharesCtl: SharesController | null = null;
  #toastSeq = 0;

  constructor(shell: ShellStore, private readonly onOpenImported?: () => void) {
    this.shell = shell;
  }

  get engine(): ChatEngine | null {
    return this.#engine;
  }

  /** Raccorde le moteur du chat et le lecteur en direct. */
  connect(engine: ChatEngine): void {
    this.disconnect();
    this.#engine = engine;
    const tracker = createLiveTracker(live => {
      this.live = live;
    });
    this.#tracker = tracker;
    engine.attach({
      changed: () => this.refresh(),
      toast: (text, isError) => this.toast(text, isError),
      readStream: options => processChatStream(tracker.wrap(options))
    });
    this.#wireImport(engine);
    this.#wireShares(engine);
    this.refresh();
  }

  disconnect(): void {
    const engine = this.#engine;
    this.#engine = null;
    this.appSessions.clear();
    this.interactiveContext = null;
    this.#tracker = null;
    this.#importCtl = null;
    this.#sharesCtl = null;
    this.state = EMPTY_CHAT_STATE;
    this.live = emptyLive();
    this.importDialog = null;
    this.sharesOpen = false;
    this.answerConfirm(false);
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
    if (this.interactiveContext?.conversationId !== next.id) this.interactiveContext = null;
    const wasBusy = this.state.busy;
    this.state = next;
    if ((wasBusy || this.live.active) && !next.busy) this.#tracker?.reset();
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

  async remember(text: string): Promise<boolean> {
    const engine = this.engine;
    if (!engine?.remember) return false;
    const value = text.trim();
    if (!value || value.length > memoryEntryLimit) {
      this.toast("Choisis un souvenir de 1 à 280 caractères.", true);
      return false;
    }
    const conversation = this.state.id;
    const project = this.shell.conversations.projectId;
    const yes = await this.confirm("Enregistrer ce souvenir sur cet appareil ?\n\n« " + value + " »");
    if (!yes || this.engine !== engine || this.state.id !== conversation || this.shell.conversations.projectId !== project) return false;
    try {
      const enabled = engine.remember(value);
      this.toast(enabled ? "Souvenir enregistré." : "Souvenir enregistré. La mémoire est désactivée dans les discussions.");
      return true;
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "Impossible d’enregistrer ce souvenir.", true);
      return false;
    }
  }

  answerConfirm(ok: boolean): void {
    const request = this.confirmRequest;
    this.confirmRequest = null;
    request?.resolve(ok);
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
          this.onOpenImported?.();
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
    if (!document.getElementById("fs-katex-style")) {
      const style = document.createElement("link");
      style.id = "fs-katex-style";
      style.rel = "stylesheet";
      style.href = "/legacy/katex/katex.min.css";
      document.head.appendChild(style);
    }
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
