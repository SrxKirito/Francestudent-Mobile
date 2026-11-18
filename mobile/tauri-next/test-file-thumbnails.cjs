"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "file-thumbnails.js"), "utf8");
const load = () => {
  const context = vm.createContext({ AbortController, Error, Object, Promise, Number, String, Map, Set, Array, TypeError });
  vm.runInContext(script, context);
  return context.tauriFileThumbnails;
};
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const textBlob = value => ({ size: value.length, text: async () => value });
const imageBlob = size => ({ size, text: async () => "" });

function makeEnv(overrides = {}) {
  const env = { fetches: [], urls: new Set(), created: [], revoked: [], active: 0, maxActive: 0, pending: new Map() };
  env.fetchBlob = (file, options) => {
    env.fetches.push({ id: file.id, ...options });
    env.active++; env.maxActive = Math.max(env.maxActive, env.active);
    const gate = deferred();
    env.pending.set(file.id, { ...gate, options });
    return gate.promise.finally(() => { env.active--; });
  };
  env.createUrl = (blob, mime) => { const url = "blob:" + (env.created.length + 1); env.created.push({ url, mime, size: blob.size }); env.urls.add(url); return url; };
  env.revokeUrl = url => { env.revoked.push(url); env.urls.delete(url); };
  env.make = (extra = {}) => load().create({ fetchBlob: (f, o) => env.fetchBlob(f, o), createUrl: env.createUrl, revokeUrl: env.revokeUrl, ...overrides, ...extra });
  return env;
}
const fileOf = (id, filename, bytes) => ({ id, filename, bytes });

async function testPlanNeverFetchesHeavyFormats() {
  const env = makeEnv();
  const thumbs = env.make();
  for (const name of ["cours.pdf", "memo.docx", "slides.pptx", "logo.svg", "photo.heic", "archive.zip", "sans-extension", "feuille.xlsx"]) {
    const result = await thumbs.request(fileOf("x-" + name, name, 100));
    assert.equal(result.type, "icon", name);
    assert.equal(result.reason, "unsupported", name);
  }
  assert.equal(env.fetches.length, 0, "aucune requête pour les formats non prévisualisables");
  assert.equal((await thumbs.request(fileOf("p", "cours.pdf", 1))).label, "PDF");
  assert.equal((await thumbs.request(fileOf("p", "sans-extension", 1))).label, "FICHIER");
  assert.equal((await thumbs.request(fileOf("p", "plan.abcdefg", 1))).label, "ABCD", "extension tronquée à 4 caractères");
  const big = await thumbs.request(fileOf("big", "photo.png", 50 * 1024 * 1024));
  eq(big, "icon", "too-large");
  assert.equal(env.fetches.length, 0, "taille connue trop grande : aucune requête");
  assert.equal((await thumbs.request({ filename: "a.png" })).type, "icon", "identifiant absent : icône");
  assert.equal(env.fetches.length, 0);
  assert.throws(() => load().create({}), /requis/);
}
function eq(result, type, reason) { assert.equal(result.type, type); assert.equal(result.reason, reason); }

async function testImageLeaseAndSharing() {
  const env = makeEnv();
  const thumbs = env.make({ maxCachedImages: 2 });
  const first = thumbs.request(fileOf("a", "a.PNG", 1000));
  const sameFile = thumbs.request(fileOf("a", "a.PNG", 1000));
  await tick();
  assert.equal(env.fetches.length, 1, "deux demandes simultanées = une seule requête");
  assert.equal(env.fetches[0].limit, 2 * 1024 * 1024, "la limite d'octets est transmise");
  assert.equal(env.fetches[0].truncate, false, "une image n'est jamais tronquée");
  env.pending.get("a").resolve(imageBlob(1000));
  const [r1, r2] = await Promise.all([first, sameFile]);
  assert.equal(r1.type, "image"); assert.equal(r1.url, r2.url);
  assert.equal(env.created[0].mime, "image/png");
  const again = await thumbs.request(fileOf("a", "a.PNG", 1000));
  assert.equal(env.fetches.length, 1, "deuxième ouverture : servie par le cache");
  assert.equal(again.url, r1.url);

  // Au-delà du plafond, rien n'est révoqué tant que les URL sont affichées (baux).
  for (const id of ["b", "c"]) {
    const pending = thumbs.request(fileOf(id, id + ".jpg", 10));
    await tick(); env.pending.get(id).resolve(imageBlob(10)); await pending;
  }
  assert.equal(env.revoked.length, 0, "aucune URL affichée n'est révoquée");
  assert.equal(thumbs.stats().images, 3);
  r1.release(); r1.release(); r2.release();
  assert.equal(env.revoked.length, 0, "un bail est encore tenu (troisième appelant)");
  again.release();
  assert.deepEqual([...env.revoked], [r1.url], "la plus ancienne vignette sans bail est révoquée après libération");
  assert.equal(thumbs.stats().images, 2);

  thumbs.clear();
  assert.equal(env.urls.size, 0, "clear() révoque toutes les URL restantes");
  assert.equal(thumbs.stats().cached, 0);
}

async function testBoundsAndFallbacks() {
  const env = makeEnv();
  const thumbs = env.make();
  // Octets réels supérieurs à la limite alors que la taille annoncée est inconnue ou fausse.
  const oversized = thumbs.request({ id: "o", filename: "o.webp" });
  await tick(); env.pending.get("o").resolve(imageBlob(3 * 1024 * 1024));
  eq(await oversized, "icon", "too-large");
  assert.equal(env.created.length, 0, "aucune URL créée pour un contenu trop gros");
  const again = await thumbs.request({ id: "o", filename: "o.webp" });
  eq(again, "icon", "too-large");
  assert.equal(env.fetches.length, 1, "l'échec « trop gros » est mémorisé");

  // Erreur de transport : icône, pas de rejet, pas de mémorisation (réessai possible).
  const failing = thumbs.request(fileOf("e", "e.gif", 5));
  await tick(); env.pending.get("e").reject(new Error("HTTP 500"));
  eq(await failing, "icon", "error");
  const retry = thumbs.request(fileOf("e", "e.gif", 5));
  await tick();
  assert.equal(env.fetches.filter(f => f.id === "e").length, 2, "une erreur n'est pas mise en cache");
  env.pending.get("e").resolve(imageBlob(5));
  assert.equal((await retry).type, "image");

  // Un code « too-large » levé par la couche réseau est traité comme tel.
  const bounded = thumbs.request(fileOf("t", "t.png", 5));
  await tick(); env.pending.get("t").reject(Object.assign(new Error("gros"), { code: "too-large" }));
  eq(await bounded, "icon", "too-large");
  thumbs.clear();
}

async function testText() {
  const env = makeEnv();
  const thumbs = env.make({ textMaxLines: 3, textMaxChars: 40, textMaxLineLength: 10 });
  const code = thumbs.request(fileOf("c", "main.py", 90000));
  await tick();
  assert.equal(env.fetches[0].truncate, true, "le texte est lu en tronquant");
  assert.equal(env.fetches[0].limit, 16 * 1024);
  env.pending.get("c").resolve(textBlob("\uFEFFimport os\r\nprint('bonjour tout le monde')\r\n\r\nligne 4\r\nligne 5\r\n"));
  const result = await code;
  assert.equal(result.type, "text");
  assert.equal(result.text, "import os\nprint('bon…", "BOM retiré, 3 lignes au plus, lignes longues coupées, fin nettoyée");
  assert.ok(!result.text.includes("ligne 4"), "limite de lignes");
  assert.ok(!result.text.includes("\r"));

  const tight = env.make({ textMaxLines: 5, textMaxChars: 15, textMaxLineLength: 10 });
  const long = tight.request(fileOf("l", "notes.txt", 10));
  await tick(); env.pending.get("l").resolve(textBlob(Array.from({ length: 4 }, () => "abcdefghi").join("\n")));
  const longResult = await long;
  assert.equal(longResult.text, "abcdefghi\nabcde…", "limite de caractères avec ellipse");

  const binary = thumbs.request(fileOf("b", "data.json", 10));
  await tick(); env.pending.get("b").resolve(textBlob("{\u0000\u0001binaire"));
  eq(await binary, "icon", "binary");

  const empty = thumbs.request(fileOf("v", "vide.txt", 0));
  await tick(); env.pending.get("v").resolve(textBlob("  \n\n"));
  eq(await empty, "icon", "empty");

  // Le HTML reste du texte brut : aucun traitement, juste une chaîne.
  const html = thumbs.request(fileOf("h", "page.html", 10));
  await tick(); env.pending.get("h").resolve(textBlob("<script>alert(1)</script>"));
  const htmlResult = await html;
  assert.equal(htmlResult.type, "text");
  assert.equal(htmlResult.text, "<script>al…");
}

async function testConcurrencyAndAbort() {
  const env = makeEnv();
  const thumbs = env.make({ concurrency: 2 });
  const requests = ["1", "2", "3", "4", "5"].map(id => thumbs.request(fileOf(id, id + ".png", 5)));
  await tick();
  assert.equal(env.active, 2, "pas plus de deux requêtes simultanées");
  assert.equal(thumbs.stats().queued, 3);
  env.pending.get("1").resolve(imageBlob(5)); await tick();
  assert.equal(env.active, 2); assert.equal(env.maxActive, 2);
  for (const id of ["2", "3", "4", "5"]) { await tick(); env.pending.get(id)?.resolve(imageBlob(5)); }
  const results = await Promise.all(requests);
  assert.equal(results.filter(r => r.type === "image").length, 5);
  assert.equal(env.maxActive, 2);
  thumbs.clear();

  // Annulation d'une demande en file : jamais envoyée au réseau.
  const env2 = makeEnv();
  const queued = env2.make({ concurrency: 1 });
  const blocker = queued.request(fileOf("run", "run.png", 5));
  const controller = new AbortController();
  const waiting = queued.request(fileOf("wait", "wait.png", 5), { signal: controller.signal });
  await tick(); controller.abort();
  await assert.rejects(waiting, error => error.name === "AbortError");
  env2.pending.get("run").resolve(imageBlob(5)); await blocker; await tick();
  assert.ok(!env2.fetches.some(f => f.id === "wait"), "une demande annulée avant son tour n'est jamais exécutée");
  await assert.rejects(queued.request(fileOf("z", "z.png", 5), { signal: controller.signal }), error => error.name === "AbortError", "signal déjà annulé");
  queued.clear();

  // Un seul des deux demandeurs annule : la requête continue pour l'autre ; si tous annulent, elle est interrompue.
  const env3 = makeEnv();
  const shared = env3.make();
  const c1 = new AbortController(), c2 = new AbortController();
  const p1 = shared.request(fileOf("s", "s.png", 5), { signal: c1.signal });
  const p2 = shared.request(fileOf("s", "s.png", 5), { signal: c2.signal });
  await tick(); c1.abort();
  await assert.rejects(p1, /Annulé/);
  assert.equal(env3.pending.get("s").options.signal.aborted, false, "l'autre demandeur attend encore");
  env3.pending.get("s").resolve(imageBlob(5));
  assert.equal((await p2).type, "image");

  const p3 = shared.request(fileOf("u", "u.png", 5), { signal: c2.signal });
  await tick(); c2.abort();
  await assert.rejects(p3, error => error.name === "AbortError");
  assert.equal(env3.pending.get("u").options.signal.aborted, true, "plus personne n'attend : la lecture est interrompue");
  env3.pending.get("u").reject(Object.assign(new Error("Annulé"), { name: "AbortError" }));
  await tick();
  assert.equal(env3.urls.size, 1, "l'image annulée ne laisse aucune URL");
  shared.clear();

  // clear() pendant une lecture : rejet et aucune URL ne survit.
  const env4 = makeEnv();
  const cleared = env4.make();
  const inflight = cleared.request(fileOf("k", "k.png", 5));
  await tick(); cleared.clear();
  await assert.rejects(inflight, error => error.name === "AbortError");
  env4.pending.get("k").resolve(imageBlob(5)); await tick();
  assert.equal(env4.urls.size, 0, "une lecture terminée après clear() ne recrée rien");
  assert.equal(env4.created.length, 0);
}

(async () => {
  await testPlanNeverFetchesHeavyFormats();
  await testImageLeaseAndSharing();
  await testBoundsAndFallbacks();
  await testText();
  await testConcurrencyAndAbort();
  console.log("Vignettes Files V2 : formats lourds sans requête, limites d'octets, baux d'URL, texte inerte, concurrence et annulation vérifiés.");
})().catch(error => { console.error(error); process.exitCode = 1; });
