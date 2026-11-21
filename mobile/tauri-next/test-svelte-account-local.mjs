// Données locales du compte (profil, photo, déconnexion) : implémentation directe (fs-chat-state) et pont vers le moteur historique.
import assert from "node:assert/strict";

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

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    refuse: false,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (storage.refuse) throw new Error("QuotaExceededError");
      data.set(key, value);
    }
  };
  return storage;
}

const KEY = "fs-chat-state";
const AVATAR = "data:image/jpeg;base64,AAAA";

await test("messages : identiques à l'écran historique", () => {
  assert.equal(local.AVATAR_STORAGE_FULL, "Stockage plein : impossible d'enregistrer la photo.");
  assert.equal(local.AVATAR_INVALID, "Choisis un fichier image.");
});

await test("stockage direct : lecture d'un état vide, du profil et de la photo", () => {
  const empty = local.createStorageAccount(fakeStorage());
  assert.deepEqual(empty.read(), { profile: { name: "", email: "" }, avatar: "" });
  const saved = local.createStorageAccount(fakeStorage({ [KEY]: JSON.stringify({ profile: { name: "Alice", email: "a@b.fr" }, avatar: AVATAR }) }));
  assert.deepEqual(saved.read(), { profile: { name: "Alice", email: "a@b.fr" }, avatar: AVATAR });
  const wrong = local.createStorageAccount(fakeStorage({ [KEY]: JSON.stringify({ avatar: "https://exemple.fr/a.png" }) }));
  assert.equal(wrong.read().avatar, "");
});

await test("stockage direct : enregistrer le profil conserve le reste de l'état et retire la session", () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify({ theme: "dark", conversations: [{ id: 1 }], session: "secret" }) });
  const account = local.createStorageAccount(storage);
  account.saveProfile({ name: "Alice", email: "a@b.fr" });
  const state = JSON.parse(storage.getItem(KEY));
  assert.deepEqual(state.profile, { name: "Alice", email: "a@b.fr" });
  assert.equal(state.theme, "dark");
  assert.deepEqual(state.conversations, [{ id: 1 }]);
  assert.equal("session" in state, false);
});

await test("stockage direct : photo valide enregistrée, type invalide refusé sans rien écrire", () => {
  const storage = fakeStorage();
  const account = local.createStorageAccount(storage);
  account.setAvatar(AVATAR);
  assert.equal(account.read().avatar, AVATAR);
  assert.throws(() => account.setAvatar("data:text/plain;base64,AAAA"), error => error.message === local.AVATAR_INVALID);
  assert.equal(account.read().avatar, AVATAR);
});

await test("stockage direct : stockage plein → erreur lisible et ancienne photo conservée", () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify({ avatar: AVATAR }) });
  const account = local.createStorageAccount(storage);
  storage.refuse = true;
  assert.throws(() => account.setAvatar("data:image/jpeg;base64,BBBB"), error => error.message === local.AVATAR_STORAGE_FULL);
  storage.refuse = false;
  assert.equal(account.read().avatar, AVATAR);
});

await test("stockage direct : retirer la photo", () => {
  const account = local.createStorageAccount(fakeStorage({ [KEY]: JSON.stringify({ avatar: AVATAR, theme: "light" }) }));
  account.removeAvatar();
  assert.equal(account.read().avatar, "");
  assert.equal(account.read().profile.name, "");
});

await test("stockage direct : déconnexion efface l'identité et les drapeaux liés au compte, pas les préférences", async () => {
  const storage = fakeStorage({
    [KEY]: JSON.stringify({ profile: { name: "Alice", email: "a@b.fr" }, avatar: AVATAR, theme: "dark", webSearchMode: "filtered", customInstructionsManaged: true, fileInstrSynced: true })
  });
  const account = local.createStorageAccount(storage);
  await account.signOut();
  const state = JSON.parse(storage.getItem(KEY));
  assert.equal(state.profile, null);
  assert.equal(state.customInstructionsManaged, false);
  assert.equal(state.fileInstrSynced, false);
  assert.equal(state.webSearchMode, "open");
  assert.equal(state.theme, "dark");
  assert.equal(state.avatar, AVATAR);
});

function rawBridge(overrides = {}) {
  const calls = [];
  const bridge = {
    calls,
    read: () => JSON.stringify({ name: "Alice", email: "a@b.fr", avatar: AVATAR }),
    saveProfile: json => void calls.push(["saveProfile", json]),
    setAvatar: dataUrl => void calls.push(["setAvatar", dataUrl]),
    removeAvatar: () => void calls.push(["removeAvatar"]),
    signOut: async () => void calls.push(["signOut"]),
    ...overrides
  };
  return bridge;
}

await test("pont : introuvable ou incomplet → null, complet → passerelle", () => {
  assert.equal(local.connectAccountBridge(null), null);
  assert.equal(local.connectAccountBridge({}), null);
  assert.equal(local.connectAccountBridge({ __fsAccount: { read() {} } }), null);
  assert.ok(local.connectAccountBridge({ __fsAccount: rawBridge() }));
  const hostile = {
    get __fsAccount() {
      throw new Error("accès refusé");
    }
  };
  assert.equal(local.connectAccountBridge(hostile), null);
});

await test("pont : lecture normalisée, texte illisible → état vide", () => {
  assert.deepEqual(local.createBridgeAccount(rawBridge()).read(), { profile: { name: "Alice", email: "a@b.fr" }, avatar: AVATAR });
  assert.deepEqual(local.createBridgeAccount(rawBridge({ read: () => "pas du json" })).read(), { profile: { name: "", email: "" }, avatar: "" });
  assert.deepEqual(local.createBridgeAccount(rawBridge({ read: () => JSON.stringify({ name: 3, avatar: "http://x/y.png" }) })).read(), { profile: { name: "", email: "" }, avatar: "" });
});

await test("pont : profil transmis en JSON, photo validée avant transmission", async () => {
  const raw = rawBridge();
  const account = local.createBridgeAccount(raw);
  account.saveProfile({ name: "Alice", email: "a@b.fr" });
  account.setAvatar(AVATAR);
  account.removeAvatar();
  await account.signOut();
  assert.deepEqual(raw.calls, [["saveProfile", JSON.stringify({ name: "Alice", email: "a@b.fr" })], ["setAvatar", AVATAR], ["removeAvatar"], ["signOut"]]);
  assert.throws(() => account.setAvatar("data:application/pdf;base64,AAAA"), error => error.message === local.AVATAR_INVALID);
  assert.equal(raw.calls.length, 4);
});

await test("pont : les erreurs du moteur historique remontent telles quelles", async () => {
  const account = local.createBridgeAccount(
    rawBridge({
      setAvatar() {
        throw new Error(local.AVATAR_STORAGE_FULL);
      },
      signOut: async () => {
        throw new Error("Déconnexion impossible : trousseau verrouillé.");
      }
    })
  );
  assert.throws(() => account.setAvatar(AVATAR), error => error.message === local.AVATAR_STORAGE_FULL);
  await assert.rejects(() => account.signOut(), /trousseau verrouillé/);
});

console.log(`ok - ${count} vérifications des données locales du compte`);
