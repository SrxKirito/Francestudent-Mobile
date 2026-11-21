import assert from "node:assert/strict";
import { createReadAloud, speechText } from "./src/lib/services/read-aloud.ts";

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
console.log("Lecture vocale : texte, découpage, arrêt, remplacement et erreurs vérifiés.");
