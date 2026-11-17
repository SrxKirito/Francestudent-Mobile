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
  "GET /locked-chats": ["Implémentée", "Module locked-chats et test unitaire écrits"],
  "DELETE /locked-chats/access": ["Implémentée", "Fermeture d'accès locale et serveur"],
  "POST /locked-chats/access": ["Implémentée", "Ouverture d'accès avec code PIN"],
  "DELETE /locked-chats/chats/{chatId}": ["Implémentée", "Déverrouillage de chat"],
  "PUT /locked-chats/chats/{chatId}": ["Implémentée", "Verrouillage de chat"],
  "DELETE /locked-chats/pin": ["Implémentée", "Suppression du code PIN avec réinitialisation"],
  "POST /locked-chats/pin": ["Implémentée", "Création de code PIN"],
  "PUT /locked-chats/pin": ["Implémentée", "Changement de code PIN"],
  "GET /locked-chats/status": ["Implémentée", "Vérification statut PIN et accès"],
  "GET /chats/archived": ["Implémentée", "Liste simulée ; appareil et serveur à vérifier"],
  "PUT /chats/{chatId}/archive": ["Implémentée", "Archivage simulé ; appareil et serveur à vérifier"],
  "PUT /chats/{chatId}/restore": ["Implémentée", "Restauration simulée ; appareil et serveur à vérifier"],
  "GET /projects/{projectId}/shares": ["Implémentée", "Partages simulés ; permissions et serveur à vérifier"],
  "POST /projects/{projectId}/shares": ["Implémentée", "Partage simulé ; permissions et serveur à vérifier"],
  "DELETE /projects/{projectId}/shares/{targetUserId}": ["Implémentée", "Retrait simulé ; permissions et serveur à vérifier"],
  "GET /projects/shared": ["Implémentée", "Permissions et serveur à vérifier"],
  "GET /chats/{chatId}/shares": ["Implémentée", "Permissions et serveur à vérifier"],
  "POST /chats/{chatId}/shares": ["Implémentée", "Permissions et serveur à vérifier"],
  "PATCH /chats/{chatId}/shares": ["Implémentée", "Permissions et serveur à vérifier"],
  "DELETE /chats/{chatId}/shares": ["Implémentée", "Permissions et serveur à vérifier"],
  "PATCH /messages/{messageId}": ["Implémentée", "Synchronisation du vote non testée"],
  "GET /chats/{chatId}/stream": ["Implémentée", "Reprise SSE simulée ; appareil à vérifier"],
  "POST /filesv2": ["Implémentée", "Multipart simulé ; appareil et serveur à vérifier"],
  "GET /filesv2": ["Implémentée", "Pagination simulée ; serveur à vérifier"],
  "DELETE /filesv2/{file_id}": ["Implémentée", "Suppression simulée ; serveur à vérifier"],
  "GET /filesv2/usage": ["Implémentée", "Affichage simulé ; serveur à vérifier"],
  "GET /filesv2/supported-mime-types": ["Implémentée", "Filtrage simulé ; serveur à vérifier"],
  "POST /skills": ["Implémentée", "Multipart simulé ; appareil et serveur à vérifier"],
  "GET /user/@me/saved-messages": ["Implémentée", "Test unitaire et intégration bibliothèque validés"],
  "PUT /user/@me/saved-messages/{chatId}/{messageId}": ["Implémentée", "Action Enregistrer validée"],
  "DELETE /user/@me/saved-messages/{chatId}/{messageId}": ["Implémentée", "Suppression depuis bibliothèque validée"],
  "GET /chats": ["Implémentée", "Synchronisation des conversations par date"],
  "GET /chats/{chatId}": ["Implémentée", "Détail de conversation et chargement différé"],
  "PATCH /chats/{chatId}": ["Implémentée", "Renommage synchronisé"],
  "DELETE /chats/{chatId}": ["Implémentée", "Suppression synchronisée"],
  "PUT /chats/{chatId}/pins": ["Implémentée", "Épinglage synchronisé"],
  "DELETE /chats/{chatId}/pins": ["Implémentée", "Désépinglage synchronisé"]
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
