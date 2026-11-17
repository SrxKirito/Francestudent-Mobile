import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installIosBridge } from "./install-ios-bridge.mjs";

const mobile = resolve("..");
const staging = await mkdtemp(join(tmpdir(), "fs-ios-bridge-"));
try {
  await assert.rejects(installIosBridge(mobile), /copie de préparation/);
  await mkdir(join(staging, "ios/App/App.xcodeproj"), { recursive: true });
  await mkdir(join(staging, "ios/App/App"), { recursive: true });
  for (const path of ["ios/App/App.xcodeproj/project.pbxproj", "ios/App/App/FranceStudentViewController.swift"]) await copyFile(join(mobile, path), join(staging, path));
  await installIosBridge(staging);
  const project = await readFile(join(staging, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  const controller = await readFile(join(staging, "ios/App/App/FranceStudentViewController.swift"), "utf8");
  assert.match(project, /MigrationExportPlugin.swift in Sources/);
  assert.match(controller, /#if FS_MIGRATION_EXPORT\s+bridge\?\.registerPluginInstance\(MigrationExportPlugin\(\)\)\s+#endif/);
  assert.doesNotMatch(project, /FS_MIGRATION_EXPORT/);
  assert.match(await readFile(join(staging, "ios/App/App/MigrationExportPlugin.swift"), "utf8"), /class MigrationExportPlugin/);
  await assert.rejects(installIosBridge(staging), /déjà présent/);
  console.log("Pont iOS : installation isolée, inclusion Xcode et enregistrement désactivé vérifiés.");
} finally { await rm(staging, { recursive: true, force: true }); }
