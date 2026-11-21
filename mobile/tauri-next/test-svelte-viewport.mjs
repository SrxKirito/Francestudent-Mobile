import assert from "node:assert/strict";
import fs from "node:fs";
import { viewportGeometry } from "./src/lib/utils/viewport.ts";

assert.deepEqual(viewportGeometry(852, 852, 0, 852, false), { height: 852, top: 0, keyboard: false });
assert.deepEqual(viewportGeometry(852, 510, 25, 852, true), { height: 510, top: 25, keyboard: true });
assert.deepEqual(viewportGeometry(510, 510, 0, 852, true), { height: 510, top: 0, keyboard: true });
assert.deepEqual(viewportGeometry(852, 852, 0, 852, true), { height: 852, top: 0, keyboard: false });
assert.equal(JSON.parse(fs.readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url))).app.windows[0].disableInputAccessoryView, true);
console.log("Viewport : ouverture, redimensionnement natif, fermeture et configuration de l’accessoire.");
