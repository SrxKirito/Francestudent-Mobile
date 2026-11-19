// Contrat entre svelte-engine.js (ancienne interface) et la coque Svelte : analyse de l'instantané (archives, recherche
// sur le serveur) et liaison de toutes les méthodes. Test Node : il ne remplace pas verify-shell-browser.mjs (clics réels).
import assert from "node:assert/strict";
import { NO_ARCHIVE, NO_REMOTE_SEARCH, connectLegacyEngine, parseIds, parseSnapshot } from "./src/lib/services/legacy-engine.ts";

let count = 0;
function test(name, fn) {
  try {
    fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
}

const base = { ready: true, conversations: [{ id: "a", title: "Maths" }], currentId: null, project: null, agents: [] };

test("sans bloc archive ni recherche distante : valeurs neutres, aucune erreur", () => {
  const snapshot = parseSnapshot(JSON.stringify(base));
  assert.deepEqual(snapshot.archive, NO_ARCHIVE);
  assert.deepEqual(snapshot.remoteSearch, NO_REMOTE_SEARCH);
  assert.equal(snapshot.archive.available, false);
});

test("archive disponible : lignes, état, bouton « Charger plus »", () => {
  const snapshot = parseSnapshot(JSON.stringify({
    ...base,
    archive: {
      available: true, open: true, status: "Chargement des archives…", moreHidden: false, moreLabel: "Charger plus", moreDisabled: true,
      rows: [{ id: "c1", title: "Vieille discussion", busy: true }, { id: "", title: "sans identifiant" }, { title: "invalide" }, "texte", { id: "c2", title: 3 }]
    }
  }));
  assert.equal(snapshot.archive.available, true);
  assert.equal(snapshot.archive.open, true);
  assert.equal(snapshot.archive.status, "Chargement des archives…");
  assert.deepEqual(snapshot.archive.rows, [{ id: "c1", title: "Vieille discussion", busy: true }, { id: "c2", title: "", busy: false }]);
  assert.equal(snapshot.archive.moreHidden, false);
  assert.equal(snapshot.archive.moreLabel, "Charger plus");
  assert.equal(snapshot.archive.moreDisabled, true);
});

test("archive non disponible : le reste du bloc est ignoré", () => {
  const snapshot = parseSnapshot(JSON.stringify({ ...base, archive: { available: false, open: true, rows: [{ id: "x", title: "x" }] } }));
  assert.deepEqual(snapshot.archive, NO_ARCHIVE);
});

test("recherche distante : statut et titres seulement (valeurs non textuelles écartées)", () => {
  const snapshot = parseSnapshot(JSON.stringify({ ...base, remoteSearch: { status: "Recherche…", results: ["Géographie · Projet", 4, null, "Histoire"] } }));
  assert.equal(snapshot.remoteSearch.status, "Recherche…");
  assert.deepEqual(snapshot.remoteSearch.results, ["Géographie · Projet", "Histoire"]);
  assert.deepEqual(parseSnapshot(JSON.stringify({ ...base, remoteSearch: "n'importe quoi" })).remoteSearch, NO_REMOTE_SEARCH);
});

test("instantané invalide : erreur explicite", () => {
  assert.throws(() => parseSnapshot("[]"), /invalide/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ready: true })), /invalide/);
  assert.throws(() => parseIds('{"a":1}'), /invalide/);
});

const METHODS = [
  "attach", "detach", "snapshot", "matches", "setLayout", "act", "closeMenus", "openConversation", "togglePin",
  "renameConversation", "deleteConversation", "archiveConversation", "search", "composition", "toggleArchive",
  "restoreArchived", "downloadArchived", "moreArchived", "openRemote"
];

function fakeRaw(log) {
  const raw = {};
  for (const name of METHODS) raw[name] = (...args) => { log.push([name, ...args]); return name === "snapshot" ? JSON.stringify(base) : name === "matches" ? '["a"]' : undefined; };
  return raw;
}

test("liaison : chaque méthode du moteur est reliée avec ses arguments", () => {
  const log = [];
  const engine = connectLegacyEngine({ __fsEngine: fakeRaw(log) });
  assert.ok(engine);
  engine.archiveConversation("l1");
  engine.search("géo");
  engine.composition(true);
  engine.toggleArchive();
  engine.restoreArchived("c1");
  engine.downloadArchived("c2");
  engine.moreArchived();
  engine.openRemote(2);
  assert.deepEqual(log, [
    ["archiveConversation", "l1"], ["search", "géo"], ["composition", true], ["toggleArchive"],
    ["restoreArchived", "c1"], ["downloadArchived", "c2"], ["moreArchived"], ["openRemote", 2]
  ]);
  assert.deepEqual([...engine.matches("a")], ["a"]);
  assert.equal(engine.snapshot().conversations[0].title, "Maths");
});

test("liaison : un moteur incomplet (ancien script de pont) est refusé, pas à moitié branché", () => {
  const raw = fakeRaw([]);
  delete raw.openRemote;
  assert.equal(connectLegacyEngine({ __fsEngine: raw }), null);
  assert.equal(connectLegacyEngine({}), null);
  assert.equal(connectLegacyEngine(null), null);
});

console.log(`test-svelte-engine-state : ${count} tests réussis`);
