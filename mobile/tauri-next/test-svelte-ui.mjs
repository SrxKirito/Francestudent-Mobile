// Tests de la logique de l'interface Svelte qui ne dépend pas du DOM : choix d'interface, formulaires de connexion,
// ordre des feuilles de style historiques.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { submitCookie, submitPassword } from "./src/lib/services/login-actions.ts";
import { uiMode, chatMode, UI_FLAG_KEY, CHAT_FLAG_KEY } from "./src/lib/utils/ui-flag.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

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


// --- choix de l'interface ------------------------------------------------------
await test("Svelte 5 est l'interface par défaut", () => {
  assert.equal(uiMode("", null), "svelte");
  assert.equal(uiMode("?autre=1", ""), "svelte");
  assert.equal(uiMode("", "n'importe quoi"), "svelte");
  assert.equal(UI_FLAG_KEY, "fs-ui");
});

await test("l'interface Svelte est activée par défaut et legacy reste accessible", () => {
  assert.equal(uiMode("?ui=svelte", null), "svelte");
  assert.equal(uiMode("", "svelte"), "svelte");
  assert.equal(uiMode("", "legacy"), "legacy");
  assert.equal(uiMode("?ui=legacy", "svelte"), "legacy");
  assert.equal(uiMode("?ui=svelte", "legacy"), "svelte");
  assert.equal(uiMode("?ui=inconnu", "svelte"), "svelte");
  assert.equal(uiMode("?x=1&ui=svelte", null), "svelte");
});

// --- sous-drapeau du chat ------------------------------------------------------
await test("le chat Svelte 5 est activé par défaut", () => {
  assert.equal(chatMode("", null), "svelte");
  assert.equal(chatMode("?ui=svelte", null), "svelte");
  assert.equal(chatMode("", "n'importe quoi"), "svelte");
  assert.equal(CHAT_FLAG_KEY, "fs-chat");
});

await test("le chat Svelte est activé par défaut et legacy reste accessible", () => {
  assert.equal(chatMode("?ui=svelte&chat=svelte", null), "svelte");
  assert.equal(chatMode("", "svelte"), "svelte");
  assert.equal(chatMode("", "legacy"), "legacy");
  assert.equal(chatMode("?chat=legacy", "svelte"), "legacy");
  assert.equal(chatMode("?chat=svelte", "legacy"), "svelte");
  assert.equal(chatMode("?chat=inconnu", "svelte"), "svelte");
});

// --- formulaires de connexion --------------------------------------------------
function view() {
  return { error: "", busy: "" };
}

function fakeFlow({ password, cookie } = {}) {
  const calls = { password: [], cookie: [] };
  return {
    calls,
    loginWithPassword: async (email, pw) => {
      calls.password.push([email, pw]);
      if (password) await password();
    },
    loginWithCookie: async raw => {
      calls.cookie.push(raw);
      return cookie ? cookie() : true;
    }
  };
}

await test("mot de passe : e-mail nettoyé, mot de passe transmis tel quel", async () => {
  const flow = fakeFlow();
  const v = view();
  assert.equal(await submitPassword(flow, v, "  a@b.fr \n", "  secret  "), true);
  assert.deepEqual(flow.calls.password, [["a@b.fr", "  secret  "]]);
  assert.deepEqual(v, { error: "", busy: "" });
});

await test("mot de passe : champs vides → rien n'est tenté", async () => {
  const flow = fakeFlow();
  const v = view();
  assert.equal(await submitPassword(flow, v, "   ", "x"), false);
  assert.equal(await submitPassword(flow, v, "a@b.fr", ""), false);
  assert.equal(flow.calls.password.length, 0);
  assert.deepEqual(v, { error: "", busy: "" });
});

await test("mot de passe : l'erreur est affichée (chaîne Rust ou Error) et le bouton se libère", async () => {
  for (const failure of ["HTTP 500", new Error("Identifiants incorrects")]) {
    const v = view();
    const flow = fakeFlow({ password: async () => { throw failure; } });
    assert.equal(await submitPassword(flow, v, "a@b.fr", "x"), false);
    assert.equal(v.error, typeof failure === "string" ? failure : failure.message);
    assert.equal(v.busy, "");
  }
});

await test("mot de passe : bouton en attente pendant la connexion, ancienne erreur effacée, pas de double envoi", async () => {
  let release;
  const flow = fakeFlow({ password: () => new Promise(resolve => { release = resolve; }) });
  const v = { error: "ancienne erreur", busy: "" };
  const first = submitPassword(flow, v, "a@b.fr", "x");
  assert.equal(v.busy, "password");
  assert.equal(v.error, "");
  assert.equal(await submitPassword(flow, v, "a@b.fr", "x"), false, "second envoi ignoré");
  assert.equal(await submitCookie(flow, v, "abc"), false, "l'autre formulaire est bloqué aussi");
  release();
  assert.equal(await first, true);
  assert.equal(v.busy, "");
  assert.equal(flow.calls.password.length, 1);
  assert.equal(flow.calls.cookie.length, 0);
});

await test("cookie : succès, cookie vide (false), erreur affichée", async () => {
  const ok = fakeFlow();
  assert.equal(await submitCookie(ok, view(), " abc "), true);
  assert.deepEqual(ok.calls.cookie, [" abc "]);

  const empty = view();
  assert.equal(await submitCookie(fakeFlow({ cookie: () => false }), empty, '""'), false);
  assert.deepEqual(empty, { error: "", busy: "" });

  const failed = view();
  const flow = fakeFlow({ cookie: () => { throw new Error("Session refusée ou expirée : reconnecte-toi."); } });
  assert.equal(await submitCookie(flow, failed, "abc"), false);
  assert.equal(failed.error, "Session refusée ou expirée : reconnecte-toi.");
  assert.equal(failed.busy, "");
});

// --- feuilles de style ---------------------------------------------------------
const EXCLUDED = ["ide-link.css", "katex/katex.min.css"];

await test("les feuilles chargées par Svelte suivent l'ordre de mobile/www/index.html (hors exclusions assumées)", () => {
  const html = fs.readFileSync(path.join(here, "..", "www", "index.html"), "utf8");
  const expected = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]).filter(href => !EXCLUDED.includes(href));
  const module = fs.readFileSync(path.join(here, "src", "styles", "legacy.ts"), "utf8");
  const actual = [...module.matchAll(/^import "\.\.\/\.\.\/\.\.\/www\/([^"]+)";$/gm)].map(m => m[1]);
  assert.ok(expected.length >= 16, "index.html : feuilles introuvables");
  assert.deepEqual(actual, expected);
  for (const file of actual) assert.ok(fs.existsSync(path.join(here, "..", "www", file)), file);
});

await test("les feuilles Svelte ne sont importées que paresseusement (le chemin iframe n'en dépend pas)", () => {
  for (const file of ["src/main.ts", "src/App.svelte", "src/components/Shell.svelte"]) {
    const source = fs.readFileSync(path.join(here, file), "utf8");
    assert.ok(!/^\s*import\s+["'][^"']*styles\/legacy/m.test(source), `${file} importe les styles statiquement`);
  }
  const shell = fs.readFileSync(path.join(here, "src/components/Shell.svelte"), "utf8");
  assert.match(shell, /import\("\.\.\/styles\/native-shell\.ts"\)/);
  const styles = fs.readFileSync(path.join(here, "src/styles/native-shell.ts"), "utf8");
  assert.match(styles, /import "\.\/legacy\.ts"/);
});

await test("feuille des fenêtres : zones sûres latérales, champs 16 px au tactile, chargée après les feuilles historiques", () => {
  const css = fs.readFileSync(path.join(here, "src", "styles", "dialogs.css"), "utf8");
  assert.match(css, /\.settings-dialog[^{]*\{[^}]*env\(safe-area-inset-left\)/);
  assert.match(css, /\.settings-dialog[^{]*\{[^}]*env\(safe-area-inset-right\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /pointer:\s*coarse[\s\S]*font-size:\s*16px/);
  assert.match(css, /100dvh/);
  const styles = fs.readFileSync(path.join(here, "src/styles/native-shell.ts"), "utf8");
  assert.match(styles, /import "\.\/legacy\.ts";\s*import "\.\/dialogs\.css";/);
});

console.log(`test-svelte-ui : ${count} tests réussis`);