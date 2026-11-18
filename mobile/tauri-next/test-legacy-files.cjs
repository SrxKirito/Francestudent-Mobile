"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  let resolveUpload;
  let sent = 0;
  const notices = [];
  const context = vm.createContext({
    pendingFiles: [], busy: false,
    document: { querySelectorAll: () => [] },
    $: () => ({ disabled: false }),
    renderAttachments() {}, removeAttachment(id) { context.pendingFiles = context.pendingFiles.filter(file => file.id !== id); },
    previewAttachment() {}, previewBlob() {}, updateSendButton() {},
    async sendMessage() { sent++; context.pendingFiles = []; },
    makeId: () => "file-1", getAccessToken: async () => "test-token",
    showToast: value => notices.push(value),
    tauriTransport: { upload: () => new Promise(resolve => { resolveUpload = resolve; }) },
    URL, AbortController, Array, Date, Math, String
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  const remote = context.tauriMessageFiles({ usedFilesV2Ids: ["file-v2-1", "file-v2-1"], usedFileIds: ["legacy-1"] });
  assert.equal(remote.length, 2);
  const merged = context.tauriMergeMessageFiles(remote, [{ remoteId: "file-v2-1", remoteKind: "file", name: "note.txt" }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, "note.txt");
  assert.equal(context.tauriFindLocalMessage({ serverMessageId: "m2", content: "x" }, [{ serverMessageId: "m1", content: "x" }, { serverMessageId: "m2", content: "y" }], 0).content, "y");
  assert.equal(context.tauriFindLocalMessage({ serverMessageId: "m3", content: "autre" }, [{ content: "ancien" }], 0), null);
  const file = new File(["contenu"], "note.txt", { type: "text/plain" });
  await context.addFiles([file]);
  await Promise.resolve();
  assert.equal(context.pendingFiles.length, 1);
  assert.equal(context.pendingFiles[0].uploadState, "uploading");
  await context.sendMessage();
  assert.equal(sent, 0);
  assert.ok(notices.some(text => text.includes("fin des envois")));
  resolveUpload({ id: "file-v2-1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.pendingFiles[0].remoteId, "file-v2-1");
  assert.equal(context.pendingFiles[0].remoteKind, "file");
  assert.equal(context.pendingFiles[0].uploadState, "done");
  assert.equal(context.pendingFiles[0].data, "");
  await context.sendMessage();
  assert.equal(sent, 1);
}
main().then(() => console.log("Pièces jointes : transfert et blocage de l’envoi vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });

async function testMultipleSelectionQueue() {
  let nextId = 0, active = 0, maxActive = 0;
  const started = [], transfers = new Map(), notices = [];
  const context = vm.createContext({
    pendingFiles: [], busy: false, document: { querySelectorAll: () => [] }, $: () => ({ disabled: false }),
    renderAttachments() {}, removeAttachment(id) { context.pendingFiles = context.pendingFiles.filter(file => file.id !== id); },
    previewAttachment() {}, previewBlob() {}, updateSendButton() {}, sendMessage: async () => {},
    makeId: () => `file-${++nextId}`, getAccessToken: async () => "test-token", showToast: value => notices.push(value),
    tauriTransport: { upload(file, token, signal) {
      active++; maxActive = Math.max(maxActive, active); started.push(file.name);
      return new Promise((resolve, reject) => {
        transfers.set(file.name, { resolve, reject });
        signal.addEventListener("abort", () => reject(new Error("annulé")), { once: true });
      }).finally(() => { active--; });
    } }, URL, AbortController, Array, Date, Math, String
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  await context.addFiles(["a", "b", "c", "d"].map(name => new File([name], name, { type: "text/plain" })));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(context.pendingFiles[2].uploadState, "queued");
  context.removeAttachment("file-3");
  transfers.get("a").resolve({ id: "remote-a" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b", "d"]);
  context.removeAttachment("file-2");
  transfers.get("d").resolve({ id: "remote-d" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxActive, 2);
  assert.equal(context.pendingFiles.length, 2);
  assert(context.pendingFiles.every(file => file.uploadState === "done"));
  assert.equal(notices.length, 0);
}
testMultipleSelectionQueue().then(() => console.log("Sélection multiple : concurrence limitée et annulations vérifiées.")).catch(error => { console.error(error); process.exitCode = 1; });

async function testBoundedPreviewAndDownload() {
  let cancelled = false;
  const context = vm.createContext({
    pendingFiles: [], busy: false, document: { querySelectorAll: () => [] }, $: () => ({ disabled: false }),
    renderAttachments() {}, removeAttachment() {}, previewAttachment() {}, previewBlob() {}, updateSendButton() {}, sendMessage() {},
    URL, AbortController, Array, Date, Math, String, Blob, Response, TransformStream, TextDecoder, Uint8Array, atob
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
  await assert.rejects(context.tauriBoundedBlob(new Response(stream), 4), /volumineux/);
  assert(cancelled);
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(controller) { for (const value of ['"SG', 'Vsb', 'G8=', '"']) controller.enqueue(encoder.encode(value)); controller.close(); } });
  const decoded = context.tauriDecodedFileResponse(new Response(body, { headers: { "content-type": "application/json" } }));
  assert.equal(await decoded.text(), "Hello");
  const invalid = context.tauriDecodedFileResponse(new Response('"SGVsbG8', { headers: { "content-type": "application/json" } }));
  await assert.rejects(invalid.text(), /incomplet/);
  const binary = new Response("contenu", { headers: { "content-type": "application/octet-stream" } });
  assert.equal(context.tauriDecodedFileResponse(binary), binary);
}
testBoundedPreviewAndDownload().then(() => console.log("Aperçu borné et téléchargement décodé par blocs vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });

async function testDownloadTauriRemoteFile() {
  const notices = [];
  let openedPath = null;
  const context = vm.createContext({
    renderAttachments() {}, removeAttachment() {}, previewAttachment() {}, sendMessage() {}, updateSendButton() {},
    apiFetch: async () => new Response("fichier test", { headers: { "content-type": "application/octet-stream" } }),
    tauriTransport: {
      saveResponse: async (name, res) => "/path/to/" + name,
      canOpenSavedFile: async () => true,
      openSavedFile: async (path) => { openedPath = path; }
    },
    showToast: value => notices.push(value),
    confirm: () => true,
    URL, AbortController, Array, Date, Math, String, Blob, Response, TransformStream, TextDecoder, Uint8Array
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  await context.downloadTauriRemoteFile({ remoteId: "file-123", name: "rapport.pdf" });
  assert.equal(openedPath, "/path/to/rapport.pdf");
  assert.ok(notices.some(t => t.includes("Fichier enregistré.")));
}
testDownloadTauriRemoteFile().then(() => console.log("Téléchargement et ouverture de fichier vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });

async function testThumbnailBlob() {
  const requests = [];
  let respond;
  const context = vm.createContext({
    renderAttachments() {}, removeAttachment() {}, previewAttachment() {}, sendMessage() {}, updateSendButton() {},
    apiFetch: async (path, options) => { requests.push({ path, options }); return respond(); },
    URL, AbortController, Array, Date, Math, String, Object, Error, Blob, Response, TransformStream, TextDecoder, Uint8Array, atob
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  const endless = state => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(6).fill(65)); }, cancel() { state.cancelled = true; } }), { headers: { "content-type": "image/png" } });

  // Image : dépassement de limite = erreur « too-large », flux interrompu, pas de lecture infinie.
  let state = { cancelled: false };
  respond = () => endless(state);
  await assert.rejects(context.tauriThumbnailBlob({ id: "a/b" }, { limit: 10 }), error => error.code === "too-large");
  assert.equal(state.cancelled, true, "le flux est fermé dès que la limite est dépassée");
  assert.equal(requests[0].path, "/filesv2/a%2Fb/content", "identifiant encodé dans le chemin");

  // Texte : le début est conservé, tronqué exactement à la limite.
  state = { cancelled: false };
  const head = await context.tauriThumbnailBlob({ id: "t" }, { limit: 10, truncate: true });
  assert.equal(head.size, 10);
  assert.equal(await head.text(), "AAAAAAAAAA");
  assert.equal(state.cancelled, true);

  // Petit fichier brut : contenu complet, type du serveur conservé.
  respond = () => new Response("bonjour", { headers: { "content-type": "image/png" } });
  const small = await context.tauriThumbnailBlob({ id: "s" }, { limit: 100 });
  assert.equal(await small.text(), "bonjour");
  assert.equal(small.type, "image/png");

  // Réponse JSON base64 (Files V2) : décodée avant de compter les octets.
  respond = () => new Response('"SGVsbG8="', { headers: { "content-type": "application/json" } });
  assert.equal(await (await context.tauriThumbnailBlob({ id: "j" }, { limit: 100 })).text(), "Hello");
  await assert.rejects(context.tauriThumbnailBlob({ id: "j" }, { limit: 3 }), error => error.code === "too-large", "limite appliquée aux octets décodés");

  // Erreur HTTP et annulation.
  respond = () => new Response("non", { status: 404 });
  await assert.rejects(context.tauriThumbnailBlob({ id: "x" }, { limit: 10 }), /HTTP 404/);
  const controller = new AbortController();
  controller.abort();
  const before = requests.length;
  await assert.rejects(context.tauriThumbnailBlob({ id: "y" }, { limit: 10, signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(requests.length, before, "signal déjà annulé : aucune requête");
  const later = new AbortController();
  state = { cancelled: false };
  respond = () => { later.abort(); return endless(state); };
  await assert.rejects(context.tauriThumbnailBlob({ id: "z" }, { limit: 1000, signal: later.signal }), error => error.name === "AbortError");
  assert.equal(state.cancelled, true, "annulation pendant la lecture : flux fermé");
}
testThumbnailBlob().then(() => console.log("Vignettes : lecture bornée, troncature du texte, base64 JSON, erreurs et annulation vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });

async function testFileSizeLimit() {
  const LIMIT = 50 * 1024 * 1024;
  let nextId = 0, sent = 0;
  const uploads = [], toasts = [];
  const context = vm.createContext({
    pendingFiles: [], busy: false, document: { querySelectorAll: () => [] }, $: () => ({ disabled: false }),
    renderAttachments() {}, removeAttachment() {}, previewAttachment() {}, previewBlob() {}, updateSendButton() {},
    async sendMessage() { sent++; },
    makeId: () => `limit-${++nextId}`, getAccessToken: async () => "test-token",
    showToast: (value, isError) => toasts.push({ value, isError }),
    tauriTransport: { upload: async file => { uploads.push(file.name); return { id: "remote-" + file.name }; } },
    URL, AbortController, Array, Date, Math, String
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-files.js"), "utf8"), context);
  // Seule la taille annoncée compte : on évite d'allouer 50 Mo en mémoire.
  const sized = (name, size) => Object.defineProperty(new File(["x"], name, { type: "application/octet-stream" }), "size", { value: size });

  // 50 Mo + 1 octet : refusé, aucun envoi, toast d'erreur.
  await context.addFiles([sized("trop-gros.bin", LIMIT + 1)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.pendingFiles.length, 0, "le fichier refusé n'est pas ajouté");
  assert.deepEqual(uploads, [], "aucun envoi ne part");
  assert.equal(sent, 0);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].isError, true, "le toast est un toast d'erreur");
  assert.ok(toasts[0].value.includes("trop-gros.bin") && toasts[0].value.includes("50 Mo"));

  // Exactement 50 Mo : accepté et envoyé, sans nouveau toast.
  await context.addFiles([sized("limite.bin", LIMIT)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.pendingFiles.length, 1);
  assert.equal(context.pendingFiles[0].name, "limite.bin");
  assert.equal(context.pendingFiles[0].uploadState, "done");
  assert.deepEqual(uploads, ["limite.bin"]);
  assert.equal(toasts.length, 1, "aucun toast supplémentaire pour un fichier à la limite");

  // Sélection mixte : seul le fichier trop gros est écarté.
  await context.addFiles([sized("ok.bin", 10), sized("gros.bin", LIMIT + 1)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(context.pendingFiles.map(file => file.name), ["limite.bin", "ok.bin"]);
  assert.deepEqual(uploads, ["limite.bin", "ok.bin"]);
  assert.equal(toasts.length, 2);
  assert.equal(toasts[1].isError, true);
}
testFileSizeLimit().then(() => console.log("Limite de 50 Mo : refus à 50 Mo + 1 octet, acceptation à 50 Mo vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });

