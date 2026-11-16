"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  let input;
  const context = vm.createContext({
    nativeHttp: null,
    tauriTransport: { async login(value) { input = value; return { status: 302, headers: { "set-cookie": ["test=value"] }, data: "" }; } }
  });
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "legacy-login.js"), "utf8"), context);
  const result = await context.nativeHttp().request({ url: "https://my.francestudent.org/login", method: "POST", data: "test=value", headers: { "Content-Type": "application/x-www-form-urlencoded" }, disableRedirects: true });
  assert.equal(input.url, "https://my.francestudent.org/login");
  assert.equal(input.method, "POST");
  assert.equal(input.data, "test=value");
  assert.equal(result.status, 302);
  assert.equal(result.headers["set-cookie"][0], "test=value");
}
main().then(() => console.log("Connexion : pont natif vérifié.")).catch(error => { console.error(error); process.exitCode = 1; });
