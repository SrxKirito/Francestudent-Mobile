// Compare le balisage rendu par les composants Svelte (rendu serveur via Vite) à celui de mobile/www/index.html.
// Ce test vérifie la structure (balises, id, classes, attributs, textes) : il ne dit RIEN du rendu visuel sur appareil.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { tokens } from "./test-markup-tokens.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const legacyHtml = fs.readFileSync(path.join(here, "..", "www", "index.html"), "utf8");

let count = 0;
function test(name, fn) {
  try {
    fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
}

function between(start, end) {
  const from = legacyHtml.indexOf(start);
  assert.ok(from >= 0, `introuvable dans index.html : ${start}`);
  const to = legacyHtml.indexOf(end, from);
  assert.ok(to > from, `fin introuvable : ${end}`);
  return legacyHtml.slice(from, to + end.length);
}

const server = await createServer({
  root: here,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null }
});

try {
  const { render } = await server.ssrLoadModule("svelte/server");
  const Startup = (await server.ssrLoadModule("/src/components/Startup.svelte")).default;
  const Login = (await server.ssrLoadModule("/src/components/Login.svelte")).default;

  const legacyStartup = between('<div id="startup-screen"', "</div>");
  const legacyLogin = between('<section id="login-screen"', "</section>");

  test("écran de démarrage : même balisage que index.html", () => {
    const { body } = render(Startup, {});
    assert.deepEqual(tokens(body), tokens(legacyStartup));
  });

  test("écran de connexion (sans erreur) : même balisage, l'erreur est masquée comme dans index.html", () => {
    const { body } = render(Login, { props: { session: { error: "", busy: "" } } });
    // Dans index.html toute la section commence masquée (la classe est retirée au besoin) : on compare hors `hidden`.
    assert.deepEqual(tokens(body, { ignoreClasses: ["hidden"] }), tokens(legacyLogin, { ignoreClasses: ["hidden"] }));
    assert.match(body, /id="login-error"[^>]*class="[^"]*\bhidden\b/, "le message d'erreur doit être masqué sans erreur");
    assert.doesNotMatch(body, /id="login-screen"[^>]*class="[^"]*\bhidden\b/, "l'écran de connexion doit être visible");
  });

  test("écran de connexion : message d'erreur visible et texte affiché", () => {
    const { body } = render(Login, { props: { session: { error: "Session refusée", busy: "" } } });
    assert.match(body, /<p id="login-error" class="error">Session refusée<\/p>/);
  });

  test("écran de connexion : bouton en attente désactivé avec le libellé « Connexion… »", () => {
    const password = render(Login, { props: { session: { error: "", busy: "password" } } }).body;
    assert.match(password, /<button[^>]*id="login-button"[^>]*disabled[^>]*>Connexion…<\/button>/);
    assert.match(password, /<button[^>]*id="cookie-button"[^>]*>Utiliser ce cookie<\/button>/);
    assert.doesNotMatch(password, /id="cookie-button"[^>]*disabled/);
    const cookie = render(Login, { props: { session: { error: "", busy: "cookie" } } }).body;
    assert.match(cookie, /<button[^>]*id="cookie-button"[^>]*disabled[^>]*>Connexion…<\/button>/);
    assert.match(cookie, /<button[^>]*id="login-button"[^>]*>Se connecter<\/button>/);
  });
} finally {
  await server.close();
}

console.log(`test-svelte-markup : ${count} tests réussis`);
