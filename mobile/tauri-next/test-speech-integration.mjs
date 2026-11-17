import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const capability = JSON.parse(read("./src-tauri/capabilities/ios-speech.json"));
assert.deepEqual(capability.platforms, ["iOS"]);
for (const command of ["is-available", "check-permission", "request-permission", "start-listening", "stop-listening", "register-listener", "remove-listener"]) {
  assert(capability.permissions.includes(`stt:allow-${command}`));
}
const plist = read("./src-tauri/Info.ios.plist");
assert.match(plist, /NSMicrophoneUsageDescription/);
assert.match(plist, /NSSpeechRecognitionUsageDescription/);
const swift = read("./vendor/tauri-plugin-stt/ios/Sources/SttPlugin.swift");
assert.doesNotMatch(swift, /NSLog\([^\n]*(?:transcript|formattedString)/i);
const kotlin = read("./vendor/tauri-plugin-stt/android/src/main/java/SttPlugin.kt");
assert.doesNotMatch(kotlin, /Log\.[diwe]\([^\n]*matches\[0\]/);
console.log("Dictée : permissions iOS et absence de transcription dans les journaux vérifiées.");

