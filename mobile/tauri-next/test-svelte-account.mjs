// Logique de Paramètres > Compte : profil, quota du jour, activité en tokens, sessions, photo de profil.
// Les règles et les messages reprennent mobile/www/js/{models,account-activity,settings}.js ; les sessions (/user/sessions) sont nouvelles.
import assert from "node:assert/strict";

const account = await import("./src/lib/services/account.ts");
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

function fakeApi(handler) {
  const calls = [];
  return {
    calls,
    json: async (path, call = {}) => {
      const entry = { path, method: call.method ?? "GET", body: call.body, signal: call.signal };
      calls.push(entry);
      return handler(entry);
    }
  };
}

const exact = value => new Intl.NumberFormat("fr-FR").format(value);
const compact = value => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);

await test("profil : nom, e-mail et libellé de repli « Mon compte »", () => {
  assert.deepEqual(account.parseProfile({ name: "  Alice ", email: "a@b.fr", extra: 1 }), { name: "Alice", email: "a@b.fr" });
  assert.deepEqual(account.parseProfile(null), { name: "", email: "" });
  assert.deepEqual(account.parseProfile({ name: 4, email: null }), { name: "", email: "" });
  assert.equal(account.profileName({ name: "Alice", email: "a@b.fr" }), "Alice");
  assert.equal(account.profileName({ name: "", email: "a@b.fr" }), "a@b.fr");
  assert.equal(account.profileName({ name: "", email: "" }), "Mon compte");
});

await test("loadProfile : GET /user/me, réponse non objet → profil vide", async () => {
  const api = fakeApi(() => ({ name: "Alice", email: "a@b.fr" }));
  assert.deepEqual(await account.loadProfile(api), { name: "Alice", email: "a@b.fr" });
  assert.deepEqual(api.calls.map(call => [call.method, call.path]), [["GET", "/user/me"]]);
  assert.deepEqual(await account.loadProfile(fakeApi(() => null)), { name: "", email: "" });
});

await test("prénom : remplacement sur le compte avec conservation du nom de famille", async () => {
  const api = fakeApi(() => ({ name: "Anne Marie Martin", email: "a@b.fr" }));
  const original = { name: "Léa Martin", email: "a@b.fr" };
  assert.equal(account.profileFirstName(original), "Léa");
  const updated = await account.updateFirstName(api, original, " Anne  Marie ");
  assert.equal(account.profileFirstName(updated), "Anne Marie");
  assert.deepEqual(api.calls.map(({ method, path, body }) => [method, path, body]), [
    ["PATCH", "/user/@me", { name: "Anne Marie Martin" }]
  ]);
  await assert.rejects(account.updateFirstName(fakeApi(() => original), updated, "Alice"), /n’a pas confirmé/);
});

await test("réinitialisation du quota : même jour, autre jour, valeur absente ou illisible", () => {
  const now = new Date(2026, 10, 20, 9, 0);
  assert.equal(account.formatReset(new Date(2026, 10, 20, 18, 5).toISOString(), now), "Réinitialisation à 18:05");
  assert.match(account.formatReset(new Date(2026, 10, 21, 0, 30).toISOString(), now), /^Réinitialisation le 21 nov\.? à 00:30$/);
  assert.equal(account.formatReset("", now), "");
  assert.equal(account.formatReset(undefined, now), "");
  assert.equal(account.formatReset("pas une date", now), "");
});

await test("quota : pourcentage borné, arrondi, niveau d'alerte et note", () => {
  const now = new Date(2026, 10, 20, 9, 0);
  const reset = new Date(2026, 10, 20, 18, 5).toISOString();
  const view = account.quotaView({ chatBudget: { usedPercent: 42.4, remainingPercent: 57.6, resetAt: reset } }, now);
  assert.deepEqual(view, { percent: 42.4, label: "42 %", level: "", note: "58 % restant · Réinitialisation à 18:05" });
  assert.equal(account.quotaView({ chatBudget: { usedPercent: 70, remainingPercent: 30 } }, now)?.level, "warn");
  assert.equal(account.quotaView({ chatBudget: { usedPercent: 69.9, remainingPercent: 30 } }, now)?.level, "");
  assert.equal(account.quotaView({ chatBudget: { usedPercent: 90, remainingPercent: 10 } }, now)?.level, "danger");
  assert.deepEqual(account.quotaView({ chatBudget: { usedPercent: 250, remainingPercent: -3 } }, now), { percent: 100, label: "100 %", level: "danger", note: "-3 % restant" });
  assert.deepEqual(account.quotaView({ chatBudget: { usedPercent: -5, remainingPercent: "x" } }, now), { percent: 0, label: "0 %", level: "", note: "0 % restant" });
});

await test("quota : budget absent ou non objet → null ; les autres limites ne sont pas affichées", () => {
  assert.equal(account.quotaView({}, new Date()), null);
  assert.equal(account.quotaView({ chatBudget: "x" }, new Date()), null);
  assert.equal(account.quotaView({ chatBudget: null, rateLimits: [{ type: "daily" }] }, new Date()), null);
  assert.equal(account.quotaView(null, new Date()), null);
});

await test("loadQuota : GET /user/usage, transmet le signal, remonte les erreurs du serveur", async () => {
  const controller = new AbortController();
  const api = fakeApi(() => ({ chatBudget: { usedPercent: 10, remainingPercent: 90 } }));
  const view = await account.loadQuota(api, controller.signal);
  assert.equal(view?.label, "10 %");
  assert.deepEqual(api.calls.map(call => [call.method, call.path, call.signal === controller.signal]), [["GET", "/user/usage", true]]);
  const empty = fakeApi(() => ({}));
  assert.equal(await account.loadQuota(empty), null);
  const failing = fakeApi(() => {
    throw new ApiError("Erreur 500", 500);
  });
  await assert.rejects(() => account.loadQuota(failing), /Erreur 500/);
});

await test("activité : agrège les lignes valides (date ISO tronquée, nombres ≥ 0, dernière ligne d'un jour gagnante)", () => {
  const summary = account.summarizeActivity({
    totalTokenCount: 12345,
    last7DaysTokenUsage: [
      { date: "2026-11-18T00:00:00Z", inputTokens: 10, outputTokens: 20, reasoningTokens: 5, totalTokens: 35 },
      { date: "2026-11-19", inputTokens: 100, outputTokens: 200 },
      { date: "n'importe quoi", inputTokens: 999 },
      { date: "2026-11-17", inputTokens: -5, outputTokens: "x", totalTokens: 0 },
      { date: "2026-11-19", inputTokens: 1, outputTokens: 2 }
    ]
  });
  assert.deepEqual(summary.rows.map(row => row.date), ["2026-11-17", "2026-11-18", "2026-11-19"]);
  assert.deepEqual(summary.rows[2], { date: "2026-11-19", input: 1, output: 2, reasoning: 0, total: 3 });
  assert.equal(summary.total, 38);
  assert.equal(summary.input, 11);
  assert.equal(summary.output, 22);
  assert.equal(summary.reasoning, 5);
  assert.equal(summary.active, 2);
  assert.equal(summary.average, 38 / 3);
  assert.deepEqual(summary.peak, { date: "2026-11-18", input: 10, output: 20, reasoning: 5, total: 35 });
  assert.equal(summary.lifetime, 12345);
});

await test("activité : sans ligne ni cumul, valeurs neutres", () => {
  const summary = account.summarizeActivity({ last7DaysTokenUsage: "x", totalTokenCount: "12" });
  assert.deepEqual(summary.rows, []);
  assert.equal(summary.total, 0);
  assert.equal(summary.average, 0);
  assert.deepEqual(summary.peak, { date: "", total: 0 });
  assert.equal(summary.lifetime, null);
  assert.equal(account.summarizeActivity({ totalTokenCount: 0 }).lifetime, 0);
});

await test("activité : premier pic strict en cas d'égalité", () => {
  const summary = account.summarizeActivity({ last7DaysTokenUsage: [{ date: "2026-11-02", totalTokens: 7 }, { date: "2026-11-01", totalTokens: 7 }] });
  assert.equal(summary.peak.date, "2026-11-01");
});

await test("activité : métriques du bandeau, « — » sans donnée", () => {
  const summary = account.summarizeActivity({ totalTokenCount: 1500, last7DaysTokenUsage: [{ date: "2026-11-01", totalTokens: 1000 }, { date: "2026-11-02", totalTokens: 0 }] });
  assert.deepEqual(account.activityMetrics(summary), [
    { label: "Tokens totaux", value: compact(1500) },
    { label: "Pic journalier", value: compact(1000) },
    { label: "Jours actifs", value: compact(1) },
    { label: "Moyenne / jour renseigné", value: compact(500) }
  ]);
  const none = account.summarizeActivity({});
  assert.deepEqual(account.activityMetrics(none).map(metric => metric.value), ["—", "—", "—", "—"]);
});

await test("calendrier : 343 jours se terminant aujourd'hui, niveaux, cases sans donnée", () => {
  const summary = account.summarizeActivity({
    last7DaysTokenUsage: [
      { date: "2026-11-20", totalTokens: 1000 },
      { date: "2026-11-19", totalTokens: 250 },
      { date: "2026-11-18", totalTokens: 251 },
      { date: "2026-11-17", totalTokens: 0 }
    ]
  });
  const { cells } = account.activityCalendar(summary, "2026-11-20");
  assert.equal(cells.length, 343);
  assert.equal(account.ACTIVITY_DAYS, 343);
  assert.equal(cells[0].date, "2025-12-13");
  assert.equal(cells[342].date, "2026-11-20");
  const byDate = Object.fromEntries(cells.map(cell => [cell.date, cell]));
  assert.deepEqual(byDate["2026-11-20"], { date: "2026-11-20", level: 4, reported: true, label: `2026-11-20 : ${exact(1000)} tokens` });
  assert.equal(byDate["2026-11-19"].level, 1);
  assert.equal(byDate["2026-11-18"].level, 2);
  assert.deepEqual(byDate["2026-11-17"], { date: "2026-11-17", level: 0, reported: true, label: "2026-11-17 : 0 tokens" });
  assert.deepEqual(byDate["2026-11-16"], { date: "2026-11-16", level: 0, reported: false, label: "2026-11-16 : aucune donnée reçue" });
});

await test("calendrier : étiquette de mois toutes les 7 cases, seulement quand le mois change", () => {
  const { months } = account.activityCalendar(account.summarizeActivity({}), "2026-11-20");
  assert.equal(months.length, 49);
  assert.match(months[0], /^déc/);
  assert.equal(months[1], "");
  assert.equal(months[2], "");
  assert.match(months[3], /^janv/);
});

await test("date du jour : calculée dans le fuseau Europe/Paris", () => {
  assert.equal(account.todayInParis(new Date("2026-11-20T23:30:00Z")), "2026-11-21");
  assert.equal(account.todayInParis(new Date("2026-07-01T21:59:00Z")), "2026-07-01");
  assert.equal(account.todayInParis(new Date("2026-07-01T22:00:00Z")), "2026-07-02");
});

await test("partage : texte, CSV et nom de fichier", () => {
  const summary = account.summarizeActivity({ last7DaysTokenUsage: [{ date: "2026-11-02", inputTokens: 1, outputTokens: 2, reasoningTokens: 3, totalTokens: 6 }, { date: "2026-11-01", totalTokens: 0 }] });
  assert.equal(account.activityShareText(summary), "Mon activité FranceStudent : 6 tokens sur 2 jours renseignés, 1 jours actifs.");
  assert.equal(account.activityCsv(summary), "Date;Input;Output;Reasoning;Total\n2026-11-01;0;0;0;0\n2026-11-02;1;2;3;6");
  assert.equal(account.ACTIVITY_CSV_NAME, "activite-francestudent.csv");
  assert.equal(account.ACTIVITY_SHARE_TITLE, "Mon activité FranceStudent");
  assert.equal(account.activityShareText(account.summarizeActivity({ last7DaysTokenUsage: [{ date: "2026-11-02", totalTokens: 1234567 }] })), `Mon activité FranceStudent : ${exact(1234567)} tokens sur 1 jours renseignés, 1 jours actifs.`);
});

await test("loadActivity : GET /user/tokenusage sur 343 jours, réponse illisible refusée", async () => {
  const controller = new AbortController();
  const api = fakeApi(() => ({ totalTokenCount: 5, last7DaysTokenUsage: [{ date: "2026-11-01", totalTokens: 5 }] }));
  const summary = await account.loadActivity(api, controller.signal);
  assert.equal(summary.total, 5);
  assert.deepEqual(api.calls.map(call => [call.method, call.path, call.signal === controller.signal]), [["GET", "/user/tokenusage?tokenUsageDays=343", true]]);
  await assert.rejects(() => account.loadActivity(fakeApi(() => null)), error => error.message === "Réponse du serveur illisible.");
  await assert.rejects(() => account.loadActivity(fakeApi(() => "texte")), error => error.message === "Réponse du serveur illisible.");
});

await test("sessions : liste normalisée (identifiant obligatoire), erreur si la réponse n'est pas une liste", async () => {
  const api = fakeApi(() => [
    { id: "s1", since: "2026-11-01T10:00:00Z", os: "iOS 18", location: "Paris", lastActiveAt: "2026-11-20T10:00:00Z" },
    { since: "sans identifiant" },
    { id: "s2", os: 5 },
    "x"
  ]);
  const sessions = await account.listSessions(api);
  assert.deepEqual(sessions, [
    { id: "s1", since: "2026-11-01T10:00:00Z", os: "iOS 18", location: "Paris", lastActiveAt: "2026-11-20T10:00:00Z" },
    { id: "s2", since: "", os: "", location: "", lastActiveAt: "" }
  ]);
  assert.deepEqual(api.calls.map(call => [call.method, call.path]), [["GET", "/user/sessions"]]);
  await assert.rejects(() => account.listSessions(fakeApi(() => ({}))), error => error.message === "Réponse du serveur illisible.");
});

await test("sessions : libellé de date lisible, vide si illisible", () => {
  assert.match(account.sessionDateLabel(new Date(2026, 10, 20, 18, 5).toISOString()), /^20 nov\.? à 18:05$/);
  assert.equal(account.sessionDateLabel(""), "");
  assert.equal(account.sessionDateLabel("hier"), "");
});

await test("sessions : révoquer une session ou toutes, identifiant encodé et obligatoire", async () => {
  const api = fakeApi(() => null);
  await account.revokeSession(api, "a/b c");
  await account.revokeAllSessions(api);
  assert.deepEqual(api.calls.map(call => [call.method, call.path]), [["DELETE", "/user/sessions/a%2Fb%20c"], ["DELETE", "/user/sessions"]]);
  await assert.rejects(() => account.revokeSession(api, ""), /Session inconnue/);
  assert.equal(api.calls.length, 2);
});

await test("photo de profil : data URL image seulement, carré de 256 px en JPEG", () => {
  assert.equal(account.isAvatarDataUrl("data:image/jpeg;base64,AAAA"), true);
  assert.equal(account.isAvatarDataUrl("DATA:IMAGE/png;base64,AAAA"), true);
  assert.equal(account.isAvatarDataUrl("data:text/html;base64,AAAA"), false);
  assert.equal(account.isAvatarDataUrl("https://exemple.fr/a.png"), false);
  assert.equal(account.isAvatarDataUrl(""), false);
  assert.equal(account.isAvatarDataUrl(null), false);
  assert.equal(account.AVATAR_SIZE, 256);
  assert.equal(account.AVATAR_QUALITY, 0.85);
  assert.equal(account.isImageFile({ type: "image/png" }), true);
  assert.equal(account.isImageFile({ type: "application/pdf" }), false);
  assert.equal(account.isImageFile({ type: "" }), false);
});

console.log(`ok - ${count} vérifications du service Compte`);
