import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { transitionBuildNumber } from "./check-transition-version.mjs";

const tags = ["ios-1.1.30", "ios-1.1.32", "ios-1.1.9", "tauri-ios-preview", "autre"];
assert.equal(transitionBuildNumber("1.1.33", tags), 33);
assert.equal(transitionBuildNumber("1.2.0", tags), 0);
assert.throws(() => transitionBuildNumber("1.1.32", tags), /n'est pas supérieure à ios-1\.1\.32/);
assert.throws(() => transitionBuildNumber("1.1.10", tags), /n'est pas supérieure/, "comparaison numérique, pas alphabétique");
assert.throws(() => transitionBuildNumber("1.1", tags), /Version invalide/);
assert.throws(() => transitionBuildNumber("1.1.40; rm -rf /", tags), /Version invalide/);
assert.throws(() => transitionBuildNumber("1.1.40", ["tauri-ios-preview"]), /Aucune version/);
assert.throws(() => transitionBuildNumber("1.1.40", undefined), /indisponible/);

// Utilisation en ligne de commande, comme dans le workflow.
assert.equal(execFileSync("node", ["migration/check-transition-version.mjs", "1.1.40", "ios-1.1.39\nios-1.1.38"], { encoding: "utf8" }).trim(), "40");
assert.throws(() => execFileSync("node", ["migration/check-transition-version.mjs", "1.1.38", "ios-1.1.39"], { stdio: "pipe" }));
console.log("Version de transition : ordre numérique, refus des versions invalides ou non supérieures vérifiés.");
