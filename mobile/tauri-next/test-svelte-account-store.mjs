// Store de Paramètres > Compte : chargements (profil, quota, activité, sessions), verrous, annulation, partage,
// photo de profil, révocation de sessions avec confirmation, déconnexion. Dépendances injectées : aucun réseau.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const { ApiError } = await import("./src/lib/services/api-client.ts");

let count = 0;
async function test(name, fn) {
  try {
    await fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const AVATAR = "data:image/jpeg;base64,AAAA";
const USAGE = { chatBudget: { usedPercent: 42, remainingPercent: 58 } };
const TOKENS = { totalTokenCount: 5000, last7DaysTokenUsage: [{ date: "2026-11-19", inputTokens: 10, outputTokens: 20, totalTokens: 30 }] };
const SESSIONS = [
  { id: "s1", since: "2026-11-01T10:00:00Z", os: "iOS 18", location: "Paris", lastActiveAt: "2026-11-20T08:00:00Z" },
  { id: "s2", since: "2026-10-01T10:00:00Z", os: "Windows 11", location: "Lyon", lastActiveAt: "2026-11-10T08:00:00Z" }
];

const server = await createServer({
  root: here,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null }
});

try {
  const { AccountStore } = await server.ssrLoadModule("/src/lib/stores/account.svelte.ts");

  function harness() {
    const calls = [];
    const events = [];
    const toasts = [];
    const saved = [];
    const shared = [];
    const routes = {
      "GET /user/me": () => ({ name: "Alice", email: "a@b.fr" }),
      "GET /user/usage": () => USAGE,
      "GET /user/tokenusage?tokenUsageDays=343": () => TOKENS,
      "GET /user/sessions": () => SESSIONS,
      "DELETE /user/sessions": () => null,
      "DELETE /user/sessions/s1": () => null,
      "DELETE /user/sessions/s2": () => null
    };
    const api = {
      json: async (apiPath, call = {}) => {
        const key = `${call.method ?? "GET"} ${apiPath}`;
        calls.push({ key, signal: call.signal });
        const handler = routes[key];
        if (!handler) throw new ApiError(`Route inconnue ${key}`, 404);
        return handler();
      }
    };
    let profile = { name: "", email: "" };
    let avatar = "";
    const local = {
      failAvatar: "",
      failSignOut: "",
      read: () => ({ profile: { ...profile }, avatar }),
      saveProfile(next) {
        events.push(["saveProfile", next]);
        profile = { ...next };
      },
      setAvatar(dataUrl) {
        events.push(["setAvatar", dataUrl]);
        if (local.failAvatar) throw new Error(local.failAvatar);
        avatar = dataUrl;
      },
      removeAvatar() {
        events.push(["removeAvatar"]);
        avatar = "";
      },
      async signOut() {
        events.push(["signOut"]);
        if (local.failSignOut) throw new Error(local.failSignOut);
      }
    };
    const deps = {
      api,
      local,
      saver: async (name, bytes) => void saved.push([name, new TextDecoder().decode(bytes)]),
      share: null,
      readAvatar: async () => AVATAR,
      now: () => new Date(2026, 10, 20, 9, 0),
      toast: (text, isError) => void toasts.push([text, isError === true]),
      signedOut: async () => void events.push(["signedOut"])
    };
    const store = new AccountStore(deps);
    return { store, deps, calls, events, toasts, saved, shared, routes, local };
  }

  const keys = h => h.calls.map(call => call.key);
  const image = { type: "image/png", name: "moi.png" };

  await test("avant ouverture : textes d'attente de l'écran historique, rien chargé", () => {
    const h = harness();
    assert.equal(h.store.quotaMessage, "Ouvre ce menu pour charger le quota.");
    assert.equal(h.store.quotaView, null);
    assert.equal(h.store.activityStatus, "");
    assert.equal(h.store.activitySummary, null);
    assert.equal(h.store.shareDisabled, true);
    assert.equal(h.store.displayName, "Mon compte");
    assert.deepEqual(h.calls, []);
  });

  await test("activate : profil, quota, activité et sessions chargés ; le profil serveur est enregistré en local", async () => {
    const h = harness();
    await h.store.activate();
    assert.deepEqual(keys(h).sort(), ["GET /user/me", "GET /user/sessions", "GET /user/tokenusage?tokenUsageDays=343", "GET /user/usage"]);
    assert.equal(h.store.displayName, "Alice");
    assert.deepEqual(h.store.profile, { name: "Alice", email: "a@b.fr" });
    assert.deepEqual(h.events.filter(event => event[0] === "saveProfile"), [["saveProfile", { name: "Alice", email: "a@b.fr" }]]);
    assert.equal(h.store.quotaState, "ready");
    assert.equal(h.store.quotaView.label, "42 %");
    assert.equal(h.store.activityStatus, "Historique journalier disponible sur les 343 derniers jours.");
    assert.equal(h.store.activitySummary.total, 30);
    assert.equal(h.store.shareDisabled, false);
    assert.equal(h.store.activityCalendar.cells.length, 343);
    assert.equal(h.store.activityMetrics[0].value.length > 0, true);
    assert.equal(h.store.sessionsState, "ready");
    assert.deepEqual(h.store.sessions.map(session => session.id), ["s1", "s2"]);
  });

  await test("profil : un profil serveur inchangé n'est pas réécrit ; une panne de /user/me est silencieuse", async () => {
    const h = harness();
    h.local.saveProfile({ name: "Alice", email: "a@b.fr" });
    h.events.length = 0;
    await h.store.activate();
    assert.deepEqual(h.events.filter(event => event[0] === "saveProfile"), []);
    const failing = harness();
    failing.routes["GET /user/me"] = () => {
      throw new ApiError("Erreur 500", 500);
    };
    await failing.store.activate();
    assert.equal(failing.store.displayName, "Mon compte");
    assert.equal(failing.store.quotaState, "ready");
    assert.deepEqual(failing.toasts, []);
  });

  await test("chargement en cours : textes, actualisation et partage bloqués, contenu masqué", async () => {
    const h = harness();
    const usage = deferred();
    const tokens = deferred();
    h.routes["GET /user/usage"] = () => usage.promise;
    h.routes["GET /user/tokenusage?tokenUsageDays=343"] = () => tokens.promise;
    const loading = h.store.activate();
    await tick();
    assert.equal(h.store.quotaState, "loading");
    assert.equal(h.store.quotaMessage, "Chargement…");
    assert.equal(h.store.activityLoading, true);
    assert.equal(h.store.activityStatus, "Chargement de l’activité…");
    assert.equal(h.store.activitySummary, null);
    assert.equal(h.store.shareDisabled, true);
    usage.resolve(USAGE);
    tokens.resolve(TOKENS);
    await loading;
    assert.equal(h.store.activityLoading, false);
    assert.equal(h.store.shareDisabled, false);
  });

  await test("verrous : une actualisation pendant le chargement n'envoie pas de seconde requête", async () => {
    const h = harness();
    const usage = deferred();
    h.routes["GET /user/usage"] = () => usage.promise;
    const first = h.store.refreshQuota();
    const second = h.store.refreshQuota();
    await tick();
    assert.equal(keys(h).filter(key => key === "GET /user/usage").length, 1);
    usage.resolve(USAGE);
    await Promise.all([first, second]);
    await h.store.refreshActivity();
    const again = h.store.refreshActivity();
    const third = h.store.refreshActivity();
    await Promise.all([again, third]);
    assert.equal(keys(h).filter(key => key.startsWith("GET /user/tokenusage")).length, 3);
  });

  await test("quota : budget absent, erreur du serveur puis nouvelle tentative", async () => {
    const h = harness();
    h.routes["GET /user/usage"] = () => ({});
    await h.store.refreshQuota();
    assert.equal(h.store.quotaState, "empty");
    assert.equal(h.store.quotaMessage, "Budget du jour non communiqué par le serveur.");
    h.routes["GET /user/usage"] = () => {
      throw new ApiError("Erreur 500", 500);
    };
    await h.store.refreshQuota();
    assert.equal(h.store.quotaState, "error");
    assert.equal(h.store.quotaMessage, "Quota indisponible (Erreur 500).");
    assert.equal(h.store.quotaView, null);
    h.routes["GET /user/usage"] = () => USAGE;
    await h.store.refreshQuota();
    assert.equal(h.store.quotaState, "ready");
    assert.equal(h.store.quotaView.note, "58 % restant");
  });

  await test("activité : erreur lisible, réponse illisible, puis nouvelle tentative qui réussit", async () => {
    const h = harness();
    h.routes["GET /user/tokenusage?tokenUsageDays=343"] = () => {
      throw new ApiError("Erreur 503", 503);
    };
    await h.store.refreshActivity();
    assert.equal(h.store.activityStatus, "Activité indisponible : Erreur 503");
    assert.equal(h.store.activitySummary, null);
    assert.equal(h.store.shareDisabled, true);
    assert.equal(h.store.activityLoading, false);
    h.routes["GET /user/tokenusage?tokenUsageDays=343"] = () => null;
    await h.store.refreshActivity();
    assert.equal(h.store.activityStatus, "Activité indisponible : Réponse du serveur illisible.");
    h.routes["GET /user/tokenusage?tokenUsageDays=343"] = () => TOKENS;
    await h.store.refreshActivity();
    assert.equal(h.store.activityStatus, "Historique journalier disponible sur les 343 derniers jours.");
  });

  await test("fermeture : les requêtes en cours sont annulées et leurs réponses tardives ignorées", async () => {
    const h = harness();
    const usage = deferred();
    const tokens = deferred();
    h.routes["GET /user/usage"] = () => usage.promise;
    h.routes["GET /user/tokenusage?tokenUsageDays=343"] = () => tokens.promise;
    const loading = h.store.activate();
    await tick();
    h.store.stop();
    assert.ok(h.calls.every(call => call.signal?.aborted === true));
    assert.equal(h.store.activityLoading, false);
    assert.equal(h.store.quotaState === "loading", false);
    usage.resolve(USAGE);
    tokens.resolve(TOKENS);
    await loading;
    assert.equal(h.store.quotaView, null);
    assert.equal(h.store.activitySummary, null);
    const reopened = harness();
    await reopened.store.activate();
    reopened.store.stop();
    await reopened.store.activate();
    assert.equal(reopened.store.quotaState, "ready");
    assert.equal(keys(reopened).filter(key => key === "GET /user/usage").length, 2);
  });

  await test("calendrier : choisir une case affiche son libellé dans le statut", async () => {
    const h = harness();
    await h.store.activate();
    h.store.selectCell("2026-11-19 : 30 tokens");
    assert.equal(h.store.activityStatus, "2026-11-19 : 30 tokens");
  });

  await test("partage : feuille de partage du système, annulation ignorée, autre erreur affichée", async () => {
    const h = harness();
    await h.store.activate();
    const sent = [];
    h.deps.share = async data => void sent.push(data);
    await h.store.shareActivity();
    assert.deepEqual(sent, [{ title: "Mon activité FranceStudent", text: "Mon activité FranceStudent : 30 tokens sur 1 jours renseignés, 1 jours actifs." }]);
    assert.equal(h.store.activityStatus, "Historique journalier disponible sur les 343 derniers jours.");
    h.deps.share = async () => {
      throw new DOMException("annulé", "AbortError");
    };
    await h.store.shareActivity();
    assert.equal(h.store.activityStatus, "Historique journalier disponible sur les 343 derniers jours.");
    h.deps.share = async () => {
      throw new Error("Partage refusé");
    };
    await h.store.shareActivity();
    assert.equal(h.store.activityStatus, "Partage impossible : Partage refusé");
  });

  await test("partage sans feuille système : fichier CSV enregistré", async () => {
    const h = harness();
    await h.store.activate();
    await h.store.shareActivity();
    assert.deepEqual(h.saved, [["activite-francestudent.csv", "Date;Input;Output;Reasoning;Total\n2026-11-19;10;20;0;30"]]);
    assert.equal(h.store.activityStatus, "Historique téléchargé au format CSV.");
    h.deps.saver = async () => {
      throw new Error("Enregistrement annulé.");
    };
    await h.store.shareActivity();
    assert.equal(h.store.activityStatus, "Partage impossible : Enregistrement annulé.");
  });

  await test("partage : sans historique chargé, rien n'est envoyé", async () => {
    const h = harness();
    await h.store.shareActivity();
    assert.deepEqual(h.saved, []);
  });

  await test("photo : fichier image lu, enregistré, affichée et annoncée", async () => {
    const h = harness();
    await h.store.changeAvatar(image);
    assert.deepEqual(h.events, [["setAvatar", AVATAR]]);
    assert.equal(h.store.avatar, AVATAR);
    assert.equal(h.store.hasCustomAvatar, true);
    assert.deepEqual(h.toasts, [["Photo de profil mise à jour.", false]]);
  });

  await test("photo : fichier non image refusé, lecture impossible, stockage plein", async () => {
    const h = harness();
    await h.store.changeAvatar({ type: "application/pdf", name: "a.pdf" });
    assert.deepEqual(h.toasts.pop(), ["Choisis un fichier image.", true]);
    await h.store.changeAvatar(null);
    assert.equal(h.toasts.length, 0);
    h.deps.readAvatar = async () => {
      throw new Error("Image illisible");
    };
    await h.store.changeAvatar(image);
    assert.deepEqual(h.toasts.pop(), ["Impossible de lire cette image.", true]);
    h.deps.readAvatar = async () => AVATAR;
    h.local.failAvatar = "Stockage plein : impossible d'enregistrer la photo.";
    await h.store.changeAvatar(image);
    assert.deepEqual(h.toasts.pop(), ["Stockage plein : impossible d'enregistrer la photo.", true]);
    assert.equal(h.store.avatar, "");
    assert.equal(h.store.hasCustomAvatar, false);
    assert.deepEqual(h.events.filter(event => event[0] === "setAvatar").length, 1);
  });

  await test("photo : retirer la photo", async () => {
    const h = harness();
    await h.store.changeAvatar(image);
    h.toasts.length = 0;
    h.store.removeAvatar();
    assert.equal(h.store.avatar, "");
    assert.equal(h.store.hasCustomAvatar, false);
    assert.deepEqual(h.toasts, [["Photo de profil retirée.", false]]);
  });

  await test("photo : un échec de suppression conserve la photo affichée", async () => {
    const h = harness();
    await h.store.changeAvatar(image);
    h.toasts.length = 0;
    h.local.removeAvatar = () => { throw new Error("Stockage indisponible"); };
    h.store.removeAvatar();
    assert.equal(h.store.avatar, AVATAR);
    assert.deepEqual(h.toasts, [["Stockage indisponible", true]]);
  });

  await test("photo : la barre latérale est prévenue du changement et du retrait, pas d'un échec", async () => {
    const h = harness();
    const seen = [];
    h.deps.avatarChanged = value => void seen.push(value);
    await h.store.changeAvatar(image);
    h.store.removeAvatar();
    assert.deepEqual(seen, [AVATAR, ""]);
    h.local.failAvatar = "Stockage plein : impossible d'enregistrer la photo.";
    await h.store.changeAvatar(image);
    assert.deepEqual(seen, [AVATAR, ""]);
  });

  await test("sessions : liste vide, erreur lisible, nouvelle tentative", async () => {
    const h = harness();
    h.routes["GET /user/sessions"] = () => [];
    await h.store.refreshSessions();
    assert.equal(h.store.sessionsState, "ready");
    assert.equal(h.store.sessionsMessage, "Aucune session active.");
    h.routes["GET /user/sessions"] = () => {
      throw new ApiError("Erreur 500", 500);
    };
    await h.store.refreshSessions();
    assert.equal(h.store.sessionsState, "error");
    assert.equal(h.store.sessionsMessage, "Sessions indisponibles : Erreur 500");
    h.routes["GET /user/sessions"] = () => SESSIONS;
    await h.store.refreshSessions();
    assert.equal(h.store.sessionsState, "ready");
    assert.equal(h.store.sessionsMessage, "");
  });

  await test("sessions : aucune révocation sans confirmation, annulation possible", async () => {
    const h = harness();
    await h.store.activate();
    const before = h.calls.length;
    h.store.askRevoke("s1");
    assert.equal(h.store.pendingRevoke, "s1");
    h.store.cancelRevoke();
    assert.equal(h.store.pendingRevoke, null);
    await h.store.confirmRevoke();
    assert.equal(h.calls.length, before);
    h.store.askRevoke("inconnue");
    assert.equal(h.store.pendingRevoke, null);
  });

  await test("sessions : terminer une session confirmée, puis liste actualisée", async () => {
    const h = harness();
    await h.store.activate();
    h.routes["GET /user/sessions"] = () => [SESSIONS[1]];
    h.store.askRevoke("s1");
    await h.store.confirmRevoke();
    assert.ok(keys(h).includes("DELETE /user/sessions/s1"));
    assert.deepEqual(h.store.sessions.map(session => session.id), ["s2"]);
    assert.equal(h.store.pendingRevoke, null);
    assert.equal(h.store.revoking, false);
    assert.deepEqual(h.toasts, [["Session terminée.", false]]);
    assert.equal(h.events.some(event => event[0] === "signOut"), false);
  });

  await test("sessions : échec de la révocation → message, liste conservée", async () => {
    const h = harness();
    await h.store.activate();
    h.routes["DELETE /user/sessions/s2"] = () => {
      throw new ApiError("Erreur 500", 500);
    };
    h.store.askRevoke("s2");
    await h.store.confirmRevoke();
    assert.deepEqual(h.toasts, [["Impossible de terminer la session : Erreur 500", true]]);
    assert.equal(h.store.sessions.length, 2);
    assert.equal(h.store.pendingRevoke, null);
    assert.equal(h.store.revoking, false);
  });

  await test("sessions : si la session de cet appareil est révoquée (401 ensuite), l'appareil est déconnecté", async () => {
    const h = harness();
    await h.store.activate();
    h.routes["GET /user/sessions"] = () => {
      throw new ApiError("Non autorisé", 401);
    };
    h.store.askRevoke("s1");
    await h.store.confirmRevoke();
    assert.deepEqual(h.events.filter(event => event[0] === "signOut" || event[0] === "signedOut").map(event => event[0]), ["signOut", "signedOut"]);
  });

  await test("sessions : terminer toutes les sessions déconnecte aussi cet appareil", async () => {
    const h = harness();
    await h.store.activate();
    h.store.askRevoke("all");
    assert.equal(h.store.pendingRevoke, "all");
    await h.store.confirmRevoke();
    assert.ok(keys(h).includes("DELETE /user/sessions"));
    assert.deepEqual(h.toasts, [["Toutes les sessions ont été terminées.", false]]);
    assert.deepEqual(h.events.filter(event => event[0] === "signOut" || event[0] === "signedOut").map(event => event[0]), ["signOut", "signedOut"]);
  });

  await test("sessions : échec de « terminer toutes » → pas de déconnexion", async () => {
    const h = harness();
    await h.store.activate();
    h.routes["DELETE /user/sessions"] = () => {
      throw new ApiError("Erreur 500", 500);
    };
    h.store.askRevoke("all");
    await h.store.confirmRevoke();
    assert.deepEqual(h.toasts, [["Impossible de terminer les sessions : Erreur 500", true]]);
    assert.equal(h.events.some(event => event[0] === "signOut"), false);
  });

  await test("déconnexion : le moteur local d'abord, puis la session Svelte", async () => {
    const h = harness();
    await h.store.logout();
    assert.deepEqual(h.events.map(event => event[0]), ["signOut", "signedOut"]);
    assert.equal(h.store.signingOut, false);
    assert.equal(h.store.logoutError, "");
  });

  await test("déconnexion : erreur → message, écran inchangé ; double clic ignoré", async () => {
    const h = harness();
    h.local.failSignOut = "Déconnexion impossible : trousseau verrouillé.";
    await h.store.logout();
    assert.equal(h.store.logoutError, "Déconnexion impossible : trousseau verrouillé.");
    assert.equal(h.events.some(event => event[0] === "signedOut"), false);
    assert.equal(h.store.signingOut, false);
    h.local.failSignOut = "";
    const gate = deferred();
    h.local.signOut = async () => {
      h.events.push(["signOut"]);
      await gate.promise;
    };
    const first = h.store.logout();
    const second = h.store.logout();
    await tick();
    assert.equal(h.store.signingOut, true);
    assert.equal(h.events.filter(event => event[0] === "signOut").length, 2);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(h.store.logoutError, "");
    assert.equal(h.events.filter(event => event[0] === "signedOut").length, 1);
  });

  console.log(`ok - ${count} vérifications du store Compte`);
} finally {
  await server.close();
}
