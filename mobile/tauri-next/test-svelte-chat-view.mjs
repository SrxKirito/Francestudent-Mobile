// Tests du service de présentation du chat (sources, pièces jointes, états). Node pur, aucun navigateur.
import assert from "node:assert/strict";

const view = await import("./src/lib/services/chat-view.ts");
let count = 0;
function test(name, fn) {
  try {
    fn();
    count += 1;
    console.log("ok - " + name);
  } catch (error) {
    console.error("NOK - " + name);
    console.error(error);
    process.exitCode = 1;
  }
}

test("sourceLabel : sous-domaine, domaine court et vide (parité assistant.js)", () => {
  assert.equal(view.sourceLabel("www.lemonde.fr"), "lemonde");
  assert.equal(view.sourceLabel("lemonde.fr"), "lemonde");
  assert.equal(view.sourceLabel("news.bbc.co.uk"), "bbc");
  assert.equal(view.sourceLabel("localhost"), "localhost");
  assert.equal(view.sourceLabel(""), "");
  assert.equal(view.sourceLabel(undefined), "");
});

test("sourceLetter : première lettre en majuscule, repli « ? »", () => {
  assert.equal(view.sourceLetter("www.lemonde.fr"), "L");
  assert.equal(view.sourceLetter(""), "?");
});

test("faviconUrl : encode le domaine", () => {
  assert.equal(view.faviconUrl("a b.fr"), "https://www.google.com/s2/favicons?domain=a%20b.fr&sz=64");
});

test("sourcesSummary : pluriel et recherche en cours", () => {
  assert.equal(view.sourcesSummary(1, false), "1 site consulté");
  assert.equal(view.sourcesSummary(3, false), "3 sites consultés");
  assert.equal(view.sourcesSummary(0, false), "0 site consulté");
  assert.equal(view.sourcesSummary(1, true), "Recherche sur le web… · 1 site");
  assert.equal(view.sourcesSummary(2, true), "Recherche sur le web… · 2 sites");
});

test("layoutSources : jusqu'à 4 cartes visibles, sinon 3 + « N autres sources »", () => {
  const mk = n => Array.from({ length: n }, (_, i) => ({ url: "https://s" + i + ".fr/", title: "", host: "s" + i + ".fr" }));
  const four = view.layoutSources(mk(4));
  assert.equal(four.collapsed, false);
  assert.equal(four.visible.length, 4);
  assert.equal(four.hiddenCount, 0);
  const seven = view.layoutSources(mk(7));
  assert.equal(seven.collapsed, true);
  assert.equal(seven.visible.length, 3);
  assert.equal(seven.hiddenCount, 4);
  assert.equal(seven.moreLabel, "4 autres sources");
  assert.equal(seven.moreIcons.length, 4);
  assert.equal(seven.pillIcons.length, 4);
  assert.equal(seven.all.length, 7);
});

test("layoutSources : entrée invalide → vide", () => {
  const r = view.layoutSources(undefined);
  assert.equal(r.all.length, 0);
  assert.equal(r.collapsed, false);
});

test("attachmentIcon : image, fichier, texte", () => {
  assert.equal(view.attachmentIcon("image"), "image");
  assert.equal(view.attachmentIcon("file"), "file");
  assert.equal(view.attachmentIcon("text"), "text");
  assert.equal(view.attachmentIcon("autre"), "file");
});

test("studyLabel : libellés des modes d'étude", () => {
  assert.equal(view.studyLabel(""), "Étudiant");
  assert.equal(view.studyLabel("fiches"), "Étudiant : Fiches");
  assert.equal(view.studyLabel("quiz"), "Étudiant : Quiz");
  assert.equal(view.studyLabel("cartes"), "Étudiant : Cartes mémoire");
});

test("toggleLabels : titres de la recherche web et de l'image", () => {
  assert.equal(view.webSearchTitle(false, "auto"), "Activer la recherche web");
  assert.equal(view.webSearchTitle(true, "auto"), "Désactiver la recherche web");
  assert.equal(view.webSearchTitle(false, "disabled"), "Recherche web désactivée dans Paramètres > Général");
  assert.equal(view.imageTitle(false), "Activer la génération d'image");
  assert.equal(view.imageTitle(true), "Désactiver la génération d'image");
});

test("liveStatus : indicateur selon l'état du flux", () => {
  assert.equal(view.liveStatus({ active: true, text: "", searching: true, sources: [], imageStarted: false }), "search");
  assert.equal(view.liveStatus({ active: true, text: "", searching: false, sources: [], imageStarted: true }), "image");
  assert.equal(view.liveStatus({ active: true, text: "", searching: false, sources: [], imageStarted: false }), "typing");
  assert.equal(view.liveStatus({ active: true, text: "abc", searching: false, sources: [], imageStarted: false }), "none");
  assert.equal(view.liveStatus({ active: false, text: "", searching: false, sources: [], imageStarted: false }), "none");
});

test("canSend : texte ou pièce jointe, pas pendant busy", () => {
  assert.equal(view.canSend("  ", 0, false), false);
  assert.equal(view.canSend("a", 0, false), true);
  assert.equal(view.canSend("", 1, false), true);
  assert.equal(view.canSend("a", 0, true), false);
});

test("envoi des pièces jointes : bloqué tant qu'un fichier n'est pas téléversé ; libellés de l'ancienne interface", () => {
  const file = extra => ({ id: "a", name: "a.pdf", kind: "file", ...extra });
  assert.equal(view.uploadsPending([]), false);
  assert.equal(view.uploadsPending([file()]), false);
  assert.equal(view.uploadsPending([file(), file({ upload: "queued" })]), true);
  assert.equal(view.uploadsPending([file({ upload: "uploading", progress: 0.2 })]), true);
  assert.equal(view.uploadsPending([file({ upload: "error" })]), true, "un échec bloque aussi l'envoi (retirer ou réessayer)");
  assert.equal(view.uploadLabel(file()), "");
  assert.equal(view.uploadLabel(file({ upload: "queued" })), "En attente d’envoi");
  assert.equal(view.uploadLabel(file({ upload: "uploading", progress: 0.456 })), "Envoi 46 %");
  assert.equal(view.uploadLabel(file({ upload: "uploading" })), "Envoi 0 %");
  assert.equal(view.uploadLabel(file({ upload: "uploading", progress: 3 })), "Envoi 100 %");
  assert.equal(view.uploadLabel(file({ upload: "error" })), "Échec");
});

test("liveVisible : bulle en direct seulement pendant la génération, jamais en double avec le message enregistré", () => {
  const live = { active: true, text: "abc", searching: false, sources: [], imageStarted: false };
  const user = { role: "user" };
  assert.equal(view.liveVisible({ busy: true, messages: [user] }, live), true);
  assert.equal(view.liveVisible({ busy: true, backgroundReply: true, messages: [user] }, live), false);
  assert.equal(view.liveVisible({ busy: true, messages: [] }, live), true);
  assert.equal(view.liveVisible({ busy: false, messages: [user] }, live), false);
  assert.equal(view.liveVisible({ busy: true, messages: [user] }, { ...live, active: false }), false);
  assert.equal(view.liveVisible({ busy: true, messages: [user, { role: "assistant" }] }, live), false);
});

console.log("exit " + (process.exitCode || 0) + " (" + count + " tests réussis)");
