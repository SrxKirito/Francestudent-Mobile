// Pont `window.__fsAccount` (svelte-settings-engine.js) : le vrai script, chargé dans un contexte vm avec de fausses fonctions historiques.
// Le pont ne doit rien faire au chargement, tout passer par les fonctions du moteur historique et rester utilisable
// par la passerelle `createBridgeAccount` / `connectAccountBridge` (account-local.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const local = await import("./src/lib/services/account-local.ts");

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

const AVATAR = "data:image/jpeg;base64,AAAA";
const OTHER = "data:image/png;base64,BBBB";

const LEGACY_FAKES = `
const calls = [];
let refuseSave = false;
let logoutMode = "ok";
let store = JSON.parse(__initial);
function saveStore() { calls.push("saveStore"); return !refuseSave; }
function renderProfile() { calls.push("renderProfile"); }
async function logout() {
  calls.push("logout");
  if (logoutMode === "ok") { store.session = ""; store.profile = null; store.customInstructionsManaged = false; store.fileInstrSynced = false; store.webSearchMode = "open"; saveStore(); }
  if (logoutMode === "throw") throw new Error("trousseau verrouillé");
}
`;

function harness(initial = {}, { load = true } = {}) {
  const context = vm.createContext({ console });
  context.window = context;
  context.__initial = JSON.stringify(initial);
  vm.runInContext(LEGACY_FAKES, context);
  const run = code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
  if (load) vm.runInContext(fs.readFileSync("svelte-settings-engine.js", "utf8"), context);
  return {
    context,
    raw: load ? context.__fsAccount : null,
    gateway: load ? local.connectAccountBridge(context) : null,
    stored: () => run("store"),
    calls: () => run("calls"),
    set: code => vm.runInContext(code, context)
  };
}

await test("le script chargé expose __fsAccount sans rien appeler ni modifier", () => {
  const h = harness({ session: "secret", profile: { name: "Alice", email: "a@b.fr" } });
  assert.deepEqual(Object.keys(h.context.__fsAccount).sort(), ["read", "removeAvatar", "saveProfile", "setAvatar", "signOut"]);
  assert.deepEqual(h.calls(), []);
  assert.deepEqual(h.stored(), { session: "secret", profile: { name: "Alice", email: "a@b.fr" } });
  assert.ok(h.gateway);
});

await test("__fsSettings reste exposé à côté du nouveau pont", () => {
  const h = harness({});
  assert.equal(typeof h.context.__fsSettings.read, "function");
});

await test("read : profil et photo en JSON, sans rien appeler", () => {
  const h = harness({ profile: { name: "Alice", email: "a@b.fr" }, avatar: AVATAR });
  assert.deepEqual(JSON.parse(h.raw.read()), { name: "Alice", email: "a@b.fr", avatar: AVATAR });
  assert.deepEqual(h.gateway.read(), { profile: { name: "Alice", email: "a@b.fr" }, avatar: AVATAR });
  assert.deepEqual(h.calls(), []);
});

await test("read : profil absent, nul ou mal formé → valeurs vides ; photo qui n'est pas une image ignorée", () => {
  assert.deepEqual(JSON.parse(harness({}).raw.read()), { name: "", email: "", avatar: "" });
  assert.deepEqual(JSON.parse(harness({ profile: null }).raw.read()), { name: "", email: "", avatar: "" });
  assert.deepEqual(JSON.parse(harness({ profile: { name: 3, email: ["x"] }, avatar: "http://x/y.png" }).raw.read()), { name: "", email: "", avatar: "" });
});

await test("saveProfile : enregistre et réaffiche le profil via le moteur historique", () => {
  const h = harness({ profile: null });
  h.raw.saveProfile(JSON.stringify({ name: "Bob", email: "bob@x.fr" }));
  assert.deepEqual(h.stored().profile, { name: "Bob", email: "bob@x.fr" });
  assert.deepEqual(h.calls(), ["saveStore", "renderProfile"]);
});

await test("saveProfile : texte illisible ou valeur invalide → erreur, rien d'écrit", () => {
  const h = harness({ profile: null });
  assert.throws(() => h.raw.saveProfile("pas du json"), error => error.message.length > 0);
  assert.throws(() => h.raw.saveProfile(JSON.stringify([1])), error => error.message.length > 0);
  assert.deepEqual(h.calls(), []);
  assert.equal(h.stored().profile, null);
});

await test("setAvatar : enregistre la photo puis réaffiche le profil", () => {
  const h = harness({});
  h.gateway.setAvatar(AVATAR);
  assert.equal(h.stored().avatar, AVATAR);
  assert.deepEqual(h.calls(), ["saveStore", "renderProfile"]);
});

await test("setAvatar : refuse ce qui n'est pas une image, sans toucher au stockage", () => {
  const h = harness({ avatar: AVATAR });
  assert.throws(() => h.raw.setAvatar("data:application/pdf;base64,AAAA"), error => error.message === local.AVATAR_INVALID);
  assert.throws(() => h.raw.setAvatar(42), error => error.message === local.AVATAR_INVALID);
  assert.deepEqual(h.calls(), []);
  assert.equal(h.stored().avatar, AVATAR);
});

await test("setAvatar : stockage plein → ancienne photo restaurée et message « Stockage plein »", () => {
  const h = harness({ avatar: AVATAR });
  h.set("refuseSave = true;");
  assert.throws(() => h.gateway.setAvatar(OTHER), error => error.message === local.AVATAR_STORAGE_FULL);
  assert.equal(h.stored().avatar, AVATAR);
  assert.equal(h.calls().includes("renderProfile"), false);
});

await test("setAvatar : stockage plein sans photo précédente → aucune photo n'est laissée", () => {
  const h = harness({});
  h.set("refuseSave = true;");
  assert.throws(() => h.gateway.setAvatar(OTHER), error => error.message === local.AVATAR_STORAGE_FULL);
  assert.equal("avatar" in h.stored(), false);
});

await test("setAvatar : exception du stockage traitée comme un stockage plein", () => {
  const h = harness({ avatar: AVATAR });
  h.set("saveStore = function () { throw new Error('QuotaExceededError'); };");
  assert.throws(() => h.gateway.setAvatar(OTHER), error => error.message === local.AVATAR_STORAGE_FULL);
  assert.equal(h.stored().avatar, AVATAR);
});

await test("removeAvatar : retire la photo, enregistre et réaffiche", () => {
  const h = harness({ avatar: AVATAR, theme: "dark" });
  h.gateway.removeAvatar();
  assert.equal("avatar" in h.stored(), false);
  assert.equal(h.stored().theme, "dark");
  assert.deepEqual(h.calls(), ["saveStore", "renderProfile"]);
});

await test("signOut : passe par logout() du moteur historique", async () => {
  const h = harness({ session: "secret", profile: { name: "Alice", email: "a@b.fr" }, webSearchMode: "filtered" });
  await h.gateway.signOut();
  assert.equal(h.calls()[0], "logout");
  assert.equal(h.stored().session, "");
  assert.equal(h.stored().profile, null);
  assert.equal(h.stored().webSearchMode, "open");
});

await test("signOut : si le moteur historique échoue en interne, la session est toujours là → erreur", async () => {
  const h = harness({ session: "secret" });
  h.set('logoutMode = "silent";');
  await assert.rejects(() => h.gateway.signOut(), error => error.message.length > 0);
  assert.equal(h.stored().session, "secret");
});

await test("signOut : l'erreur du moteur historique remonte", async () => {
  const h = harness({ session: "secret" });
  h.set('logoutMode = "throw";');
  await assert.rejects(() => h.gateway.signOut(), /trousseau verrouillé/);
});

await test("fonction du moteur historique absente → erreur lisible, sans effet", async () => {
  const h = harness({ session: "secret" });
  h.set("renderProfile = undefined;");
  h.set("logout = undefined;");
  assert.throws(() => h.gateway.removeAvatar(), /moteur historique/);
  await assert.rejects(() => h.gateway.signOut(), /moteur historique/);
  assert.equal(h.stored().session, "secret");
});

await test("non connecté tant que le script n'est pas chargé", () => {
  const h = harness({}, { load: false });
  assert.equal(local.connectAccountBridge(h.context), null);
});

console.log(`ok - ${count} vérifications du pont du compte`);
