import { readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Operates only on a separate staging copy of the old mobile directory.
// The compile-time switch is intentionally not defined by this installer.
export async function installIosBridge(mobileDirectory) {
  const sourceMobile = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const targetMobile = await realpath(mobileDirectory);
  if (targetMobile === sourceMobile) throw new Error("Utiliser une copie de préparation, jamais l'application source.");
  const projectPath = join(targetMobile, "ios/App/App.xcodeproj/project.pbxproj");
  const controllerPath = join(targetMobile, "ios/App/App/FranceStudentViewController.swift");
  const pluginPath = join(targetMobile, "ios/App/App/MigrationExportPlugin.swift");
  const [project, controller, plugin] = await Promise.all([
    readFile(projectPath, "utf8"), readFile(controllerPath, "utf8"),
    readFile(new URL("./MigrationExportPlugin.swift", import.meta.url), "utf8")
  ]);
  function insert(text, needle, addition) {
    const first = text.indexOf(needle);
    if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) throw new Error("Projet iOS inattendu ; aucun fichier modifié.");
    return text.slice(0, first + needle.length) + addition + text.slice(first + needle.length);
  }
  if (project.includes("MigrationExportPlugin.swift") || controller.includes("MigrationExportPlugin") || /E82D71C181C34D829F0CE10[12]/.test(project)) throw new Error("Pont déjà présent ou installation partielle ; vérifier la copie.");
  let next = insert(project, "/* Begin PBXBuildFile section */", '\n\t\tE82D71C181C34D829F0CE101 /* MigrationExportPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = E82D71C181C34D829F0CE102 /* MigrationExportPlugin.swift */; };');
  next = insert(next, "/* Begin PBXFileReference section */", '\n\t\tE82D71C181C34D829F0CE102 /* MigrationExportPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = MigrationExportPlugin.swift; sourceTree = "<group>"; };');
  next = insert(next, "BA830F859AD74389A174A302 /* ChatStreamPlugin.swift */,", '\n\t\t\t\tE82D71C181C34D829F0CE102 /* MigrationExportPlugin.swift */,');
  next = insert(next, "BA830F859AD74389A174A301 /* ChatStreamPlugin.swift in Sources */,", '\n\t\t\t\tE82D71C181C34D829F0CE101 /* MigrationExportPlugin.swift in Sources */,');
  const nextController = insert(controller, "bridge?.registerPluginInstance(ChatStreamPlugin())", '\n        #if FS_MIGRATION_EXPORT\n        bridge?.registerPluginInstance(MigrationExportPlugin())\n        #endif');
  // Exclusive creation prevents clobbering an existing file. If a subsequent
  // write fails the staging copy must be discarded and recreated.
  await writeFile(pluginPath, plugin, { flag: "wx" });
  await writeFile(projectPath, next);
  await writeFile(controllerPath, nextController);
}
