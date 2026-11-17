import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareTransition } from "./prepare-transition.mjs";

const mobile = resolve("..");
const watched = ["www/index.html", "scripts/build-iphone.sh", "ios/App/App/FranceStudentViewController.swift", "ios/App/App.xcodeproj/project.pbxproj"];
const digest = async root => Object.fromEntries(await Promise.all(watched.map(async path => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
const exists = path => stat(path).then(() => true, () => false);
const before = await digest(mobile);
const work = await mkdtemp(join(tmpdir(), "fs-transition-"));
try {
  await assert.rejects(prepareTransition({ output: join(mobile, "copie-interdite") }), /séparé/);
  await assert.rejects(prepareTransition({ output: resolve(mobile, "..") }), /séparé/);
  assert.equal(await exists(join(mobile, "copie-interdite")), false);
  
  const output = join(work, "mobile");
  const result = await prepareTransition({ output });
  assert.equal(result.output, output);
  await assert.rejects(prepareTransition({ output }), /n'est pas vide/);
  
  // La copie exclut les dossiers étrangers à l'ancienne app.
  for (const name of ["tauri-next", "tauri-api", "android-native", "node_modules", "dist"]) assert.equal(await exists(join(output, name)), false, name);
  
  // Scripts classiques : aucune syntaxe de module, et ils fonctionnent avec les globales let/const de l'app.
  const early = await readFile(join(output, "www/js/fs-migration-early.js"), "utf8");
  const late = await readFile(join(output, "www/js/fs-migration-late.js"), "utf8");
  for (const code of [early, late]) assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  class IDBDatabase { constructor() { this.name = "x"; } transaction() { return {}; } }
  class Storage { setItem() {} removeItem() {} clear() {} }
  const context = vm.createContext({ TextEncoder, TextDecoder, Blob, crypto: globalThis.crypto, structuredClone, setTimeout, IDBDatabase, Storage, localStorage: { getItem: () => "{}" }, navigator: { locks: { request: (n, o, callback) => Promise.resolve().then(callback) } }, console });
  context.window = context;
  vm.runInContext(early, context);
  assert.equal(typeof context.__fsMigrationAcquireGuard, "function");
  await assert.rejects(context.__fsMigrationAcquireGuard(), /indisponible/, "avant le chargement de l'app, aucune capture silencieuse");
  vm.runInContext("const store = { conversations: [] };", context);
  const release = await context.__fsMigrationAcquireGuard();
  await release.assertValid();
  await release();
  
  const html = await readFile(join(output, "www/index.html"), "utf8");
  const tag = file => `<script src="js/${file}"></script>`;
  assert.equal(html.split("fs-migration-early.js").length, 2);
  assert.equal(html.split("fs-migration-late.js").length, 2);
  assert.ok(html.indexOf(tag("fs-migration-early.js")) < html.indexOf("<link"), "garde installée avant tout autre élément du head");
  assert.ok(html.indexOf(tag("fs-migration-early.js")) < html.indexOf('src="js/core.js"'));
  assert.match(html, /fs-migration-late\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  assert.ok(html.indexOf("js/ide-link-remembered.js") < html.indexOf("fs-migration-late.js"), "raccordement chargé après les scripts de l'app");
  
  // Pont iOS et drapeau de compilation : présents dans la copie seulement.
  assert.match(await readFile(join(output, "ios/App/App/MigrationExportPlugin.swift"), "utf8"), /verifySingleWebView/);
  assert.match(await readFile(join(output, "ios/App/App/FranceStudentViewController.swift"), "utf8"), /#if FS_MIGRATION_EXPORT/);
  const script = await readFile(join(output, "scripts/build-iphone.sh"), "utf8");
  assert.equal(script.split("FS_MIGRATION_EXPORT").length, 2);
  assert.match(script, /CODE_SIGN_IDENTITY= \\\s+SWIFT_ACTIVE_COMPILATION_CONDITIONS='\$\(inherited\) FS_MIGRATION_EXPORT' \\\s+build/);
  assert.doesNotMatch(await readFile(join(output, "ios/App/App.xcodeproj/project.pbxproj"), "utf8"), /FS_MIGRATION_EXPORT/);
  
  // L'application source n'a pas bougé.
  assert.deepEqual(await digest(mobile), before);
  assert.equal(await exists(join(mobile, "ios/App/App/MigrationExportPlugin.swift")), false);
  assert.equal(await exists(join(mobile, "www/js/fs-migration-early.js")), false);
  console.log("Copie de transition : scripts classiques, injection, pont iOS et source intacte vérifiés.");
} finally { await rm(work, { recursive: true, force: true }); }
