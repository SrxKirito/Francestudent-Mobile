// Logique de Paramètres > Général : niveaux de réflexion, filtres de sites web, préférences du compte.
// Les messages et règles reprennent mobile/www/js/general-settings.js ; seule la limite des instructions suit l'OpenAPI.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const general = await import("./src/lib/services/general-settings.ts");
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

await test("niveaux de réflexion : six niveaux, libellés français, repli sur « Aucun »", () => {
  assert.deepEqual(general.REASONING_LEVELS.map(level => level.value), ["none", "minimal", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(general.REASONING_LEVELS.map(level => level.label), ["Aucun", "Minimal", "Faible", "Moyen", "Élevé", "Très élevé"]);
  assert.equal(general.reasoningLevel("high"), "high");
  assert.equal(general.reasoningLevel("extreme"), "none");
  assert.equal(general.reasoningLevel(undefined), "none");
});

await test("modes de recherche web : libellés du dialogue et résumé du lien", () => {
  assert.deepEqual(general.WEB_MODES.map(mode => [mode.value, mode.label]), [["open", "Sans restriction"], ["filtered", "Filtrer les sites"], ["disabled", "Désactivé"]]);
  assert.equal(general.webModeSummary("open"), "Sans restriction");
  assert.equal(general.webModeSummary("filtered"), "Sites filtrés");
  assert.equal(general.webModeSummary("disabled"), "Désactivé");
  assert.equal(general.webModeSummary("inconnu"), "Sans restriction");
});

await test("parseWebDomains : sépare, met en minuscules, retire le point final et dédoublonne", () => {
  assert.deepEqual(general.parseWebDomains("Wikipedia.org, https://Francestudent.org.\nexemple.com; wikipedia.org"), ["wikipedia.org", "francestudent.org", "exemple.com"]);
  assert.deepEqual(general.parseWebDomains(""), []);
  assert.deepEqual(general.parseWebDomains("  \n ,; "), []);
  assert.deepEqual(general.parseWebDomains("sous.domaine.exemple.fr"), ["sous.domaine.exemple.fr"]);
});

await test("parseWebDomains : refuse chemin, paramètres, port, identifiants, ancre, hôte sans point et IP", () => {
  const indicate = "Indique uniquement un domaine, par exemple wikipedia.org : ";
  for (const bad of ["foo", "a.com/page", "a.com:8080", "user@a.com", "a.com?x=1", "a.com#x", "192.168.0.1", "-a.com"]) {
    assert.throws(() => general.parseWebDomains(bad), error => error.message === indicate + bad, bad);
  }
  assert.throws(() => general.parseWebDomains("ok.com https://"), error => error.message === "Domaine invalide : https://");
});

await test("normalizeWebDomainSettings : valeurs vides, listes, erreurs lisibles", () => {
  assert.deepEqual(general.normalizeWebDomainSettings(null), { filterType: "allowlist", allowedDomains: [], blockedDomains: [] });
  assert.deepEqual(general.normalizeWebDomainSettings(""), { filterType: "allowlist", allowedDomains: [], blockedDomains: [] });
  assert.deepEqual(
    general.normalizeWebDomainSettings({ filterType: "blocklist", allowedDomains: ["a.com"], blockedDomains: null }),
    { filterType: "blocklist", allowedDomains: ["a.com"], blockedDomains: [] }
  );
  assert.equal(general.normalizeWebDomainSettings({ filterType: "autre" }).filterType, "allowlist");
  assert.throws(() => general.normalizeWebDomainSettings([]), error => error.message === "Filtres du serveur illisibles.");
  assert.throws(() => general.normalizeWebDomainSettings("texte"), error => error.message === "Filtres du serveur illisibles.");
  assert.throws(() => general.normalizeWebDomainSettings({ allowedDomains: "a.com" }), error => error.message === "Liste de domaines invalide.");
  assert.throws(() => general.normalizeWebDomainSettings({ blockedDomains: ["a.com", 3] }), error => error.message === "Liste de domaines invalide.");
});

await test("parsePersonalization : valeurs par défaut sûres et réponse illisible", () => {
  assert.deepEqual(
    general.parsePersonalization({ gptReasoning: "low", customInstructions: "Sois bref.", webSearchMode: "filtered", memoryEnabled: true }),
    { gptReasoning: "low", customInstructions: "Sois bref.", fileInstructions: false, webSearchMode: "filtered" }
  );
  assert.deepEqual(general.parsePersonalization({ gptReasoning: "extreme", customInstructions: 4, webSearchMode: "x" }), { gptReasoning: "none", customInstructions: "", fileInstructions: false, webSearchMode: "open" });
  for (const bad of [null, undefined, "texte", 12]) {
    assert.throws(() => general.parsePersonalization(bad), error => error.message === "Réponse du serveur illisible.");
  }
});

await test("instructions : la limite suit l'OpenAPI (10 000 caractères en mise à jour)", () => {
  assert.equal(general.CUSTOM_INSTRUCTIONS_MAX, 10000);
  assert.equal(general.instructionsError("a".repeat(10000)), null);
  assert.match(general.instructionsError("a".repeat(10001)), /trop longues/);
  assert.match(general.instructionsError("a".repeat(10001)), /10 000/);
});

await test("service : chargement des préférences et des filtres", async () => {
  const api = fakeApi(call => call.path === "/user/instructions"
    ? { gptReasoning: "medium", customInstructions: "x", webSearchMode: "disabled" }
    : { filterType: "blocklist", blockedDomains: ["b.com"] });
  const service = general.createGeneralSettingsService(api);
  const controller = new AbortController();
  assert.deepEqual(await service.loadPersonalization(controller.signal), { gptReasoning: "medium", customInstructions: "x", fileInstructions: false, webSearchMode: "disabled" });
  assert.deepEqual(await service.loadWebDomains(controller.signal), { filterType: "blocklist", allowedDomains: [], blockedDomains: ["b.com"] });
  assert.deepEqual(api.calls.map(call => `${call.method} ${call.path}`), ["GET /user/instructions", "GET /user/web-search-domains"]);
  assert.equal(api.calls[0].signal, controller.signal);
});

await test("service : enregistrer niveau et instructions envoie un PATCH ciblé", async () => {
  const api = fakeApi(() => ({}));
  const service = general.createGeneralSettingsService(api);
  await service.savePersonalization({ gptReasoning: "high", customInstructions: "Réponds en français." });
  assert.deepEqual(api.calls, [{ path: "/user/instructions", method: "PATCH", body: { gptReasoning: "high", customInstructions: "Réponds en français." }, signal: undefined }]);
  await assert.rejects(service.savePersonalization({ gptReasoning: "high", customInstructions: "a".repeat(10001) }), /trop longues/);
  await assert.rejects(service.savePersonalization({ gptReasoning: "énorme", customInstructions: "" }), /réflexion/);
  assert.equal(api.calls.length, 1, "aucune requête pour des valeurs refusées");
});

const FILES = general.FILE_INSTRUCTIONS;

await test("consigne de fichiers : même texte que le moteur historique", async () => {
  const legacy = await readFile(new URL("../www/js/stream.js", import.meta.url), "utf8");
  const tag = /const FILE_INSTR_TAG = "([^"]+)";/.exec(legacy)?.[1];
  const text = /const FILE_INSTR = FILE_INSTR_TAG \+ "((?:[^"\\]|\\.)*)";/.exec(legacy)?.[1];
  assert.ok(tag && text, "constantes introuvables dans stream.js");
  assert.equal(general.FILE_INSTRUCTIONS_TAG, tag);
  assert.equal(FILES, tag + JSON.parse('"' + text + '"'));
});

await test("splitFileInstructions : bloc seul, après le texte, absent, répété, au milieu, modifié", () => {
  const split = general.splitFileInstructions;
  assert.deepEqual(split(FILES), { text: "", hasBlock: true });
  assert.deepEqual(split("Réponds en français.\n\n" + FILES), { text: "Réponds en français.", hasBlock: true });
  assert.deepEqual(split("Réponds en français."), { text: "Réponds en français.", hasBlock: false });
  assert.deepEqual(split(""), { text: "", hasBlock: false });
  assert.deepEqual(split("A\n\n" + FILES + "\n\n" + FILES), { text: "A", hasBlock: true });
  assert.deepEqual(split("A\n\n" + FILES + "\n\nB"), { text: "A\n\nB", hasBlock: true });
  assert.deepEqual(split(FILES + "\n\nB"), { text: "B", hasBlock: true });
  const edited = "A\n\n" + general.FILE_INSTRUCTIONS_TAG + " version modifiée.";
  assert.deepEqual(split(edited), { text: edited, hasBlock: false }, "un bloc modifié reste dans le texte de l'utilisateur");
});

await test("joinFileInstructions : ajoute le bloc une seule fois", () => {
  const join = general.joinFileInstructions;
  assert.equal(join("", true), FILES);
  assert.equal(join("Réponds en français.", true), "Réponds en français.\n\n" + FILES);
  assert.equal(join("Réponds en français.", false), "Réponds en français.");
  assert.equal(join("A\n\n" + general.FILE_INSTRUCTIONS_TAG + " modifié", true), "A\n\n" + general.FILE_INSTRUCTIONS_TAG + " modifié", "tag déjà présent : rien à ajouter");
  assert.equal(general.splitFileInstructions(join("Salut", true)).text, "Salut");
});

await test("préférences : le bloc fichiers est retiré à la lecture puis rattaché à l'enregistrement", async () => {
  const api = fakeApi(call => call.method === "GET" ? { gptReasoning: "low", customInstructions: "Sois bref.\n\n" + FILES, webSearchMode: "open" } : {});
  const service = general.createGeneralSettingsService(api);
  assert.deepEqual(await service.loadPersonalization(), { gptReasoning: "low", customInstructions: "Sois bref.", fileInstructions: true, webSearchMode: "open" });
  await service.savePersonalization({ gptReasoning: "low", customInstructions: "Sois précis.", fileInstructions: true });
  assert.deepEqual(api.calls[1].body, { gptReasoning: "low", customInstructions: "Sois précis.\n\n" + FILES });
  await service.savePersonalization({ gptReasoning: "low", customInstructions: "Sois précis.", fileInstructions: false });
  assert.deepEqual(api.calls[2].body, { gptReasoning: "low", customInstructions: "Sois précis." });
  await service.savePersonalization({ gptReasoning: "low", customInstructions: "Sans indication" });
  assert.deepEqual(api.calls[3].body, { gptReasoning: "low", customInstructions: "Sans indication" }, "fileInstructions absent = faux");
});

await test("préférences : la limite de 10 000 caractères compte le bloc fichiers", async () => {
  const api = fakeApi(() => ({}));
  const service = general.createGeneralSettingsService(api);
  const room = 10000 - FILES.length - 2;
  await service.savePersonalization({ gptReasoning: "low", customInstructions: "a".repeat(room), fileInstructions: true });
  await assert.rejects(
    service.savePersonalization({ gptReasoning: "low", customInstructions: "a".repeat(room + 1), fileInstructions: true }),
    error => /trop longues/.test(error.message) && /consigne de création de fichiers/.test(error.message)
  );
  await assert.rejects(service.savePersonalization({ gptReasoning: "low", customInstructions: "a".repeat(10001), fileInstructions: false }), error => /trop longues/.test(error.message) && !/fichiers/.test(error.message));
  assert.equal(api.calls.length, 1);
  assert.equal(general.instructionsError("a".repeat(room + 1), true).includes("fichiers"), true);
  assert.equal(general.instructionsError("a".repeat(room), true), null);
  assert.equal(general.instructionsError("a".repeat(10001)), "Les instructions sont trop longues (10 000 caractères maximum).");
});

const loaded = { filterType: "allowlist", allowedDomains: [], blockedDomains: [] };
const form = overrides => ({ mode: "filtered", filterType: "allowlist", allowedText: "wikipedia.org", blockedText: "", loaded, ...overrides });

await test("recherche web sans filtre : seul le mode est envoyé", async () => {
  const api = fakeApi(() => ({}));
  const result = await general.createGeneralSettingsService(api).saveWebSettings(form({ mode: "open", loaded: null }));
  assert.deepEqual(result, { ok: true, mode: "open", domains: null });
  assert.deepEqual(api.calls.map(call => [call.method, call.path, call.body]), [["PATCH", "/user/instructions", { webSearchMode: "open" }]]);
});

await test("recherche web filtrée : listes (PUT) puis mode (PATCH), dans cet ordre", async () => {
  const api = fakeApi(() => ({}));
  const result = await general.createGeneralSettingsService(api).saveWebSettings(form({ allowedText: "Wikipedia.org\nfrancestudent.org", blockedText: "exemple.com" }));
  const domains = { filterType: "allowlist", allowedDomains: ["wikipedia.org", "francestudent.org"], blockedDomains: ["exemple.com"] };
  assert.deepEqual(result, { ok: true, mode: "filtered", domains });
  assert.deepEqual(api.calls.map(call => [call.method, call.path, call.body]), [
    ["PUT", "/user/web-search-domains", domains],
    ["PATCH", "/user/instructions", { webSearchMode: "filtered" }]
  ]);
});

await test("recherche web filtrée : une liste d'exclusion peut être vide, une liste autorisée non", async () => {
  const api = fakeApi(() => ({}));
  const service = general.createGeneralSettingsService(api);
  const block = await service.saveWebSettings(form({ filterType: "blocklist", allowedText: "", blockedText: "" }));
  assert.equal(block.ok, true);
  const before = api.calls.length;
  const allow = await service.saveWebSettings(form({ allowedText: "  " }));
  assert.deepEqual(allow, { ok: false, message: "Ajoute au moins un site autorisé.", domains: null });
  assert.equal(api.calls.length, before);
});

await test("recherche web filtrée : listes non chargées ou domaine invalide, sans requête", async () => {
  const api = fakeApi(() => ({}));
  const service = general.createGeneralSettingsService(api);
  assert.deepEqual(await service.saveWebSettings(form({ loaded: null })), { ok: false, message: "Charge les listes avec Réessayer avant de modifier les filtres.", domains: null });
  const bad = await service.saveWebSettings(form({ blockedText: "a.com/page" }));
  assert.equal(bad.ok, false);
  assert.match(bad.message, /^Indique uniquement un domaine/);
  assert.deepEqual((await service.saveWebSettings(form({ mode: "inconnu" }))).ok, false);
  assert.equal(api.calls.length, 0);
});

await test("recherche web : échec des listes, puis échec du mode après listes enregistrées", async () => {
  const failList = fakeApi(call => { if (call.method === "PUT") throw new ApiError("Quota dépassé", 429); return {}; });
  const first = await general.createGeneralSettingsService(failList).saveWebSettings(form());
  assert.deepEqual(first, { ok: false, message: "Enregistrement impossible : Quota dépassé", domains: null });
  assert.equal(failList.calls.length, 1, "le mode n'est pas envoyé si les listes échouent");

  const failMode = fakeApi(call => { if (call.method === "PATCH") throw new ApiError("Serveur occupé", 503); return {}; });
  const second = await general.createGeneralSettingsService(failMode).saveWebSettings(form());
  assert.equal(second.ok, false);
  assert.equal(second.message, "Listes enregistrées, mais le mode de recherche n’a pas pu être enregistré : Serveur occupé");
  assert.deepEqual(second.domains, { filterType: "allowlist", allowedDomains: ["wikipedia.org"], blockedDomains: [] });

  const failOpen = fakeApi(() => { throw new ApiError("Hors ligne", 0); });
  assert.deepEqual(await general.createGeneralSettingsService(failOpen).saveWebSettings(form({ mode: "disabled", loaded: null })), { ok: false, message: "Enregistrement impossible : Hors ligne", domains: null });
});

console.log(`test-svelte-general-settings : ${count} tests réussis`);
