"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
class Node {
  constructor() { this.children = []; this.textContent = ""; this.value = ""; this.disabled = false; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren() { this.children = []; }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
}
async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/api-audit/openapi.json"), "utf8"));
  assert.ok(spec.paths["/projects/{projectId}/shares"].get);
  assert.ok(spec.paths["/projects/{projectId}/shares"].post);
  assert.ok(spec.paths["/projects/{projectId}/shares/{targetUserId}"].delete);
  assert.deepEqual(spec.components.schemas.ProjectShareCreateDto.required, ["userEmail"]);
  const id = "11111111-1111-1111-1111-111111111111", calls = [];
  let fail = false;
  const context = vm.createContext({
    openProjectEditor() {}, store: { session: "session" }, document: { createElement: () => new Node() },
    confirm: () => true, encodeURIComponent, Number, Object, String,
    async settingsApi(route, options = {}) {
      calls.push([route, options]);
      if (fail) throw new Error("HTTP 403");
      if (!options.method) return [{ userId: 1, userEmail: "owner@example.test", owner: true }, { userId: 2, userEmail: "guest@example.test", owner: false, permission: "View" }];
      return {};
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "project-shares.js"), "utf8"), context);
  Object.assign(context, { list: new Node(), status: new Node(), input: new Node(), submit: new Node(), id });
  vm.runInContext("Object.assign(projectSharesState, { projectId: id, list, status, input, submit })", context);
  await context.refreshProjectShares();
  assert.equal(context.list.children.length, 2);
  assert.equal(context.list.children[0].children.length, 1, "le propriétaire n'est pas retirable");
  assert.match(context.list.children[1].children[0].textContent, /Lecture/);
  context.input.value = "new@example.test";
  await context.createProjectShare();
  const post = calls.find(([route, options]) => route.endsWith("/shares") && options.method === "POST");
  assert.deepEqual(JSON.parse(post[1].body), { userEmail: "new@example.test" });
  await context.list.children[1].children[1].onclick();
  assert.ok(calls.some(([route, options]) => route.endsWith("/shares/2") && options.method === "DELETE"));
  assert.equal(context.list.children.length, 1);
  fail = true;
  await context.refreshProjectShares();
  assert.match(context.status.textContent, /HTTP 403/);
  assert.throws(() => context.shareProjectRoute("../other"), /invalide/);
}
main().then(() => console.log("Partage de projet : contrats, propriétaires, suppression et erreurs vérifiés.")).catch(error => { console.error(error); process.exitCode = 1; });
