import assert from "node:assert/strict";
import { createNativeReadAloud, createReadAloud, speechText } from "./src/lib/services/read-aloud.ts";

const fence = String.fromCharCode(96).repeat(3);
assert.equal(speechText("# Titre\nVoici [la source](https://example.org)\n\n" + fence + "js\nalert()\n" + fence),
  "Titre\nVoici la source");
const queue = [], states = [];
let cancelled = 0, errors = 0;
const player = createReadAloud({ speak: item => queue.push(item), cancel: () => { cancelled++; } },
  text => ({ text }), index => states.push(index), () => { errors++; }, "fr-FR");
player.play(0, "Un mot ".repeat(90));
assert.equal(queue[0].lang, "fr-FR");
assert.ok(queue[0].text.length <= 220);
queue[0].onend();
assert.equal(queue.length, 2);
const stale = queue[1];
player.play(1, "Nouvelle réponse");
stale.onend();
stale.onerror();
assert.equal(queue.length, 3);
assert.deepEqual(states, [0, null, 1]);
assert.equal(cancelled, 1);
assert.equal(errors, 0);
queue[2].onend();
assert.equal(states.at(-1), null);
player.play(2, "Message interrompu");
player.play(2, "Message interrompu");
assert.equal(states.at(-1), null);
player.play(3, "Erreur");
queue.at(-1).onerror();
assert.equal(errors, 1);
assert.equal(states.at(-1), null);
const nativeEvents = [], nativeStates = [];
let nativeErrors = 0;
const nativePlayer = createNativeReadAloud({
  start(sequence, text, language) {
    return new Promise((resolve, reject) => nativeEvents.push({ sequence, text, language, resolve, reject }));
  },
  async stop(sequence) { nativeEvents.push({ sequence }); }
}, index => nativeStates.push(index), () => { nativeErrors++; }, "fr-FR");

nativePlayer.play(4, "**Lecture**");
assert.equal(nativeEvents[0].text, "Lecture");
assert.equal(nativeEvents[0].language, "fr-FR");
nativePlayer.play(5, "Remplacement");
assert.ok(nativeEvents[0].sequence < nativeEvents[1].sequence && nativeEvents[1].sequence < nativeEvents[2].sequence);
nativeEvents[0].reject(new Error("Réponse périmée"));
await Promise.resolve();
assert.deepEqual(nativeStates, [4, null, 5]);
assert.equal(nativeErrors, 0);
nativeEvents[2].resolve();
await Promise.resolve();
assert.equal(nativeStates.at(-1), null);
nativePlayer.play(6, "Lecture à interrompre");
nativePlayer.play(6, "Lecture à interrompre");
assert.ok(nativeEvents[3].sequence < nativeEvents[4].sequence);
nativeEvents[3].resolve();
await Promise.resolve();
assert.equal(nativeStates.at(-1), null);
nativePlayer.play(7, "Audio indisponible");
nativeEvents[5].reject(new Error("Audio indisponible"));
await Promise.resolve();
assert.equal(nativeStates.at(-1), null);
assert.equal(nativeErrors, 1);
console.log("Lecture vocale Web et native : texte, arrêt, remplacement, fin et erreurs vérifiés.");
