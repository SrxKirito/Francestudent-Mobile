// Tests du rendu Markdown typé (src/lib/services/markdown.ts).
// Référence : le VRAI mobile/www/js/render.js, exécuté dans un contexte vm. Chaque échantillon doit produire exactement
// le même HTML (avec et sans KaTeX, en flux ou non). Aucun accès réseau, aucun navigateur.
// Limite : valide la logique sous Node ; l'affichage réel (CSS, KaTeX réel) est vérifié par `npm run verify:browser`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  escapeHtml,
  fileIconSvg,
  fileNameFromCode,
  guessFileName,
  highlightCode,
  renderMarkdown
} from "./src/lib/services/markdown.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const legacySource = fs.readFileSync(path.join(here, "..", "www", "js", "render.js"), "utf8");

const katexStub = { renderToString: (tex, options) => `<span class="katex-stub" data-display="${options.displayMode}">${tex}</span>` };
const katexThrowing = { renderToString() { throw new Error("KaTeX indisponible"); } };

/** Exécute render.js tel quel ; `katex` est lu par l'original via window.katex, comme en production. */
function legacy(katex) {
  const context = vm.createContext({ window: katex === undefined ? {} : { katex }, console });
  vm.runInContext(
    legacySource + "\n;this.__api = { renderMarkdown, highlightCode, escapeHtml, fileIconSvg, fileNameFromCode, guessFileName };",
    context
  );
  return context.__api;
}

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

const SAMPLES = {
  "paragraphes et sauts de ligne": "Bonjour\nle monde\n\nDeuxième paragraphe",
  "titres 1 à 6": "# Un\n## Deux ##\n### Trois\n#### Quatre\n##### Cinq\n###### Six\n####### sept",
  "gras, italique, barré, code en ligne": "**gras** __gras2__ *ital* ~~barré~~ `code <b>`\net a*b*c",
  "liens http(s) uniquement": "[ok](https://exemple.fr/a?b=1) [non](javascript:alert(1)) [ftp](ftp://x.fr)",
  "échappement HTML": "<script>alert(1)</script> & \"guillemets\" <img src=x onerror=alert(1)>",
  "listes à puces et numérotées": "- a\n- b\n  suite de b\n* c\n+ d\n\n3. trois\n4. quatre\n1) un",
  "citation imbriquée": "> citation\n> > sous-citation\n> fin\n\nhors citation",
  "règle horizontale": "avant\n\n---\n\n***\n\n_ _ _\n\naprès",
  "tableau avec alignements": "| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| *x* | `y` |\n\nfin",
  "tableau sans pipes de bord": "A | B\n--- | ---\n1 | 2",
  "bloc de code Python": "Voici :\n```python\ndef f(x):\n    # commentaire\n    return \"a\" + str(x) + 'b'  # fin\n```\nSuite",
  "bloc de code JS avec mots-clés": "```js\nconst a = 1.5; // note\nfunction go() { return /* x */ null; }\n/* multi\nligne */\n```",
  "bloc de code HTML": "```html\n<!-- c -->\n<div class=\"a\">x</div>\n```",
  "bloc texte brut": "```text\ndef pas_colore():\n```",
  "bloc non fermé (flux)": "Début\n```python\nprint('x')",
  "fence tilde et plus longue": "~~~sh\necho \"a\"\n~~~\n\n````md\n```\ninterne\n```\n````",
  "fichier nommé en commentaire": "```python\n# exemple.py\nprint(1)\n```",
  "fichier csv": "```csv\n// donnees.csv\na,b\n1,2\n```",
  "fichier pdf": "```pdf\nRapport de stage\n```",
  "fichier pdf nommé": "```pdf\n# rapport.pdf\nTexte\n```",
  "pptx": "```pptx\nTitre\n```",
  "langage inconnu": "```zzz\nx = 1\n```",
  "sans langage": "```\nrien\n```",
  "deux fichiers": "```py\n# a.py\n1\n```\ntexte\n```json\n// b.json\n{}\n```",
  "maths en ligne $…$": "Soit $x^2 + 1$ et le prix 5$ ou 7$.",
  "maths en bloc $$…$$": "$$\\int_0^1 x\\,dx = \\frac12$$",
  "maths \\( \\) et \\[ \\]": "Inline \\(a+b\\) et bloc \\[a^2+b^2=c^2\\]",
  "maths multi-lignes": "$$\na = b\n$$",
  "maths dans du code ignorées": "`$x$` et ```\n$$y$$\n```",
  "dollar échappé": "Coût \\$5 et $a$",
  "maths vides": "$$ $$ et \\( \\)",
  "CRLF": "a\r\n\r\n- b\r\n- c\r\n",
  "chaîne vide": "",
  "espaces seulement": "   \n  ",
  "nombre en entrée": 42,
  "mélange complet": "# Titre\n\nTexte **fort** avec $E=mc^2$.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```python\n# calc.py\nprint(1)\n```\n\n> note\n\n1. un\n2. deux"
};

for (const [label, katex] of [["sans KaTeX", undefined], ["KaTeX simulé", katexStub], ["KaTeX qui échoue", katexThrowing]]) {
  const reference = legacy(katex);
  for (const [name, input] of Object.entries(SAMPLES)) {
    for (const streaming of [false, true]) {
      test(`${label} · ${name} · streaming=${streaming}`, () => {
 const expected = reference.renderMarkdown(input, streaming);
 const actual = renderMarkdown(input, streaming, { katex: katex ?? null });
 assert.equal(actual, expected);
      });
    }
  }
}

test("l'argument streaming est optionnel (non-streaming par défaut, comme render.js)", () => {
  const input = "```py\n# a.py\n1\n```";
  assert.equal(renderMarkdown(input), legacy().renderMarkdown(input));
  assert.match(renderMarkdown(input), /message-downloads/);
  assert.doesNotMatch(renderMarkdown(input, true), /message-downloads/);
});

test("par défaut, KaTeX est lu sur window.katex au moment du rendu (comme l'original)", () => {
  const before = globalThis.window;
  try {
    globalThis.window = { katex: katexStub };
    assert.equal(renderMarkdown("$x$"), legacy(katexStub).renderMarkdown("$x$"));
    assert.match(renderMarkdown("$x$"), /katex-stub/);
    globalThis.window = {};
    assert.equal(renderMarkdown("$x$"), legacy().renderMarkdown("$x$"));
  } finally {
    if (before === undefined) delete globalThis.window;
    else globalThis.window = before;
  }
});

test("aucun HTML non échappé ne traverse (XSS) : texte, liens, titres, tableaux, langage de bloc", () => {
  const hostile = [
    "<img src=x onerror=alert(1)>",
    "# <script>x</script>",
    "| <b>a</b> | b |\n|---|---|\n| <i>c</i> | d |",
    "[<img src=x onerror=alert(1)>](https://a.fr)",
    "```<script>\nx\n```",
    "> <svg onload=alert(1)>"
  ];
  for (const input of hostile) {
    const html = renderMarkdown(input, false, { katex: null });
    // Les <svg> des icônes de fichiers sont générés ici ; on cherche donc un gestionnaire d'événement ou une balise hostile.
    assert.doesNotMatch(html, /<(script|img|b|i)[\s>]/i, input);
    assert.doesNotMatch(html, /<[^>]*\son(error|load)=/i, input);
    assert.equal(html, legacy().renderMarkdown(input), input);
  }
});

test("un langage de bloc comme « constructor » ou « __proto__ » ne casse pas le nom de fichier (écart volontaire avec l'original)", () => {
  // L'original lit CODE_EXT["constructor"] (une fonction) et produit « fichier.function Object()… ».
  for (const lang of ["constructor", "__proto__", "toString"]) {
    const html = renderMarkdown("```" + lang + "\nx\n```", false, { katex: null });
    assert.match(html, /data-name="fichier\.txt"/, lang);
  }
});

test("blocs d'étude : hook optionnel, vide par défaut (le rendu interactif est l'étape suivante)", () => {
  const input = "```quiz\n{\"q\":1}\n```";
  assert.equal(renderMarkdown(input, false, { katex: null }), legacy().renderMarkdown(input));
  const html = renderMarkdown(input, false, { katex: null, study: (code, lang, open) => `<div class="study" data-lang="${lang}" data-open="${open}"></div>` });
  assert.match(html, /^<div class="study" data-lang="quiz" data-open="false"><\/div>/);
});

test("nom de fichier PowerPoint : hook optionnel, comme powerPointFileName de l'original", () => {
  const hooked = renderMarkdown("```pptx\nTitre\n```", false, { katex: null, powerPointFileName: () => "cours.pptx" });
  assert.match(hooked, /data-name="cours\.pptx"/);
  assert.match(hooked, /file-only/);
});

test("fonctions utilitaires identiques à l'original", () => {
  const reference = legacy();
  for (const text of ["a&b", "<x>", "\"q\"", "", "é"]) assert.equal(escapeHtml(text), reference.escapeHtml(text));
  for (const [name, kind] of [["a.png"], ["x.pdf"], ["doc", "image"], [undefined], ["archive.tar.gz"]]) assert.equal(fileIconSvg(name, kind), reference.fileIconSvg(name, kind));
  for (const [code, lang] of [["# a.py\nx", "python"], ["x", "pdf"], ["// b.js", "js"], ["x", "zzz"], ["<!-- c.html -->", "html"]]) {
    assert.equal(fileNameFromCode(code, lang), reference.fileNameFromCode(code, lang));
    assert.equal(guessFileName(code, lang), reference.guessFileName(code, lang));
  }
  for (const [code, lang] of [["if x:\n  y = 'a' # c", "py"], ["f(1) // c", "js"], ["a", "txt"], ["\"s\" 12 3.5 foo()", ""]]) {
    assert.equal(highlightCode(code, lang), reference.highlightCode(code, lang));
  }
});

console.log(`test-svelte-markdown : ${count} vérifications réussies`);
