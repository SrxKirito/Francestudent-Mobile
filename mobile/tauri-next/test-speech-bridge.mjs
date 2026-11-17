import assert from "node:assert/strict";
import { createSpeechAdapter } from "./speech-bridge.mjs";

const calls = [], listeners = new Map(), unregistered = [];
const adapter = createSpeechAdapter(async (command, args) => {
  calls.push({ command, args });
  if (command.endsWith("is_available")) return { available: true };
  if (command.endsWith("check_permission")) return { microphone: "granted", speechRecognition: "granted" };
}, async (plugin, event, handler) => {
  assert.equal(plugin, "stt"); listeners.set(event, handler);
  return { async unregister() { unregistered.push(event); listeners.delete(event); } };
});
assert.equal((await adapter.available()).available, true);
assert.equal((await adapter.checkPermissions()).speechRecognition, "granted");
let transcript, status;
await adapter.addListener("partialResults", result => { transcript = result.matches[0]; });
await adapter.addListener("listeningState", result => { status = result.status; });
await adapter.start({ language: "fr-FR" });
assert.equal(calls.at(-1).args.config.language, "fr-FR");
listeners.get("result")({ transcript: "Bonjour", isFinal: false });
listeners.get("stateChange")({ state: "idle" });
assert.equal(transcript, "Bonjour"); assert.equal(status, "stopped");
await adapter.removeAllListeners();
assert.deepEqual(unregistered.sort(), ["result", "stateChange"]);
await adapter.stop();
assert.equal(calls.at(-1).command, "plugin:stt|stop_listening");
console.log("Dictée : adaptation des permissions, résultats et arrêt vérifiée.");
