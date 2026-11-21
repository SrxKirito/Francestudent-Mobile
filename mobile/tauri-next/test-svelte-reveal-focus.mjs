// Fenêtres de réglages sur iOS/Android : le champ qui reçoit le focus doit rester visible quand le clavier s'ouvre.
import assert from "node:assert/strict";

const reveal = await import("./src/lib/utils/reveal-focus.ts");

let count = 0;
async function test(name, fn) {
  try {
    await fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
}

function field(tagName, extra = {}) {
  const calls = [];
  return {
    tagName,
    type: "",
    isContentEditable: false,
    isConnected: true,
    disabled: false,
    readOnly: false,
    scrollIntoView: options => void calls.push(options),
    calls,
    ...extra
  };
}

function harness(active) {
  const timers = [];
  const state = { active: active ?? null };
  const handler = reveal.createFocusReveal({
    delay: 250,
    schedule: (fn, ms) => {
      timers.push({ fn, ms, cancelled: false });
      return timers.length - 1;
    },
    cancel: id => {
      timers[id].cancelled = true;
    },
    activeElement: () => state.active
  });
  const run = () => {
    for (const timer of timers) if (!timer.cancelled) timer.fn();
  };
  return { handler, timers, state, run };
}

await test("champs de saisie reconnus, boutons et cases à cocher ignorés", () => {
  assert.equal(reveal.needsKeyboard(field("INPUT", { type: "text" })), true);
  assert.equal(reveal.needsKeyboard(field("INPUT", { type: "" })), true);
  assert.equal(reveal.needsKeyboard(field("INPUT", { type: "email" })), true);
  assert.equal(reveal.needsKeyboard(field("INPUT", { type: "search" })), true);
  assert.equal(reveal.needsKeyboard(field("TEXTAREA")), true);
  assert.equal(reveal.needsKeyboard(field("SELECT")), true);
  assert.equal(reveal.needsKeyboard(field("DIV", { isContentEditable: true })), true);
  for (const type of ["checkbox", "radio", "button", "submit", "range", "file", "color"]) {
    assert.equal(reveal.needsKeyboard(field("INPUT", { type })), false, type);
  }
  assert.equal(reveal.needsKeyboard(field("BUTTON")), false);
  assert.equal(reveal.needsKeyboard(field("INPUT", { type: "text", readOnly: true })), false);
  assert.equal(reveal.needsKeyboard(field("INPUT", { type: "text", disabled: true })), false);
  assert.equal(reveal.needsKeyboard(null), false);
  assert.equal(reveal.needsKeyboard({}), false);
});

await test("le champ est centré après l'animation du clavier, s'il a toujours le focus", () => {
  const input = field("INPUT", { type: "text" });
  const h = harness(input);
  h.handler({ target: input });
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 250);
  assert.deepEqual(input.calls, []);
  h.run();
  assert.deepEqual(input.calls, [{ block: "center", behavior: "smooth" }]);
});

await test("aucun défilement si le focus est parti, si l'élément est retiré ou s'il ne saisit rien", () => {
  const input = field("INPUT", { type: "text" });
  const h = harness(null);
  h.handler({ target: input });
  h.run();
  assert.deepEqual(input.calls, []);
  const gone = field("TEXTAREA", { isConnected: false });
  const g = harness(gone);
  g.handler({ target: gone });
  g.run();
  assert.deepEqual(gone.calls, []);
  const box = field("INPUT", { type: "checkbox" });
  const b = harness(box);
  b.handler({ target: box });
  assert.equal(b.timers.length, 0);
});

await test("un nouveau focus annule le défilement en attente", () => {
  const first = field("INPUT", { type: "text" });
  const second = field("TEXTAREA");
  const h = harness(second);
  h.handler({ target: first });
  h.handler({ target: second });
  assert.equal(h.timers[0].cancelled, true);
  h.run();
  assert.deepEqual(first.calls, []);
  assert.equal(second.calls.length, 1);
});

await test("la fermeture annule le défilement en attente", () => {
  const input = field("INPUT", { type: "text" });
  const h = harness(input);
  h.handler({ target: input });
  h.handler.dispose();
  h.run();
  assert.deepEqual(input.calls, []);
});

await test("scrollIntoView absent ou en échec : aucune erreur", () => {
  const bare = field("INPUT", { type: "text", scrollIntoView: undefined });
  const a = harness(bare);
  a.handler({ target: bare });
  a.run();
  const failing = field("INPUT", { type: "text", scrollIntoView: () => { throw new Error("refusé"); } });
  const b = harness(failing);
  b.handler({ target: failing });
  b.run();
});

console.log(`${count} vérifications du défilement vers le champ actif`);
