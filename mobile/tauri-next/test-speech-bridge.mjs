import assert from "node:assert/strict";
import { createSpeechAdapter } from "./speech-bridge.mjs";

const calls = [], listeners = new Map(), unregistered = [];
let failEvent;
const adapter = createSpeechAdapter(async (command, args) => {
  calls.push({ command, args });
  if (command.endsWith("is_available")) return { available: true };
  if (command.endsWith("check_permission")) return { microphone: "granted", speechRecognition: "granted" };
}, async (plugin, event, handler) => {
  assert.equal(plugin, "stt");
  if (event === failEvent) throw Error("listener failed");
  listeners.set(event, handler);
  return { async unregister() { unregistered.push(event); listeners.delete(event); } };
});
assert.equal((await adapter.available()).available, true);
assert.equal((await adapter.checkPermissions()).speechRecognition, "granted");
let transcript, status, reason;
await adapter.addListener("partialResults", result => { transcript = result.matches[0]; });
await adapter.addListener("listeningState", result => { status = result.status; reason = result.error; });
await adapter.start({ language: "fr-FR" });
assert.equal(calls.at(-1).args.config.language, "fr-FR");
assert.equal(calls.at(-1).args.config.continuous, false);
listeners.get("result")({ transcript: "Bonjour", isFinal: false });
listeners.get("stateChange")({ state: "idle" });
assert.equal(transcript, "Bonjour"); assert.equal(status, "stopped");
listeners.get("error")({ message: "interruption" });
assert.equal(reason, "interruption");
const stale = listeners.get("result");
await adapter.removeAllListeners();
stale({ transcript: "stale" });
assert.equal(transcript, "Bonjour");
assert.deepEqual(unregistered.sort(), ["error", "result", "stateChange"]);
failEvent = "error";
await assert.rejects(adapter.addListener("listeningState", () => {}), /listener failed/);
assert.equal(listeners.size, 0);
await adapter.stop();
assert.equal(calls.at(-1).command, "plugin:stt|stop_listening");
console.log("Dictée : permissions, événements, erreurs et désinscriptions vérifiés.");

// Exécute l'adaptation du composeur sans navigateur ni microphone.
const { readFile } = await import("node:fs/promises");
const vm = await import("node:vm");
const source = await readFile(new URL("./legacy-speech.js", import.meta.url), "utf8");
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function environment(plugin) {
  const handlers = {}, alerts = [], states = [], prompt = { value: "Texte" };
  const ctx = { window: { parent: { __franceStudentSpeech: plugin } }, document: { visibilityState: "visible", addEventListener: (name, handler) => { handlers[name] = handler; } }, nativeDictation: null,
    nativeSpeechPlugin() {}, startNativeDictation() {},
    async stopNativeDictation() { const session = ctx.nativeDictation; if (!session) return; ctx.nativeDictation = null; ctx.setMicState(false); await session.plugin.removeAllListeners(); await session.plugin.stop(); },
    $: () => prompt, setMicState: state => states.push(state), resizePrompt() {}, updateSendButton() {}, alert: message => alerts.push(message) };
  vm.runInNewContext(source, ctx);
  return { ctx, handlers, alerts, states, prompt };
}
function mockPlugin() {
  const events = new Map(); let starts = 0, stops = 0, removes = 0;
  return { events, get starts() { return starts; }, get stops() { return stops; }, get removes() { return removes; },
    async available() { return { available: true }; },
    async checkPermissions() { return { microphone: "granted", speechRecognition: "granted" }; },
    async requestPermissions() { return { microphone: "granted", speechRecognition: "granted" }; },
    async removeAllListeners() { removes++; events.clear(); },
    async addListener(name, callback) { events.set(name, callback); },
    async start() { starts++; }, async stop() { stops++; } };
}
{
  const plugin = mockPlugin(), permission = deferred();
  plugin.checkPermissions = () => permission.promise;
  const { ctx, handlers, states } = environment(plugin);
  const starting = ctx.startNativeDictation(plugin);
  await Promise.resolve(); await Promise.resolve();
  ctx.document.visibilityState = "hidden"; handlers.visibilitychange();
  permission.resolve({ microphone: "granted", speechRecognition: "granted" });
  await starting;
  assert.equal(plugin.starts, 0); assert.equal(ctx.nativeDictation, null); assert.equal(states.at(-1), false);
}
{
  const plugin = mockPlugin(), started = deferred();
  plugin.start = async () => { await started.promise; };
  const { ctx, handlers } = environment(plugin);
  const starting = ctx.startNativeDictation(plugin);
  for (let i = 0; i < 15; i++) await Promise.resolve();
  ctx.document.visibilityState = "hidden"; handlers.visibilitychange();
  started.resolve(); await starting;
  assert.equal(ctx.nativeDictation, null); assert(plugin.stops >= 1); assert.equal(plugin.events.size, 0);
}
{
  const plugin = mockPlugin();
  plugin.checkPermissions = async () => ({ microphone: "denied", speechRecognition: "granted" });
  plugin.requestPermissions = async () => ({ microphone: "denied", speechRecognition: "granted" });
  const { ctx, alerts } = environment(plugin);
  await ctx.startNativeDictation(plugin);
  assert.equal(plugin.starts, 0); assert.match(alerts[0], /refusé/);
}
{
  const plugin = mockPlugin();
  const { ctx, alerts, states } = environment(plugin);
  await ctx.startNativeDictation(plugin);
  plugin.events.get("listeningState")({ status: "stopped", error: "réseau" });
  assert.equal(ctx.nativeDictation, null); assert.equal(states.at(-1), false); assert.match(alerts[0], /réseau/);
}
{
  const plugin = mockPlugin(); plugin.start = async () => { throw Error("démarrage"); };
  const { ctx, alerts } = environment(plugin);
  await ctx.startNativeDictation(plugin);
  assert.equal(plugin.events.size, 0); assert.equal(ctx.nativeDictation, null); assert.match(alerts[0], /démarrage/);
}
console.log("Dictée : arrière-plan, refus, interruption et échec simulés vérifiés.");
