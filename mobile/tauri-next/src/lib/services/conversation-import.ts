// Import d'une conversation ChatGPT partagée publiquement (même contrat que conversation-import.js).
// Contrat serveur : POST /conversation-imports/openai {link, model} → chatId, title, source, sourceConversationId…
// Le POST part une seule fois par soumission, jamais rejoué, et une soumission à la fois ; le réseau, la session et
// l'enregistrement de la conversation restent dans le moteur historique (pont `importRun`).
// Un lien déjà importé sur cet appareil ouvre la conversation existante ; une conversation verrouillée masquée
// n'est jamais révélée ni réutilisée (filtrée côté pont).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShareLink {
  link: string;
  shareId: string;
}

export interface ImportModel {
  id: number;
  label: string;
  model: string;
}

export interface ImportModels {
  models: ImportModel[];
  currentId: number | null;
}

export interface ImportRequest {
  link: string;
  shareId: string;
  agentId: number;
}

export interface ImportOutcome {
  ok: boolean;
  id?: string;
  count?: number | null;
  status?: number;
  detail?: string;
  message?: string;
  noSession?: boolean;
  noModel?: boolean;
  unexpected?: boolean;
  aborted?: boolean;
}

export interface ImportExisting {
  id: string;
  serverArchived: boolean;
}

export interface ImportApi {
  models(): ImportModels;
  findExisting(shareId: string): ImportExisting | null;
  run(request: ImportRequest): Promise<ImportOutcome>;
}

export interface ImportUi {
  setStatus(text: string, isError: boolean): void;
  toast(text: string, isError?: boolean): void;
  closeDialog(): void;
  openConversation(id: string): Promise<void>;
  setImporting(on: boolean): void;
}

export interface ImportContext {
  api: ImportApi;
  loggedIn(): boolean;
  chatBusy(): boolean;
  ui: ImportUi;
}

export interface ImportOpenInfo {
  models: ImportModel[];
  selectedId: number | null;
}

export interface ImportController {
  open(): ImportOpenInfo | null;
  submit(input: { link: string; agentId: number }): Promise<void>;
  close(): boolean;
  importing(): boolean;
  onLogout(): void;
}

const MSG_LOGIN = "Connecte-toi pour importer une conversation.";
const MSG_LINK = "Saisis un lien public ChatGPT de la forme https://…/share/{identifiant}.";
const MSG_MODEL = "Choisis un modèle disponible.";
const MSG_NO_MODEL = "Aucun modèle disponible pour l’import pour le moment.";
const MSG_ARCHIVED = "Cette conversation a déjà été importée, mais elle est archivée. Restaure-la depuis les conversations archivées.";
const MSG_EXISTING = "Cette conversation a déjà été importée : ouverture de la conversation existante.";
const MSG_DEFERRED = "Conversation importée. Ouvre-la depuis l’historique quand la réponse en cours sera terminée.";
const CHECK_HISTORY = "Vérifie ton historique avant de réessayer : l’import a peut-être abouti.";

export function parseShareLink(value: unknown): ShareLink | null {
  const text = String(value || "").trim();
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const match = /^\/share\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || !UUID.test(match[1])) return null;
  return { link: text, shareId: match[1].toLowerCase() };
}

export function describeFailure(error: { status?: number; detail?: string; message?: string; unexpected?: boolean }): string {
  const status = error.status;
  const detail = error.detail ? " (" + error.detail + ")" : "";
  if (status === 400 || status === 422) return "Le serveur a refusé ce lien ou ce modèle" + detail + ". Vérifie que le lien est un lien de partage public ChatGPT.";
  if (status === 401) return "Session expirée. Reconnecte-toi puis réessaie.";
  if (status === 403) return "Import non autorisé pour ce compte" + detail + ".";
  if (status === 404) return "Conversation introuvable" + detail + ". Vérifie que le lien de partage est public.";
  if (status === 429 && error.message) return error.message;
  if (typeof status === "number" && status >= 500) return "Le serveur est momentanément indisponible. " + CHECK_HISTORY;
  if (status) return "Import impossible (HTTP " + status + ")" + detail + ".";
  if (error.unexpected && error.message) return error.message;
  return "Connexion impossible : " + (error.message || "erreur inconnue") + ". " + CHECK_HISTORY;
}

export function importedToast(count: number | null | undefined): string {
  if (typeof count !== "number" || !Number.isInteger(count)) return "Conversation importée.";
  return "Conversation importée (" + count + " message" + (count > 1 ? "s" : "") + ").";
}

export function createImportController(context: ImportContext): ImportController {
  const { api, ui } = context;
  let importing = false;
  let generation = 0;
  let models: ImportModel[] = [];

  async function openSafely(id: string): Promise<void> {
    if (context.chatBusy()) {
      ui.toast(MSG_DEFERRED);
      return;
    }
    await ui.openConversation(id);
  }

  function open(): ImportOpenInfo | null {
    if (!context.loggedIn()) {
      ui.toast(MSG_LOGIN, true);
      return null;
    }
    generation += 1;
    const info = api.models();
    models = info.models;
    if (!models.length) ui.setStatus(MSG_NO_MODEL, true);
    const selected = models.find(model => model.id === info.currentId) || models[0] || null;
    return { models, selectedId: selected ? selected.id : null };
  }

  async function submit(input: { link: string; agentId: number }): Promise<void> {
    if (importing) return;
    if (!context.loggedIn()) { ui.setStatus(MSG_LOGIN, true); return; }
    const parsed = parseShareLink(input.link);
    if (!parsed) { ui.setStatus(MSG_LINK, true); return; }
    if (!models.some(model => model.id === input.agentId)) { ui.setStatus(MSG_MODEL, true); return; }

    const existing = api.findExisting(parsed.shareId);
    if (existing) {
      if (existing.serverArchived) { ui.setStatus(MSG_ARCHIVED, true); return; }
      generation += 1;
      ui.closeDialog();
      ui.toast(MSG_EXISTING);
      await openSafely(existing.id);
      return;
    }

    const mine = generation;
    importing = true;
    ui.setStatus("Import en cours…", false);
    ui.setImporting(true);
    let outcome: ImportOutcome;
    try {
      outcome = await api.run({ link: parsed.link, shareId: parsed.shareId, agentId: input.agentId });
    } catch (error) {
      outcome = { ok: false, message: error instanceof Error ? error.message : "" };
    } finally {
      importing = false;
      ui.setImporting(false);
    }

    if (outcome.aborted) return;
    if (!outcome.ok) {
      if (mine !== generation) return;
      if (outcome.noSession) ui.setStatus(MSG_LOGIN, true);
      else if (outcome.noModel) ui.setStatus(MSG_MODEL, true);
      else ui.setStatus(describeFailure(outcome), true);
      return;
    }
    if (mine === generation) {
      generation += 1;
      ui.closeDialog();
    }
    ui.toast(importedToast(outcome.count));
    if (outcome.id) await openSafely(outcome.id);
  }

  function close(): boolean {
    if (importing) return false;
    generation += 1;
    ui.closeDialog();
    return true;
  }

  function onLogout(): void {
    generation += 1;
    ui.closeDialog();
  }

  return { open, submit, close, importing: () => importing, onLogout };
}
