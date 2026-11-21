import {
  ACTIVITY_CSV_NAME,
  ACTIVITY_SHARE_TITLE,
  activityCalendar,
  activityCsv,
  activityMetrics,
  activityShareText,
  isImageFile,
  listSessions,
  loadActivity,
  loadProfile,
  loadQuota,
  profileName,
  revokeAllSessions,
  revokeSession,
  todayInParis
} from "../services/account.ts";
import type { ActivityCalendar, ActivityMetric, ActivitySummary, Profile, QuotaView, UserSession } from "../services/account.ts";
import type { AccountGateway } from "../services/account-local.ts";
import type { ApiClient } from "../services/api-client.ts";
import { errorMessage } from "../utils/errors.ts";

// Onglet Compte des paramètres : profil, photo, budget du jour, activité en tokens, sessions actives, déconnexion.
// Les règles (messages, calculs) sont dans services/account.ts ; ici, seulement l'état de l'écran et son enchaînement.
// Chaque dépendance est relue à chaque appel (`this.#deps.xxx`) : les tests et le shell peuvent les remplacer.

export interface AccountDeps {
  api: ApiClient;
  local: AccountGateway;
  /** Enregistre un fichier sur l'appareil (boîte de dialogue native) ; rejette si l'utilisateur annule. */
  saver: (name: string, bytes: Uint8Array) => Promise<unknown>;
  /** Feuille de partage du système, ou `null` quand elle n'existe pas (repli : export CSV). */
  share: ((data: { title: string; text: string }) => Promise<unknown>) | null;
  /** Réduit l'image choisie en data URL (carré, JPEG). */
  readAvatar: (file: Blob) => Promise<string>;
  now: () => Date;
  toast: (text: string, isError: boolean) => void;
  /** Appelé après la déconnexion locale : renvoie l'application à l'écran de connexion. */
  signedOut: () => Promise<unknown>;
  /** Appelé avec la nouvelle photo (data URL), ou une chaîne vide quand elle est retirée : la barre latérale s'actualise. */
  avatarChanged?: (dataUrl: string) => void;
}

export type QuotaState = "idle" | "loading" | "ready" | "empty" | "error";
export type SessionsState = "idle" | "loading" | "ready" | "error";
export type RevokeTarget = string | "all";

export const QUOTA_IDLE = "Ouvre ce menu pour charger le quota.";
const QUOTA_LOADING = "Chargement…";
const QUOTA_EMPTY = "Budget du jour non communiqué par le serveur.";
const ACTIVITY_LOADING = "Chargement de l’activité…";
const ACTIVITY_READY = "Historique journalier disponible sur les 343 derniers jours.";
const ACTIVITY_EXPORTED = "Historique téléchargé au format CSV.";
const SESSIONS_EMPTY = "Aucune session active.";

/** Code HTTP d'une `ApiError` (lu par son champ `status`, pas par `instanceof`) ; 0 pour toute autre erreur. */
function httpStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 0;
}

export class AccountStore {
  profile = $state.raw<Profile>({ name: "", email: "" });
  avatar = $state("");

  quotaState = $state<QuotaState>("idle");
  quotaView = $state.raw<QuotaView | null>(null);
  quotaMessage = $state(QUOTA_IDLE);

  activityLoading = $state(false);
  activityStatus = $state("");
  activitySummary = $state.raw<ActivitySummary | null>(null);

  sessionsState = $state<SessionsState>("idle");
  sessions = $state.raw<UserSession[]>([]);
  sessionsMessage = $state("");
  pendingRevoke = $state<RevokeTarget | null>(null);
  revoking = $state(false);

  signingOut = $state(false);
  logoutError = $state("");

  readonly #deps: AccountDeps;
  #generation = 0;
  #activityToken = 0;
  #controller = new AbortController();

  constructor(deps: AccountDeps) {
    this.#deps = deps;
    this.#readLocal();
  }

  get displayName(): string {
    return profileName(this.profile);
  }

  get hasCustomAvatar(): boolean {
    return this.avatar !== "";
  }

  get shareDisabled(): boolean {
    return this.activitySummary === null;
  }

  get activityCalendar(): ActivityCalendar | null {
    const summary = this.activitySummary;
    if (!summary) return null;
    return activityCalendar(summary, todayInParis(this.#deps.now()));
  }

  get activityMetrics(): ActivityMetric[] {
    const summary = this.activitySummary;
    return summary ? activityMetrics(summary) : [];
  }

  /** À l'ouverture de l'onglet : relit les données locales puis interroge le serveur (tout en parallèle). */
  async activate(): Promise<void> {
    this.#generation += 1;
    this.#controller.abort();
    this.#controller = new AbortController();
    const generation = this.#generation;
    const signal = this.#controller.signal;
    this.#readLocal();
    await Promise.all([
      this.#syncProfile(generation, signal),
      this.#loadQuota(generation, signal),
      this.#loadActivity(generation, signal),
      this.#loadSessions(generation, signal)
    ]);
  }

  /** À la fermeture de l'onglet : annule les requêtes en cours ; leurs réponses tardives sont ignorées. */
  stop(): void {
    this.#generation += 1;
    this.#controller.abort();
    this.activityLoading = false;
    if (this.quotaState === "loading") this.quotaState = "idle";
    if (this.sessionsState === "loading") this.sessionsState = "idle";
  }

  // --- Budget du jour ---------------------------------------------------------------------------

  async refreshQuota(): Promise<void> {
    if (this.quotaState === "loading") return;
    await this.#loadQuota(this.#generation, this.#controller.signal);
  }

  // --- Activité en tokens -----------------------------------------------------------------------

  /** Pas de verrou : une actualisation plus récente remplace la précédente, dont la réponse est ignorée. */
  async refreshActivity(): Promise<void> {
    await this.#loadActivity(this.#generation, this.#controller.signal);
  }

  /** Une case du calendrier : son libellé (date et tokens) s'affiche dans la ligne d'état. */
  selectCell(label: string): void {
    this.activityStatus = label;
  }

  /** Feuille de partage du système si elle existe, sinon export CSV enregistré sur l'appareil. */
  async shareActivity(): Promise<void> {
    const summary = this.activitySummary;
    if (!summary) return;
    const share = this.#deps.share;
    try {
      if (share) {
        await share({ title: ACTIVITY_SHARE_TITLE, text: activityShareText(summary) });
        return;
      }
      await this.#deps.saver(ACTIVITY_CSV_NAME, new TextEncoder().encode(activityCsv(summary)));
      this.activityStatus = ACTIVITY_EXPORTED;
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      this.activityStatus = "Partage impossible : " + errorMessage(error);
    }
  }

  // --- Photo de profil --------------------------------------------------------------------------

  async changeAvatar(file: Blob | null | undefined): Promise<void> {
    if (!file) return;
    if (!isImageFile(file)) {
      this.#deps.toast("Choisis un fichier image.", true);
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await this.#deps.readAvatar(file);
    } catch {
      this.#deps.toast("Impossible de lire cette image.", true);
      return;
    }
    try {
      this.#deps.local.setAvatar(dataUrl);
    } catch (error) {
      this.#deps.toast(errorMessage(error), true);
      return;
    }
    this.avatar = dataUrl;
    this.#deps.avatarChanged?.(dataUrl);
    this.#deps.toast("Photo de profil mise à jour.", false);
  }

  removeAvatar(): void {
    try {
      this.#deps.local.removeAvatar();
    } catch (error) {
      this.#deps.toast(errorMessage(error), true);
      return;
    }
    this.avatar = "";
    this.#deps.avatarChanged?.("");
    this.#deps.toast("Photo de profil retirée.", false);
  }

  // --- Sessions actives -------------------------------------------------------------------------

  async refreshSessions(): Promise<void> {
    if (this.sessionsState === "loading") return;
    await this.#loadSessions(this.#generation, this.#controller.signal);
  }

  /** Demande de confirmation : une session de la liste, ou `"all"` ; tout autre identifiant est ignoré. */
  askRevoke(target: RevokeTarget): void {
    if (this.revoking) return;
    if (target !== "all" && !this.sessions.some(session => session.id === target)) return;
    this.pendingRevoke = target;
  }

  cancelRevoke(): void {
    if (this.revoking) return;
    this.pendingRevoke = null;
  }

  async confirmRevoke(): Promise<void> {
    const target = this.pendingRevoke;
    if (target === null || this.revoking) return;
    this.revoking = true;
    try {
      if (target === "all") await this.#revokeAll();
      else await this.#revokeOne(target);
    } finally {
      this.pendingRevoke = null;
      this.revoking = false;
    }
  }

  // --- Déconnexion ------------------------------------------------------------------------------

  /** Efface la session locale, puis renvoie l'application à l'écran de connexion. Une erreur laisse l'écran en place. */
  async logout(): Promise<void> {
    if (this.signingOut) return;
    this.signingOut = true;
    this.logoutError = "";
    try {
      await this.#deps.local.signOut();
      await this.#deps.signedOut();
    } catch (error) {
      this.logoutError = errorMessage(error);
    } finally {
      this.signingOut = false;
    }
  }

  // --- Interne ----------------------------------------------------------------------------------

  #readLocal(): void {
    const local = this.#deps.local.read();
    this.profile = { name: local.profile.name, email: local.profile.email };
    this.avatar = local.avatar;
  }

  #current(generation: number): boolean {
    return generation === this.#generation;
  }

  /** Le profil du serveur complète l'affichage ; une panne ne dit rien (le profil mémorisé suffit). */
  async #syncProfile(generation: number, signal: AbortSignal): Promise<void> {
    let fresh: Profile;
    try {
      fresh = await loadProfile(this.#deps.api, signal);
    } catch {
      return;
    }
    if (!this.#current(generation)) return;
    const known = this.profile;
    if (fresh.name === known.name && fresh.email === known.email) return;
    if (!fresh.name && !fresh.email) return;
    this.profile = { name: fresh.name, email: fresh.email };
    try {
      this.#deps.local.saveProfile({ name: fresh.name, email: fresh.email });
    } catch {
      // Le stockage local refuse : le profil affiché reste celui du serveur pour cette session.
    }
  }

  async #loadQuota(generation: number, signal: AbortSignal): Promise<void> {
    this.quotaState = "loading";
    this.quotaMessage = QUOTA_LOADING;
    this.quotaView = null;
    try {
      const view = await loadQuota(this.#deps.api, signal, this.#deps.now());
      if (!this.#current(generation)) return;
      this.quotaView = view;
      this.quotaState = view ? "ready" : "empty";
      this.quotaMessage = view ? "" : QUOTA_EMPTY;
    } catch (error) {
      if (!this.#current(generation)) return;
      this.quotaView = null;
      this.quotaState = "error";
      this.quotaMessage = "Quota indisponible (" + errorMessage(error) + ").";
    }
  }

  async #loadActivity(generation: number, signal: AbortSignal): Promise<void> {
    this.#activityToken += 1;
    const token = this.#activityToken;
    const fresh = () => this.#current(generation) && token === this.#activityToken;
    this.activityLoading = true;
    this.activitySummary = null;
    this.activityStatus = ACTIVITY_LOADING;
    try {
      const summary = await loadActivity(this.#deps.api, signal);
      if (!fresh()) return;
      this.activitySummary = summary;
      this.activityStatus = ACTIVITY_READY;
    } catch (error) {
      if (!fresh()) return;
      this.activityStatus = "Activité indisponible : " + errorMessage(error);
    } finally {
      if (fresh()) this.activityLoading = false;
    }
  }

  /** Renvoie le code HTTP de l'échec (0 si ce n'est pas une réponse HTTP), ou `null` si la liste est à jour. */
  async #loadSessions(generation: number, signal: AbortSignal): Promise<number | null> {
    this.sessionsState = "loading";
    try {
      const list = await listSessions(this.#deps.api, signal);
      if (!this.#current(generation)) return null;
      this.sessions = list;
      this.sessionsState = "ready";
      this.sessionsMessage = list.length === 0 ? SESSIONS_EMPTY : "";
      return null;
    } catch (error) {
      if (!this.#current(generation)) return null;
      this.sessionsState = "error";
      this.sessionsMessage = "Sessions indisponibles : " + errorMessage(error);
      return httpStatus(error);
    }
  }

  async #revokeOne(id: string): Promise<void> {
    try {
      await revokeSession(this.#deps.api, id);
    } catch (error) {
      this.#deps.toast("Impossible de terminer la session : " + errorMessage(error), true);
      return;
    }
    this.#deps.toast("Session terminée.", false);
    const failure = await this.#loadSessions(this.#generation, this.#controller.signal);
    // Si c'était la session de cet appareil, le serveur refuse maintenant le jeton : on revient à l'écran de connexion.
    if (failure === 401) await this.logout();
  }

  async #revokeAll(): Promise<void> {
    try {
      await revokeAllSessions(this.#deps.api);
    } catch (error) {
      this.#deps.toast("Impossible de terminer les sessions : " + errorMessage(error), true);
      return;
    }
    this.#deps.toast("Toutes les sessions ont été terminées.", false);
    await this.logout();
  }
}
