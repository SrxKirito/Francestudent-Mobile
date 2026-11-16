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
const escape = value => String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const lines = [
  "# Suivi des opérations OpenAPI",
  "",
  `Inventaire généré : ${operations.length} opérations, ${Object.keys(spec.paths).length} chemins, ${Object.keys(spec.components.schemas || {}).length} schémas.`,
  "",
  "Le statut initial « À adapter » indique un travail ou une validation restant à faire, sans présumer que la fonction est absente. Une fonction ne passe à « Testée » qu'après validation adaptée. Les permissions fines sont à vérifier dans la description de chaque opération et avec un compte de test autorisé.",
  "",
  "| Domaine | Méthode et chemin | Fonction documentée | Statut | Validation |",
  "| --- | --- | --- | --- | --- |",
  ...operations.map(o => `| ${escape(o.tag)} | \`${o.method} ${escape(o.route)}\` | ${escape(o.summary)} | À adapter | Non testée |`),
  ""
];
fs.writeFileSync(path.join(base, "operations.md"), lines.join("\n"));
