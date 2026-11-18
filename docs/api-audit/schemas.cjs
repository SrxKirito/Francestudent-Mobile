"use strict";
// Affiche les schémas et chemins de l'instantané OpenAPI correspondant à un motif.
// Usage : node docs/api-audit/schemas.cjs "file|usage|skill"
const spec = require("./openapi.json");
const pattern = new RegExp(process.argv[2] || "file", "i");
const describe = value => {
  if (!value) return "?";
  if (value.$ref) return value.$ref.split("/").pop();
  if (value.type === "array") return "array<" + describe(value.items) + ">";
  return (value.type || "?") + (value.format ? ":" + value.format : "") + (value.enum ? " enum(" + value.enum.join("|") + ")" : "");
};
for (const [name, schema] of Object.entries(spec.components?.schemas || {})) {
  if (!pattern.test(name)) continue;
  const fields = Object.entries(schema.properties || {}).map(([key, prop]) => key + (schema.required?.includes(key) ? "*" : "") + ": " + describe(prop));
  console.log("SCHEMA " + name + " { " + fields.join(", ") + " }");
}
for (const [path, operations] of Object.entries(spec.paths || {})) {
  if (!pattern.test(path)) continue;
  for (const [method, operation] of Object.entries(operations)) {
    if (typeof operation !== "object") continue;
    const ok = operation.responses?.["200"]?.content;
    const media = ok ? Object.entries(ok).map(([type, body]) => type + "=>" + describe(body.schema)).join(" ") : "";
    console.log(method.toUpperCase() + " " + path + "  [" + (operation.operationId || "") + "] " + media);
  }
}
