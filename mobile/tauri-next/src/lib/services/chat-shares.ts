// Partage d'une conversation : mêmes règles que l'ancien mobile/www/js/chat-shares.js, sans DOM.
// Le serveur décide de la liste et des droits ; ici on ne fait que présenter, valider la saisie et enchaîner les appels.

export type SharePermission = "View" | "Write";

export interface ShareUser {
  userId: number | null;
  userEmail: string;
  owner: boolean;
  permission: SharePermission | "";
}

export interface ShareRow {
  key: string;
  label: string;
  owner: boolean;
  canChange: boolean;
  canRemove: boolean;
  changeLabel: string;
  nextPermission: SharePermission | "";
}

export interface ShareView {
  rows: ShareRow[];
  canInvite: boolean;
  status: string;
  busy: boolean;
}

export interface ShareMe {
  id: number | null;
  email: string;
}

export interface ShareTarget {
  chatId: string;
  me: ShareMe;
}

export interface ShareRequest {
  localId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
}

export interface ShareResult {
  ok: boolean;
  data?: unknown;
  noSession?: boolean;
  notSynced?: boolean;
  aborted?: boolean;
  status?: number;
  message?: string;
}

export interface SharesApi {
  target(localId: string): ShareTarget | null;
  call(request: ShareRequest): Promise<ShareResult>;
}

export interface SharesUi {
  openDialog(): void;
  setView(view: ShareView): void;
  toast(text: string): void;
  confirm(text: string): Promise<boolean>;
  closeDialog(): void;
}

export type ShareIdentifier = { userId: number } | { userEmail: string };

const NOT_SYNCED = "Cette conversation doit d’abord être synchronisée.";
const SESSION_EXPIRED = "Session expirée. Reconnecte-toi puis réessaie.";
const UNEXPECTED = "Réponse inattendue du serveur.";
const EMAIL = /^[^\s@]+@[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseShareUsers(data: unknown): ShareUser[] | null {
  if (!Array.isArray(data)) return null;
  const users: ShareUser[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const permission = item.permission === "View" || item.permission === "Write" ? item.permission : "";
    users.push({
      userId: typeof item.userId === "number" && Number.isInteger(item.userId) ? item.userId : null,
      userEmail: typeof item.userEmail === "string" ? item.userEmail : "",
      owner: item.owner === true,
      permission
    });
  }
  return users;
}

export function shareTarget(user: ShareUser): ShareIdentifier | null {
  if (user.userId !== null && Number.isInteger(user.userId)) return { userId: user.userId };
  if (user.userEmail) return { userEmail: user.userEmail };
  return null;
}

export function isShareOwner(users: ShareUser[], me: ShareMe): boolean {
  const email = me.email ? me.email.toLowerCase() : "";
  return users.some(user => {
    if (!user.owner) return false;
    if (me.id !== null && Number.isInteger(me.id) && me.id === user.userId) return true;
    return Boolean(email && user.userEmail && email === user.userEmail.toLowerCase());
  });
}

function roleText(user: ShareUser): string {
  if (user.owner) return "Propriétaire";
  if (user.permission === "Write") return "Écriture";
  if (user.permission === "View") return "Lecture";
  return "Droits inconnus";
}

function rowKey(user: ShareUser, index: number): string {
  const base = user.userId !== null ? "u:" + user.userId : user.userEmail ? "e:" + user.userEmail.toLowerCase() : "i";
  return base + "#" + index;
}

export function shareRows(users: ShareUser[], owner: boolean): ShareRow[] {
  return users.map((user, index) => {
    const identified = shareTarget(user) !== null;
    const manageable = owner && !user.owner && identified;
    const known = user.permission === "View" || user.permission === "Write";
    const name = user.userEmail || (user.userId !== null ? "Utilisateur " + user.userId : "Utilisateur");
    return {
      key: rowKey(user, index),
      label: name + " · " + roleText(user),
      owner: user.owner,
      canChange: manageable && known,
      canRemove: manageable,
      changeLabel: user.permission === "Write" ? "Passer en lecture" : "Autoriser l’écriture",
      nextPermission: user.permission === "Write" ? "View" : user.permission === "View" ? "Write" : ""
    };
  });
}

function failureText(result: ShareResult): string {
  if (result.noSession) return SESSION_EXPIRED;
  if (result.notSynced) return NOT_SYNCED;
  const message = typeof result.message === "string" ? result.message.trim() : "";
  return message || "Erreur inconnue.";
}

function thrownText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Erreur inconnue.";
}

export interface SharesController {
  open(localId: string): Promise<boolean>;
  grant(email: string, permission: string): Promise<void>;
  changePermission(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  close(): void;
  onLogout(): void;
}

export function createSharesController(context: { api: SharesApi; ui: SharesUi }): SharesController {
  const { api, ui } = context;
  let generation = 0;
  let request = 0;
  let opened = false;
  let busy = false;
  let localId = "";
  let me: ShareMe = { id: null, email: "" };
  let users: ShareUser[] = [];
  let owner = false;
  let status = "";

  const live = (token: number): boolean => opened && token === generation;

  function publish(): void {
    ui.setView({ rows: shareRows(users, owner), canInvite: owner, status, busy });
  }

  function loadFailed(text: string): void {
    users = [];
    owner = false;
    status = "Chargement impossible : " + text;
    publish();
  }

  async function refresh(token: number): Promise<void> {
    const version = ++request;
    status = "Chargement des accès…";
    publish();
    let result: ShareResult;
    try {
      result = await api.call({ localId, method: "GET" });
    } catch (error) {
      if (live(token) && version === request) loadFailed(thrownText(error));
      return;
    }
    if (!live(token) || version !== request || result.aborted) return;
    if (!result.ok) {
      loadFailed(failureText(result));
      return;
    }
    const parsed = parseShareUsers(result.data);
    if (!parsed) {
      loadFailed(UNEXPECTED);
      return;
    }
    users = parsed;
    owner = isShareOwner(parsed, me);
    status = parsed.length ? "" : "Aucun accès affiché.";
    publish();
  }

  async function mutate(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, token: number): Promise<void> {
    busy = true;
    status = "Enregistrement…";
    publish();
    let result: ShareResult;
    try {
      result = await api.call({ localId, method, body });
    } catch (error) {
      result = { ok: false, message: thrownText(error) };
    }
    if (!live(token)) return;
    if (result.aborted) {
      busy = false;
      publish();
      return;
    }
    if (!result.ok) {
      busy = false;
      status = "Modification impossible : " + failureText(result);
      publish();
      return;
    }
    await refresh(token);
    if (!live(token)) return;
    busy = false;
    publish();
  }

  function find(key: string): { user: ShareUser; row: ShareRow } | null {
    const rows = shareRows(users, owner);
    const index = rows.findIndex(row => row.key === key);
    return index < 0 ? null : { user: users[index], row: rows[index] };
  }

  return {
    async open(id) {
      const target = api.target(id);
      if (!target) {
        ui.toast(NOT_SYNCED);
        return false;
      }
      generation += 1;
      request += 1;
      const token = generation;
      opened = true;
      busy = false;
      localId = id;
      me = target.me;
      users = [];
      owner = false;
      status = "";
      ui.openDialog();
      await refresh(token);
      return true;
    },

    async grant(email, permission) {
      if (!opened || busy || !owner) return;
      const address = String(email || "").trim();
      if (!EMAIL.test(address)) {
        status = "Adresse e-mail invalide.";
        publish();
        return;
      }
      if (permission !== "View" && permission !== "Write") {
        status = "Permission inconnue.";
        publish();
        return;
      }
      await mutate("POST", { userEmail: address, permission }, generation);
    },

    async changePermission(key) {
      if (!opened || busy || !owner) return;
      const found = find(key);
      if (!found || !found.row.canChange || !found.row.nextPermission) return;
      const identifier = shareTarget(found.user);
      if (!identifier) return;
      await mutate("PATCH", { ...identifier, permission: found.row.nextPermission }, generation);
    },

    async remove(key) {
      if (!opened || busy || !owner) return;
      const found = find(key);
      if (!found || !found.row.canRemove) return;
      const identifier = shareTarget(found.user);
      if (!identifier) return;
      const token = generation;
      const accepted = await ui.confirm("Retirer cet accès à la conversation ?");
      if (!accepted || !live(token) || busy) return;
      await mutate("DELETE", { ...identifier }, token);
    },

    close() {
      opened = false;
      busy = false;
      generation += 1;
      request += 1;
    },

    onLogout() {
      if (!opened) return;
      opened = false;
      busy = false;
      generation += 1;
      request += 1;
      ui.closeDialog();
    }
  };
}
