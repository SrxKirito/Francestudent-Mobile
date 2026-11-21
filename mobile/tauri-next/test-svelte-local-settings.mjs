// Tests des réglages locaux (thème, bibliothèque, modèle par défaut, images, recherche web, notifications).
// Deux implémentations de la même interface `LocalSettingsGateway` passent EXACTEMENT les mêmes tests de contrat :
//  - `createStorageSettings` : lit/écrit directement `fs-chat-state` (cible finale, sans moteur historique) ;
//  - `connectSettingsBridge` : passe par `svelte-settings-engine.js` et les fonctions du moteur historique (transition).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  createStorageSettings,
  connectSettingsBridge,
  validatePatch,
  IMAGE_MODEL_CATALOG,
  NOTIFICATIONS_UNAVAILABLE
} from "./src/lib/services/local-settings.ts";
import { STORE_KEY } from "./src/lib/utils/state.ts";

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

const MODEL_IDS = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"];
const LEGACY_MODELS = {
  "gpt-image-2.6-sunburst": { short: "Sunburst", name: "GPT Image 2.6 Sunburst" },
  "gpt-image-2.6-flare": { short: "Flare", name: "GPT Image 2.6 Flare" },
  "gpt-image-2.5-sunburst": { short: "Sunburst", name: "GPT Image 2.5 Sunburst" },
  "gpt-image-2.5-flare": { short: "Flare", name: "GPT Image 2.5 Flare" },
  "gpt-image-2": { short: "Image 2", name: "gpt-image-2" }
};
const DEFAULTS = {
  theme: "system",
  libraryColumns: 3,
  completionNotifications: false,
  defaultAgentId: null,
  imageTool: true,
  imageModel: "gpt-image-2.5-flare",
  webSearchMode: "open"
};

// --- Harnais « direct » : un faux localStorage ---------------------------------
function directHarness(initial) {
  const data = new Map();
  if (initial !== undefined) data.set(STORE_KEY, typeof initial === "string" ? initial : JSON.stringify(initial));
  let refuse = false;
  const storage = {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (refuse) throw new Error("QuotaExceededError");
      data.set(key, value);
    }
  };
  return {
    name: "direct",
    gateway: createStorageSettings(storage),
    stored: () => JSON.parse(data.get(STORE_KEY) ?? "{}"),
    raw: () => data.get(STORE_KEY) ?? null,
    refuse(value) {
      refuse = value;
    }
  };
}

// --- Harnais « pont » : le vrai svelte-settings-engine.js sur de fausses fonctions legacy ---
const LEGACY_FAKES = `
const calls = [];
let store = JSON.parse(__initial);
const IMAGE_MODELS = JSON.parse(__models);
const elements = { "completion-notifications-status": { textContent: "" } };
function $(id) { return elements[id] || null; }
function saveStore() { calls.push("saveStore"); }
function applyTheme() { calls.push("applyTheme"); }
function setLibraryColumns(n) { calls.push("setLibraryColumns:" + n); store.libraryColumns = n; saveStore(); }
function setDefaultModel(v) { calls.push("setDefaultModel:" + v); store.defaultAgentId = v === "" ? null : Number(v); saveStore(); }
function applyImageSettingsChange() { calls.push("applyImageSettingsChange"); store.imageToolSynced = null; saveStore(); }
function applyWebSearchPreference(m) {
  calls.push("applyWebSearchPreference:" + m);
  store.webSearchMode = m;
  if (m === "disabled") store.webSearch = false;
  saveStore();
}
async function toggleCompletionNotifications() {
  calls.push("toggleCompletionNotifications");
  store.completionNotifications = !store.completionNotifications;
  elements["completion-notifications-status"].textContent = store.completionNotifications
    ? "Notifications locales activées en arrière-plan."
    : "Notifications désactivées. Si nécessaire, autorise-les dans les réglages iOS.";
}
`;

function bridgeHarness(initial, { platform = null, models = LEGACY_MODELS, load = true } = {}) {
  const context = vm.createContext({ console });
  context.window = context;
  context.__initial = JSON.stringify(initial === undefined ? {} : initial);
  context.__models = JSON.stringify(models);
  if (platform) context.Capacitor = { getPlatform: () => platform };
  vm.runInContext(LEGACY_FAKES, context);
  const run = code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
  if (load) vm.runInContext(fs.readFileSync("svelte-settings-engine.js", "utf8"), context);
  return {
    name: "pont",
    context,
    run,
    gateway: load ? connectSettingsBridge(context) : null,
    stored: () => run("store"),
    calls: () => run("calls")
  };
}

const HARNESSES = [
  { name: "direct", make: initial => directHarness(initial) },
  { name: "pont", make: initial => bridgeHarness(initial) }
];

// --- validatePatch ---------------------------------------------------------------
await test("validatePatch : accepte les valeurs valides et ignore les clés inconnues", () => {
  const patch = validatePatch({
    theme: "dark",
    libraryColumns: 2,
    defaultAgentId: null,
    imageTool: false,
    imageModel: "gpt-image-2",
    webSearchMode: "filtered",
    inconnu: 1
  });
  assert.deepEqual(patch, {
    theme: "dark",
    libraryColumns: 2,
    defaultAgentId: null,
    imageTool: false,
    imageModel: "gpt-image-2",
    webSearchMode: "filtered"
  });
  assert.deepEqual(validatePatch({}), {});
});

await test("validatePatch : refuse chaque valeur invalide en nommant le réglage", () => {
  const bad = {
    theme: "neon",
    libraryColumns: 9,
    defaultAgentId: "12",
    imageTool: "oui",
    imageModel: "gpt-image-9",
    webSearchMode: "tout"
  };
  for (const [key, value] of Object.entries(bad)) {
    assert.throws(() => validatePatch({ [key]: value }), error => error instanceof Error && error.message.includes(key), key);
  }
  assert.throws(() => validatePatch({ libraryColumns: 2.5 }), /libraryColumns/);
  assert.throws(() => validatePatch({ defaultAgentId: 1.5 }), /defaultAgentId/);
  assert.throws(() => validatePatch(null), /Réglages invalides/);
  assert.throws(() => validatePatch([1]), /Réglages invalides/);
});

await test("validatePatch : un modèle d'image fourni par le moteur historique est accepté", () => {
  assert.deepEqual(validatePatch({ imageModel: "gpt-image-3" }, ["gpt-image-3"]), { imageModel: "gpt-image-3" });
  assert.throws(() => validatePatch({ imageModel: "gpt-image-2" }, ["gpt-image-3"]), /imageModel/);
});

await test("catalogue : 5 modèles d'image dans l'ordre du moteur historique", () => {
  assert.deepEqual(IMAGE_MODEL_CATALOG.map(model => model.id), MODEL_IDS);
  assert.equal(IMAGE_MODEL_CATALOG[0].name, "GPT Image 2.6 Sunburst");
  assert.equal(IMAGE_MODEL_CATALOG[4].short, "Image 2");
  assert.ok(typeof NOTIFICATIONS_UNAVAILABLE === "string" && NOTIFICATIONS_UNAVAILABLE.length > 10);
});

// --- Contrat commun aux deux implémentations -------------------------------------
for (const { name, make } of HARNESSES) {
  const label = text => `[${name}] ${text}`;

  await test(label("rien de stocké : valeurs par défaut"), () => {
    const h = make(undefined);
    assert.deepEqual(h.gateway.read(), DEFAULTS);
  });

  await test(label("relit les réglages stockés et normalise les valeurs inattendues"), () => {
    const h = make({
      theme: "dark",
      libraryColumns: 4,
      completionNotifications: true,
      defaultAgentId: 12,
      imageTool: false,
      imageModel: "gpt-image-2",
      webSearchMode: "filtered"
    });
    assert.deepEqual(h.gateway.read(), {
      theme: "dark",
      libraryColumns: 4,
      completionNotifications: true,
      defaultAgentId: 12,
      imageTool: false,
      imageModel: "gpt-image-2",
      webSearchMode: "filtered"
    });
    const odd = make({ theme: "neon", libraryColumns: 0, defaultAgentId: "x", imageModel: "autre", webSearchMode: "x" });
    assert.deepEqual(odd.gateway.read(), DEFAULTS);
  });

  await test(label("catalogue : 5 modèles d'image, notifications indisponibles hors iOS"), () => {
    const catalog = make({}).gateway.catalog();
    assert.deepEqual(catalog.imageModels.map(model => model.id), MODEL_IDS);
    assert.deepEqual(catalog.imageModels[3], { id: "gpt-image-2.5-flare", short: "Flare", name: "GPT Image 2.5 Flare" });
    assert.equal(catalog.notificationsSupported, false);
  });

  await test(label("thème : écrit puis relu"), () => {
    const h = make({});
    h.gateway.update({ theme: "dark" });
    assert.equal(h.gateway.read().theme, "dark");
    assert.equal(h.stored().theme, "dark");
    h.gateway.update({ theme: "system" });
    assert.equal(h.gateway.read().theme, "system");
  });

  await test(label("colonnes de la bibliothèque : 1 à 4"), () => {
    const h = make({});
    for (const n of [1, 2, 3, 4]) {
      h.gateway.update({ libraryColumns: n });
      assert.equal(h.gateway.read().libraryColumns, n);
      assert.equal(h.stored().libraryColumns, n);
    }
  });

  await test(label("modèle par défaut : entier puis retour à « Automatique »"), () => {
    const h = make({});
    h.gateway.update({ defaultAgentId: 12 });
    assert.equal(h.gateway.read().defaultAgentId, 12);
    assert.equal(h.stored().defaultAgentId, 12);
    h.gateway.update({ defaultAgentId: null });
    assert.equal(h.gateway.read().defaultAgentId, null);
    assert.equal(h.stored().defaultAgentId, null);
  });

  await test(label("images : interrupteur et modèle, synchro serveur à refaire à l'envoi"), () => {
    const h = make({ imageToolSynced: "on:gpt-image-2.5-flare" });
    h.gateway.update({ imageTool: false, imageModel: "gpt-image-2.6-flare" });
    assert.equal(h.gateway.read().imageTool, false);
    assert.equal(h.gateway.read().imageModel, "gpt-image-2.6-flare");
    assert.equal(h.stored().imageTool, false);
    assert.equal(h.stored().imageModel, "gpt-image-2.6-flare");
    assert.equal(h.stored().imageToolSynced, null);
  });

  await test(label("recherche web : « désactivé » coupe aussi la recherche active"), () => {
    const h = make({ webSearch: true });
    h.gateway.update({ webSearchMode: "filtered" });
    assert.equal(h.stored().webSearch, true);
    assert.equal(h.gateway.read().webSearchMode, "filtered");
    h.gateway.update({ webSearchMode: "disabled" });
    assert.equal(h.gateway.read().webSearchMode, "disabled");
    assert.equal(h.stored().webSearch, false);
  });

  await test(label("un correctif invalide n'applique rien (atomique)"), () => {
    const h = make({ theme: "light" });
    assert.throws(() => h.gateway.update({ theme: "dark", libraryColumns: 9 }), /libraryColumns/);
    assert.equal(h.gateway.read().theme, "light");
    assert.throws(() => h.gateway.update({ imageModel: "gpt-image-9" }), /imageModel/);
    assert.equal(h.gateway.read().imageModel, "gpt-image-2.5-flare");
  });

  await test(label("clés inconnues ignorées, correctif vide sans effet"), () => {
    const h = make({ theme: "light" });
    h.gateway.update({});
    h.gateway.update({ inconnu: true });
    assert.equal(h.gateway.read().theme, "light");
    h.gateway.update({ inconnu: true, theme: "dark" });
    assert.equal(h.gateway.read().theme, "dark");
  });

  await test(label("les autres réglages et conversations stockés sont conservés"), () => {
    const h = make({ deviceId: "mon-appareil", agentId: 7, conversations: [{ id: "c1" }], profile: { name: "Léa" }, theme: "light" });
    h.gateway.update({ theme: "dark", libraryColumns: 2 });
    const stored = h.stored();
    assert.equal(stored.deviceId, "mon-appareil");
    assert.equal(stored.agentId, 7);
    assert.deepEqual(stored.conversations, [{ id: "c1" }]);
    assert.deepEqual(stored.profile, { name: "Léa" });
  });

  await test(label("notifications : refusées proprement hors iOS"), async () => {
    const h = make({});
    await assert.rejects(() => h.gateway.toggleNotifications(), error => error instanceof Error && error.message === NOTIFICATIONS_UNAVAILABLE);
    assert.equal(h.stored().completionNotifications === true, false);
  });

  await test(label("instructions enregistrées : le moteur ne les réécrira plus"), () => {
    const h = make({ customInstructionsManaged: false, fileInstrSynced: false });
    h.gateway.instructionsSaved();
    assert.equal(h.stored().customInstructionsManaged, true);
    assert.equal(h.stored().fileInstrSynced, true);
  });

  await test(label("busy : faux par défaut (aucune réponse en cours)"), () => {
    assert.equal(make({}).gateway.busy(), false);
  });
}

await test("pont : busy reflète la réponse en cours du moteur historique, sans rien modifier", () => {
  const h = bridgeHarness({});
  vm.runInContext("var busy = true;", h.context);
  assert.equal(h.gateway.busy(), true);
  vm.runInContext("busy = false;", h.context);
  assert.equal(h.gateway.busy(), false);
  assert.deepEqual(h.calls(), []);
});

// --- Implémentation directe : cas propres ----------------------------------------
await test("direct : retire la session et garde les clés inconnues", () => {
  const h = directHarness({ session: "secret", inconnue: { a: 1 }, theme: "light" });
  h.gateway.update({ theme: "dark" });
  const stored = h.stored();
  assert.equal("session" in stored, false);
  assert.deepEqual(stored.inconnue, { a: 1 });
  assert.equal(stored.theme, "dark");
});

await test("direct : JSON corrompu → valeurs par défaut, puis écriture valide", () => {
  const h = directHarness("{pas du json");
  assert.deepEqual(h.gateway.read(), DEFAULTS);
  h.gateway.update({ libraryColumns: 2 });
  assert.equal(JSON.parse(h.raw()).libraryColumns, 2);
});

await test("direct : stockage refusé → erreur lisible, rien d'écrit", () => {
  const h = directHarness({ theme: "light" });
  h.refuse(true);
  assert.throws(() => h.gateway.update({ theme: "dark" }), /stockage/i);
  assert.throws(() => h.gateway.instructionsSaved(), /stockage/i);
  h.refuse(false);
  assert.equal(h.stored().theme, "light");
});

await test("direct : le modèle par défaut n'écrase pas l'agent courant", () => {
  const h = directHarness({ agentId: 7 });
  h.gateway.update({ defaultAgentId: 12 });
  assert.equal(h.stored().agentId, 7);
  assert.equal(h.stored().defaultAgentId, 12);
});

// --- Pont : cas propres -------------------------------------------------------------
await test("pont : le script chargé est inerte (aucun appel, rien de modifié)", () => {
  const h = bridgeHarness({ theme: "light", conversations: [{ id: "c1" }] });
  assert.deepEqual(h.calls(), []);
  assert.deepEqual(h.stored(), { theme: "light", conversations: [{ id: "c1" }] });
  assert.deepEqual(Object.keys(h.context.__fsSettings).sort(), ["busy", "catalog", "instructionsSaved", "read", "toggleNotifications", "update"]);
});

await test("pont : lire ne change rien et n'appelle aucune fonction du moteur", () => {
  const h = bridgeHarness({ theme: "dark" });
  h.gateway.read();
  h.gateway.catalog();
  assert.deepEqual(h.calls(), []);
});

await test("pont : chaque réglage passe par la fonction du moteur historique", () => {
  const h = bridgeHarness({});
  h.gateway.update({ theme: "dark" });
  assert.deepEqual(h.calls(), ["saveStore", "applyTheme"]);
  h.gateway.update({ libraryColumns: 2 });
  h.gateway.update({ defaultAgentId: 12 });
  h.gateway.update({ defaultAgentId: null });
  h.gateway.update({ webSearchMode: "disabled" });
  assert.deepEqual(h.calls().filter(call => !call.startsWith("saveStore")), [
    "applyTheme",
    "setLibraryColumns:2",
    "setDefaultModel:12",
    "setDefaultModel:",
    "applyWebSearchPreference:disabled"
  ]);
});

await test("pont : image et modèle déclenchent un seul rafraîchissement", () => {
  const h = bridgeHarness({});
  h.gateway.update({ imageTool: false, imageModel: "gpt-image-2" });
  assert.equal(h.calls().filter(call => call === "applyImageSettingsChange").length, 1);
});

await test("pont : correctif invalide → erreur et aucun appel au moteur", () => {
  const h = bridgeHarness({});
  const hasMessage = error => typeof error?.message === "string" && error.message.length > 0;
  assert.throws(() => h.gateway.update({ theme: "dark", libraryColumns: 9 }), /libraryColumns/);
  assert.deepEqual(h.calls(), []);
  assert.throws(() => h.context.__fsSettings.update("{pas du json"), hasMessage);
  assert.throws(() => h.context.__fsSettings.update(JSON.stringify({ theme: "neon" })), /theme/);
  assert.throws(() => h.context.__fsSettings.update(JSON.stringify([1])), hasMessage);
  assert.deepEqual(h.calls(), []);
});

await test("pont : le catalogue et la validation viennent du moteur historique", () => {
  const models = { ...LEGACY_MODELS, "gpt-image-3": { short: "Trois", name: "GPT Image 3" } };
  const h = bridgeHarness({}, { models });
  assert.equal(h.gateway.catalog().imageModels.length, 6);
  h.gateway.update({ imageModel: "gpt-image-3" });
  assert.equal(h.gateway.read().imageModel, "gpt-image-3");
});

await test("pont : notifications sous iOS", async () => {
  const h = bridgeHarness({}, { platform: "ios" });
  assert.equal(h.gateway.catalog().notificationsSupported, true);
  assert.equal(await h.gateway.toggleNotifications(), "Notifications locales activées en arrière-plan.");
  assert.equal(h.gateway.read().completionNotifications, true);
  assert.equal(await h.gateway.toggleNotifications(), "Notifications désactivées. Si nécessaire, autorise-les dans les réglages iOS.");
  const android = bridgeHarness({}, { platform: "android" });
  assert.equal(android.gateway.catalog().notificationsSupported, false);
  await assert.rejects(() => android.gateway.toggleNotifications(), /iOS/);
  assert.deepEqual(android.calls(), []);
});

await test("pont : non connecté tant que le moteur historique n'a pas chargé le script", () => {
  assert.equal(connectSettingsBridge(null), null);
  assert.equal(connectSettingsBridge(undefined), null);
  assert.equal(connectSettingsBridge({}), null);
  assert.equal(connectSettingsBridge({ __fsSettings: { read() {} } }), null);
  const throwing = {};
  Object.defineProperty(throwing, "__fsSettings", {
    get() {
      throw new Error("cross-origin");
    }
  });
  assert.equal(connectSettingsBridge(throwing), null);
  const h = bridgeHarness({}, { load: false });
  assert.equal(h.gateway, null);
});

console.log(`test-svelte-local-settings : ${count} tests réussis`);
