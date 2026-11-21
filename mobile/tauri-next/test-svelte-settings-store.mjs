// Store de Paramètres > Général : même enchaînement et mêmes messages que general-settings.js / interface-settings.js.
// Dépendances injectées (service, réglages locaux, agents, interface) : aucun réseau, aucun moteur historique.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { IMAGE_MODEL_CATALOG } from "./src/lib/services/local-settings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

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

const agents = [
  { id: 1, name: "GPT-5", provider: "OpenAI", available: true },
  { id: 3, name: "GPT-4", provider: "OpenAI", available: false },
  { id: 4, name: "Maison", provider: "", available: true }
];

const PREFS = { gptReasoning: "high", customInstructions: "Sois bref.", webSearchMode: "filtered" };
const DOMAINS = { filterType: "allowlist", allowedDomains: ["wikipedia.org", "francestudent.org"], blockedDomains: ["exemple.com"] };

const server = await createServer({
  root: here,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null }
});

try {
  const { SettingsStore, NOTIFICATIONS_HINT, INTERFACE_HINT } = await server.ssrLoadModule("/src/lib/stores/settings.svelte.ts");

  function harness(options = {}) {
    const calls = [];
    let local = { theme: "system", libraryColumns: 1, completionNotifications: false, defaultAgentId: null, imageTool: true, imageModel: "gpt-image-2.5-flare", webSearchMode: "open" };
    const gateway = {
      isBusy: false,
      failUpdate: "",
      notificationsSupported: true,
      toggleResult: "Notifications activées.",
      read: () => ({ ...local }),
      catalog: () => ({ imageModels: IMAGE_MODEL_CATALOG, notificationsSupported: gateway.notificationsSupported }),
      update(patch) {
        calls.push(["update", patch]);
        if (gateway.failUpdate) throw new Error(gateway.failUpdate);
        local = { ...local, ...patch };
      },
      async toggleNotifications() {
        calls.push(["toggleNotifications"]);
        if (gateway.toggleResult instanceof Error) throw gateway.toggleResult;
        local = { ...local, completionNotifications: !local.completionNotifications };
        return gateway.toggleResult;
      },
      instructionsSaved() {
        calls.push(["instructionsSaved"]);
      },
      busy: () => gateway.isBusy
    };
    const service = {
      loadPersonalization: async () => ({ ...PREFS }),
      savePersonalization: async input => {
        calls.push(["savePersonalization", input]);
      },
      loadWebDomains: async () => ({ ...DOMAINS }),
      saveWebSettings: async form => {
        calls.push(["saveWebSettings", form]);
        return { ok: true, mode: form.mode, domains: null };
      }
    };
    const host = {
      choice: { ui: "svelte", chat: false },
      applied: null,
      reloaded: null,
      refuse: false,
      state: () => host.choice,
      apply(choice) {
        host.applied = choice;
        return host.refuse ? null : "/?ui=svelte&chat=1";
      },
      reload(href) {
        host.reloaded = href;
      }
    };
    const opened = [];
    const accountCalls = [];
    const account = options.withAccount === false ? undefined : { activate: () => void accountCalls.push("activate"), stop: () => void accountCalls.push("stop") };
    const store = new SettingsStore({ service, local: gateway, agents: () => agents, interfaceHost: host, openClassic: tab => opened.push(tab), account });
    return { store, calls, gateway, service, host, opened, accountCalls, setLocal: patch => (local = { ...local, ...patch }) };
  }

  async function opened() {
    const h = harness();
    h.store.show();
    await tick();
    return h;
  }

  await test("ouverture : onglet Général, champs désactivés pendant le chargement puis actifs avec les valeurs du compte", async () => {
    const h = harness();
    const pending = deferred();
    h.service.loadPersonalization = () => pending.promise;
    assert.equal(h.store.open, false);
    h.store.show();
    assert.equal(h.store.open, true);
    assert.equal(h.store.tab, "general");
    assert.equal(h.store.loadState, "loading");
    assert.equal(h.store.status, "Chargement des préférences…");
    assert.equal(h.store.fieldsDisabled, true);
    assert.equal(h.store.retryVisible, false);
    assert.equal(h.store.webSummary, "Chargement…");
    pending.resolve({ ...PREFS });
    await tick();
    assert.equal(h.store.loadState, "ready");
    assert.equal(h.store.reasoning, "high");
    assert.equal(h.store.instructions, "Sois bref.");
    assert.equal(h.store.status, "");
    assert.equal(h.store.statusError, false);
    assert.equal(h.store.fieldsDisabled, false);
    assert.equal(h.store.webSummary, "Sites filtrés");
    assert.deepEqual(h.calls.find(call => call[0] === "update"), ["update", { webSearchMode: "filtered" }], "le mode web du compte est recopié dans les réglages locaux");
  });

  await test("échec du chargement : message, bouton Réessayer, champs désactivés ; Réessayer recharge ; pas de requêtes concurrentes", async () => {
    const h = harness();
    let requests = 0;
    h.service.loadPersonalization = async () => {
      requests += 1;
      throw new Error("réseau coupé");
    };
    h.store.show();
    await tick();
    assert.equal(h.store.status, "Impossible de charger les préférences : réseau coupé");
    assert.equal(h.store.statusError, true);
    assert.equal(h.store.retryVisible, true);
    assert.equal(h.store.fieldsDisabled, true);
    const pending = deferred();
    h.service.loadPersonalization = () => {
      requests += 1;
      return pending.promise;
    };
    h.store.loadPreferences();
    h.store.loadPreferences();
    assert.equal(requests, 2, "un seul nouvel appel malgré deux clics");
    assert.equal(h.store.retryVisible, false);
    pending.resolve({ ...PREFS });
    await tick();
    assert.equal(h.store.loadState, "ready");
    assert.equal(h.store.statusError, false);
  });

  await test("enregistrement : refusé si trop long (sans requête), message de succès, puis informe le moteur", async () => {
    const h = await opened();
    h.store.instructions = "x".repeat(10001);
    await h.store.savePreferences();
    assert.equal(h.store.statusError, true);
    assert.match(h.store.status, /trop longues/);
    assert.equal(h.calls.some(call => call[0] === "savePersonalization"), false);
    h.store.instructions = "Réponds en français.";
    h.store.reasoning = "low";
    const pending = deferred();
    h.service.savePersonalization = async input => {
      h.calls.push(["savePersonalization", input]);
      await pending.promise;
    };
    const saving = h.store.savePreferences();
    assert.equal(h.store.status, "Enregistrement…");
    assert.equal(h.store.saving, true);
    assert.equal(h.store.fieldsDisabled, true);
    pending.resolve();
    await saving;
    assert.deepEqual(h.calls.find(call => call[0] === "savePersonalization")[1], { gptReasoning: "low", customInstructions: "Réponds en français.", fileInstructions: false });
    assert.equal(h.store.status, "Préférences enregistrées sur ton compte.");
    assert.equal(h.store.statusError, false);
    assert.equal(h.store.saving, false);
    assert.equal(h.store.fieldsDisabled, false);
    assert.equal(h.calls.filter(call => call[0] === "instructionsSaved").length, 1);
  });

  await test("consigne de fichiers : conservée à l'enregistrement et comptée dans la limite", async () => {
    const h = await opened();
    h.service.loadPersonalization = async () => ({ ...PREFS, fileInstructions: true });
    await h.store.loadPreferences();
    assert.equal(h.store.instructions, "Sois bref.");
    h.store.instructions = "Réponds en français.";
    await h.store.savePreferences();
    assert.deepEqual(h.calls.filter(call => call[0] === "savePersonalization").at(-1)[1], { gptReasoning: "high", customInstructions: "Réponds en français.", fileInstructions: true });
    const before = h.calls.filter(call => call[0] === "savePersonalization").length;
    h.store.instructions = "x".repeat(9990);
    await h.store.savePreferences();
    assert.equal(h.store.statusError, true);
    assert.match(h.store.status, /consigne de création de fichiers/);
    assert.equal(h.calls.filter(call => call[0] === "savePersonalization").length, before, "refus local sans requête");
  });

  await test("enregistrement refusé par le serveur : message d'erreur, champs réactivés, moteur non informé", async () => {
    const h = await opened();
    h.service.savePersonalization = async () => {
      throw new Error("503");
    };
    await h.store.savePreferences();
    assert.equal(h.store.status, "Enregistrement impossible : 503");
    assert.equal(h.store.statusError, true);
    assert.equal(h.store.fieldsDisabled, false);
    assert.equal(h.calls.some(call => call[0] === "instructionsSaved"), false);
  });

  await test("enregistrement ignoré tant que les champs sont désactivés (préférences non chargées)", async () => {
    const h = harness();
    await h.store.savePreferences();
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.status, "");
  });

  await test("fermeture pendant l'enregistrement : le moteur est tout de même informé, l'état périmé n'est pas écrasé", async () => {
    const h = await opened();
    const pending = deferred();
    h.service.savePersonalization = async () => {
      await pending.promise;
    };
    const saving = h.store.savePreferences();
    h.store.close();
    assert.equal(h.store.open, false);
    pending.resolve();
    await saving;
    assert.equal(h.calls.filter(call => call[0] === "instructionsSaved").length, 1);
    assert.equal(h.store.open, false);
  });

  await test("fermeture pendant le chargement : la réponse tardive est ignorée après une réouverture", async () => {
    const h = harness();
    const first = deferred();
    h.service.loadPersonalization = () => first.promise;
    h.store.show();
    h.store.close();
    const second = deferred();
    h.service.loadPersonalization = () => second.promise;
    h.store.show();
    first.resolve({ gptReasoning: "none", customInstructions: "ancien", webSearchMode: "disabled" });
    await tick();
    assert.equal(h.store.loadState, "loading", "la première réponse ne termine pas le second chargement");
    second.resolve({ ...PREFS });
    await tick();
    assert.equal(h.store.instructions, "Sois bref.");
    assert.equal(h.store.webSummary, "Sites filtrés");
  });

  await test("onglets : Compte et Général sont natifs, Skills et MCP ouvrent l'écran classique", async () => {
    const h = harness();
    h.store.show("skills");
    assert.deepEqual(h.opened, ["skills"]);
    assert.equal(h.store.open, false, "la fenêtre Svelte ne s'ouvre pas pour un onglet non migré");
    h.store.show();
    await tick();
    assert.equal(h.store.open, true);
    h.store.selectTab("mcp");
    assert.deepEqual(h.opened, ["skills", "mcp"]);
    assert.equal(h.store.open, false);
    h.store.show();
    h.store.selectTab("general");
    assert.equal(h.store.open, true);
    assert.equal(h.store.tab, "general");
  });

  await test("onglet Compte : natif, s'active à l'ouverture et à la sélection, s'arrête à la fermeture et au changement d'onglet", async () => {
    const h = harness();
    h.store.show("account");
    assert.deepEqual(h.opened, [], "aucun écran classique pour le Compte");
    assert.equal(h.store.open, true);
    assert.equal(h.store.tab, "account");
    assert.deepEqual(h.accountCalls, ["activate"]);
    h.store.selectTab("general");
    assert.equal(h.store.tab, "general");
    assert.deepEqual(h.accountCalls, ["activate", "stop"]);
    h.store.selectTab("account");
    assert.deepEqual(h.accountCalls, ["activate", "stop", "activate"]);
    h.store.selectTab("account");
    assert.deepEqual(h.accountCalls, ["activate", "stop", "activate"], "re-sélectionner l'onglet actif ne recharge pas");
    h.store.close();
    assert.deepEqual(h.accountCalls, ["activate", "stop", "activate", "stop"]);
    h.store.close();
    assert.equal(h.accountCalls.length, 4);
  });

  await test("onglet Compte : le menu « Mon compte » ouvre la fenêtre déjà ouverte sur le Compte", async () => {
    const h = await opened();
    h.store.show("account");
    assert.equal(h.store.tab, "account");
    assert.deepEqual(h.accountCalls, ["activate"]);
    h.store.show("general");
    assert.deepEqual(h.accountCalls, ["activate", "stop"]);
  });

  await test("sans store Compte : l'onglet Compte retombe sur l'écran classique", async () => {
    const h = harness({ withAccount: false });
    h.store.show("account");
    assert.deepEqual(h.opened, ["account"]);
    assert.equal(h.store.open, false);
  });

  await test("réglages locaux : thème, colonnes, modèle par défaut, image ; relecture après écriture ; erreur affichée", async () => {
    const h = await opened();
    h.store.setTheme("dark");
    assert.equal(h.store.settings.theme, "dark");
    h.store.setLibraryColumns(3);
    assert.equal(h.store.settings.libraryColumns, 3);
    h.store.setDefaultAgent(1);
    assert.equal(h.store.settings.defaultAgentId, 1);
    h.store.setDefaultAgent(null);
    assert.equal(h.store.settings.defaultAgentId, null);
    h.store.setImageTool(false);
    assert.equal(h.store.settings.imageTool, false);
    h.store.setImageModel("gpt-image-2");
    assert.equal(h.store.settings.imageModel, "gpt-image-2");
    assert.equal(h.store.localError, "");
    h.gateway.failUpdate = "stockage refusé";
    h.store.setTheme("light");
    assert.equal(h.store.settings.theme, "dark", "l'état affiché reste celui qui est réellement enregistré");
    assert.equal(h.store.localError, "stockage refusé");
    h.gateway.failUpdate = "";
    h.store.setTheme("light");
    assert.equal(h.store.localError, "", "l'erreur disparaît après une écriture réussie");
  });

  await test("modèle par défaut : valide seulement si connu et disponible ; groupes par fournisseur", async () => {
    const h = await opened();
    assert.equal(h.store.defaultValid, false, "automatique");
    h.store.setDefaultAgent(1);
    assert.equal(h.store.defaultValid, true);
    h.store.setDefaultAgent(3);
    assert.equal(h.store.defaultValid, false, "indisponible : retombe sur Automatique");
    assert.deepEqual(h.store.groups.map(group => group.provider), ["OpenAI", "Autres modèles"]);
  });

  await test("ouvrir les réglages relit les réglages locaux (modifiés ailleurs, par exemple par le moteur historique)", async () => {
    const h = harness();
    h.store.show();
    h.store.close();
    h.setLocal({ theme: "dark", libraryColumns: 4 });
    h.store.show();
    assert.equal(h.store.settings.theme, "dark");
    assert.equal(h.store.settings.libraryColumns, 4);
  });

  await test("notifications : état initial, activation, refus du système, absence de prise en charge", async () => {
    const h = await opened();
    assert.equal(h.store.notificationsStatus, NOTIFICATIONS_HINT);
    assert.equal(NOTIFICATIONS_HINT, "Notifications locales en arrière-plan ; pas de notification distante quand l’app est fermée.");
    const pending = h.store.toggleNotifications();
    assert.equal(h.store.notificationsBusy, true);
    await pending;
    assert.equal(h.store.notificationsBusy, false);
    assert.equal(h.store.notificationsStatus, "Notifications activées.");
    assert.equal(h.store.settings.completionNotifications, true);
    h.gateway.toggleResult = new Error("autorisation refusée");
    await h.store.toggleNotifications();
    assert.equal(h.store.notificationsStatus, "autorisation refusée");
    assert.equal(h.store.notificationsBusy, false);
    h.gateway.notificationsSupported = false;
    h.store.show();
    assert.equal(h.store.catalog.notificationsSupported, false);
  });

  await test("recherche web : ouverture refusée tant que les préférences ne sont pas chargées, puis chargement des filtres", async () => {
    const h = harness();
    h.store.openWeb();
    assert.equal(h.store.webOpen, false);
    h.store.show();
    await tick();
    const pending = deferred();
    h.service.loadWebDomains = () => pending.promise;
    h.store.openWeb();
    assert.equal(h.store.webOpen, true);
    assert.equal(h.store.webMode, "filtered", "mode du compte");
    assert.equal(h.store.webStatus, "Chargement des filtres…");
    assert.equal(h.store.webFieldsDisabled, true);
    assert.equal(h.store.webReady, false);
    assert.equal(h.store.webSaveDisabled, true);
    assert.equal(h.store.webRetryVisible, false);
    await h.store.saveWeb();
    assert.equal(h.calls.some(call => call[0] === "saveWebSettings"), false, "aucun enregistrement avant le chargement des filtres");
    assert.equal(h.store.webStatus, "Chargement des filtres…");
    pending.resolve({ ...DOMAINS });
    await tick();
    assert.equal(h.store.webFilterType, "allowlist");
    assert.equal(h.store.webAllowed, "wikipedia.org\nfrancestudent.org");
    assert.equal(h.store.webBlocked, "exemple.com");
    assert.equal(h.store.webStatus, "");
    assert.equal(h.store.webFieldsDisabled, false);
    assert.equal(h.store.webReady, true);
    assert.equal(h.store.webSaveDisabled, false);
  });

  await test("recherche web : échec du chargement des filtres → message, Réessayer, champs et enregistrement bloqués ; Réessayer recharge", async () => {
    const h = await opened();
    h.service.loadWebDomains = async () => {
      throw new Error("hors ligne");
    };
    h.store.openWeb();
    await tick();
    assert.equal(h.store.webStatus, "Impossible de charger les filtres : hors ligne");
    assert.equal(h.store.webStatusError, true);
    assert.equal(h.store.webRetryVisible, true);
    assert.equal(h.store.webReady, false);
    assert.equal(h.store.webFieldsDisabled, true);
    assert.equal(h.store.webSaveDisabled, true);
    h.store.webMode = "disabled";
    h.calls.length = 0;
    await h.store.saveWeb();
    assert.equal(h.calls.some(call => call[0] === "saveWebSettings"), false, "aucun enregistrement tant que les filtres n'ont pas été chargés");
    assert.equal(h.store.webStatusError, true);
    assert.match(h.store.webStatus, /Réessayer/);
    h.service.loadWebDomains = async () => ({ ...DOMAINS });
    h.store.reloadWeb();
    await tick();
    assert.equal(h.store.webStatus, "");
    assert.equal(h.store.webRetryVisible, false);
    assert.equal(h.store.webAllowed, "wikipedia.org\nfrancestudent.org");
    assert.equal(h.store.webReady, true);
    assert.equal(h.store.webSaveDisabled, false);
    await h.store.saveWeb();
    assert.equal(h.calls.filter(call => call[0] === "saveWebSettings").length, 1, "après rechargement, l'enregistrement fonctionne");
  });

  await test("recherche web : réouverture après un chargement réussi puis un échec → les anciens filtres ne rendent pas l'enregistrement possible", async () => {
    const h = await opened();
    h.store.openWeb();
    await tick();
    assert.equal(h.store.webReady, true);
    h.store.closeWeb();
    h.service.loadWebDomains = async () => {
      throw new Error("hors ligne");
    };
    h.store.openWeb();
    await tick();
    assert.equal(h.store.webRetryVisible, true);
    assert.equal(h.store.webLoaded, null, "les filtres d'une ouverture précédente sont oubliés");
    assert.equal(h.store.webReady, false);
    assert.equal(h.store.webSaveDisabled, true);
    assert.equal(h.store.webFieldsDisabled, true);
    h.calls.length = 0;
    await h.store.saveWeb();
    assert.equal(h.calls.some(call => call[0] === "saveWebSettings"), false);
  });

  await test("recherche web : pendant l'enregistrement, champs et bouton restent bloqués", async () => {
    const h = await opened();
    h.store.openWeb();
    await tick();
    const pending = deferred();
    h.service.saveWebSettings = async () => {
      await pending.promise;
      return { ok: true, mode: "filtered", domains: null };
    };
    const saving = h.store.saveWeb();
    assert.equal(h.store.webFieldsDisabled, true);
    assert.equal(h.store.webSaveDisabled, true);
    pending.resolve();
    await saving;
    assert.equal(h.store.webSaveDisabled, false);
  });

  await test("recherche web : enregistrement réussi → résumé, réglage local, statut de la page, fermeture", async () => {
    const h = await opened();
    h.store.openWeb();
    await tick();
    h.store.webMode = "disabled";
    h.calls.length = 0;
    const pending = deferred();
    h.service.saveWebSettings = async form => {
      h.calls.push(["saveWebSettings", form]);
      await pending.promise;
      return { ok: true, mode: "disabled", domains: null };
    };
    const saving = h.store.saveWeb();
    assert.equal(h.store.webStatus, "Enregistrement…");
    assert.equal(h.store.webSaving, true);
    h.store.closeWeb();
    assert.equal(h.store.webOpen, true, "fermeture refusée pendant l'enregistrement");
    pending.resolve();
    await saving;
    const form = h.calls.find(call => call[0] === "saveWebSettings")[1];
    assert.equal(form.mode, "disabled");
    assert.equal(form.filterType, "allowlist");
    assert.equal(form.allowedText, "wikipedia.org\nfrancestudent.org");
    assert.equal(form.loaded.filterType, "allowlist");
    assert.deepEqual(h.calls.find(call => call[0] === "update"), ["update", { webSearchMode: "disabled" }]);
    assert.equal(h.store.webSummary, "Désactivé");
    assert.equal(h.store.status, "Préférences de recherche web enregistrées.");
    assert.equal(h.store.statusError, false);
    assert.equal(h.store.webOpen, false);
    assert.equal(h.store.webSaving, false);
  });

  await test("recherche web : échec d'enregistrement → message du service dans le dialogue, listes enregistrées conservées", async () => {
    const h = await opened();
    h.store.openWeb();
    await tick();
    const saved = { filterType: "blocklist", allowedDomains: [], blockedDomains: ["a.fr"] };
    h.service.saveWebSettings = async () => ({ ok: false, message: "Listes enregistrées, mais le mode de recherche n’a pas pu être enregistré : 500", domains: saved });
    await h.store.saveWeb();
    assert.equal(h.store.webOpen, true);
    assert.equal(h.store.webStatus, "Listes enregistrées, mais le mode de recherche n’a pas pu être enregistré : 500");
    assert.equal(h.store.webStatusError, true);
    assert.equal(h.store.webSaving, false);
    assert.equal(h.store.webSummary, "Sites filtrés", "le résumé ne change pas tant que le mode n'est pas enregistré");
    assert.equal(h.store.webLoaded.filterType, "blocklist");
    h.store.closeWeb();
    assert.equal(h.store.webOpen, false);
  });

  await test("interface : choix inchangé sans effet, refus pendant une réponse, stockage refusé, rechargement", async () => {
    const h = await opened();
    assert.equal(h.store.interfaceStatus, INTERFACE_HINT);
    assert.equal(INTERFACE_HINT, "L’interface Svelte 5 est en cours de migration. Tu peux revenir à l’interface classique ici à tout moment.");
    assert.deepEqual(h.store.interfaceChoice, { ui: "svelte", chat: false });
    h.store.chooseUi("svelte");
    assert.equal(h.host.applied, null, "inchangé");
    h.gateway.isBusy = true;
    h.store.chooseUi("legacy");
    assert.equal(h.store.interfaceStatus, "Attends la fin de la réponse en cours avant de changer d’interface.");
    assert.equal(h.host.applied, null);
    h.gateway.isBusy = false;
    h.host.refuse = true;
    h.store.chooseUi("legacy");
    assert.deepEqual(h.host.applied, { ui: "legacy", chat: false });
    assert.equal(h.store.interfaceStatus, "Changement impossible : le stockage local de l’application est refusé.");
    assert.equal(h.host.reloaded, null);
    h.host.refuse = false;
    h.store.chooseUi("legacy");
    assert.equal(h.store.interfaceStatus, "Rechargement de l’interface…");
    assert.equal(h.host.reloaded, "/?ui=svelte&chat=1");
  });

  await test("interface : l'interrupteur du nouveau chat bascule le chat Svelte", async () => {
    const h = await opened();
    h.store.toggleChat();
    assert.deepEqual(h.host.applied, { ui: "svelte", chat: true });
    assert.equal(h.host.reloaded, "/?ui=svelte&chat=1");
  });
} finally {
  await server.close();
}

console.log(`test-svelte-settings-store : ${count} tests réussis`);
