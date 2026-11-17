"use strict";

// The snapshot is the source of truth; do not infer undocumented operations.
const fs = require("node:fs");
const path = require("node:path");
const base = __dirname;
const spec = JSON.parse(fs.readFileSync(path.join(base, "openapi.json"), "utf8"));
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const operations = [];
for (const [route, item] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!methods.has(method)) continue;
    operations.push({ route, method: method.toUpperCase(), tag: (operation.tags || ["Divers"])[0], summary: operation.summary || "" });
  }
}
operations.sort((a, b) => a.tag.localeCompare(b.tag, "fr") || a.route.localeCompare(b.route, "fr") || a.method.localeCompare(b.method));
const progress = {
  "GET /chats/search": ["Implémentée", "Tests simulés ; appareil et serveur à vérifier"],
  "GET /chats/{chatId}/stream": ["Implémentée", "Reprise SSE simulée ; appareil à vérifier"],
  "POST /filesv2": ["Implémentée", "Multipart simulé ; appareil et serveur à vérifier"],
  "GET /filesv2": ["Implémentée", "Pagination simulée ; serveur à vérifier"],
  "DELETE /filesv2/{file_id}": ["Implémentée", "Suppression simulée ; serveur à vérifier"],
  "GET /filesv2/usage": ["Implémentée", "Affichage simulé ; serveur à vérifier"],
  "GET /filesv2/supported-mime-types": ["Implémentée", "Filtrage simulé ; serveur à vérifier"],
  "POST /skills": ["Implémentée", "Multipart simulé ; appareil et serveur à vérifier"]
};
for (const key of Object.keys(progress)) {
  if (!operations.some(operation => `${operation.method} ${operation.route}` === key)) throw new Error(`Opération absente de l'OpenAPI : ${key}`);
}
const escape = value => String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const lines = [
  "# Suivi des opérations OpenAPI",
  "",
  `Inventaire généré : ${operations.length} opérations, ${Object.keys(spec.paths).length} chemins, ${Object.keys(spec.components.schemas || {}).length} schémas.`,
  "",
  "Le statut « À adapter » indique un travail ou une validation restant à faire, sans présumer que la fonction est absente. « Implémentée » indique un portage partiel ; les tests simulés ne prouvent pas la compatibilité sur appareil ou serveur. Aucune fonction n'est déclarée entièrement testée tant que ces validations manquent. Les permissions fines sont à vérifier avec un compte de test autorisé.",
  "",
  "| Domaine | Méthode et chemin | Fonction documentée | Statut | Validation |",
  "| --- | --- | --- | --- | --- |",
  ...operations.map(o => {
    const [status, validation] = progress[`${o.method} ${o.route}`] || ["À adapter", "Non testée"];
    return `| ${escape(o.tag)} | \`${o.method} ${escape(o.route)}\` | ${escape(o.summary)} | ${status} | ${validation} |`;
  }),
  ""
];
fs.writeFileSync(path.join(base, "operations.md"), lines.join("\n"));
