// Compare la barre latérale Svelte (rendu serveur via Vite) à la tranche `<aside id="sidebar">` du vrai index.html legacy,
// et le menu « ⋯ » à `#conv-menu`. Le calcul de position est comparé au VRAI `openConversationMenu` legacy exécuté dans vm.
// Ce test vérifie la structure (balises, classes, attributs, textes) : il ne dit RIEN du rendu visuel sur appareil,
// ni des clics/clavier (aucun navigateur ici), ni de WebKit/iOS.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { tokens } from "./test-markup-tokens.mjs";
import { DAY, NOW, createLegacyHistory } from "./test-legacy-history-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(here, "..", "www");
const indexHtml = fs.readFileSync(path.join(www, "index.html"), "utf8");
const conversationsJs = fs.readFileSync(path.join(www, "js", "conversations.js"), "utf8");

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

function between(source, from, to, fromIndex = 0) {
  const start = source.indexOf(from, fromIndex);
  assert.ok(start >= 0, `introuvable : ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `introuvable : ${to}`);
  return { start, end: end + to.length, text: source.slice(start, end + to.length) };
}

// --- Tranche legacy de la barre latérale, privée de ce que la coque Svelte ne porte pas (documenté dans la matrice) ---
let legacyAside = between(indexHtml, '<aside id="sidebar"', "</aside>").text;
const withIde = legacyAside;
// France IDE est retiré de la préversion Tauri.
legacyAside = legacyAside.replace(/<button id="france-ide-open"[\s\S]*?<\/button>/, "");
assert.notEqual(legacyAside, withIde, "France IDE doit avoir été retiré de la référence");
// Le contenu de #settings-modal (paramètres) reste dans l'iframe : on ne compare que le bouton du compte.
const modalStart = legacyAside.indexOf('<div id="settings-modal"');
const modalEnd = legacyAside.indexOf('<button id="user-button"');
assert.ok(modalStart > 0 && modalEnd > modalStart, "bornes de #settings-modal introuvables");
legacyAside = legacyAside.slice(0, modalStart) + legacyAside.slice(modalEnd);
const legacyHistoryNav = '<nav id="history" class="history" aria-label="Historique"></nav>';
assert.ok(legacyAside.includes(legacyHistoryNav), "nav#history vide attendu dans la référence");

const legacyMenu = between(indexHtml, '<div id="conv-menu"', "</div>").text;

const agents = [
  { id: 1, name: "GPT-5 (rapide)", model: "gpt-5", provider: "OpenAI", description: "", available: true, isDefault: true },
  { id: 2, name: "Claude Sonnet", model: "", provider: "Anthropic", description: "", available: true, isDefault: false }
];
const legacyHistory = createLegacyHistory(agents);
const dataset = [
  { id: "a", title: "Maths", updatedAt: NOW, agentId: 1, messages: [] },
  { id: "b", title: "Épinglée", updatedAt: NOW - 40 * DAY, pinned: true, agentId: 2, messages: [] }
];

const server = await createServer({
  root: here,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null }
});

try {
  const { render } = await server.ssrLoadModule("svelte/server");
  const Sidebar = (await server.ssrLoadModule("/src/components/Sidebar.svelte")).default;
  const ConversationMenu = (await server.ssrLoadModule("/src/components/ConversationMenu.svelte")).default;
  const { PROVIDER_LOGOS } = await server.ssrLoadModule("/src/lib/data/provider-logos.ts");
  const { agentLabel, conversationAgent, providerMark } = await server.ssrLoadModule("/src/lib/utils/agents.ts");
  const { groupHistory, visibleConversations } = await server.ssrLoadModule("/src/lib/utils/history.ts");
  const { menuPosition, pinLabel } = await server.ssrLoadModule("/src/lib/utils/menu.ts");

  const markFor = conversation => {
    const agent = conversationAgent(conversation, agents);
    return { html: providerMark(agent, PROVIDER_LOGOS), label: agentLabel(agent) };
  };
  const noop = () => {};
  const callbacks = {
    onopen: noop, onmenu: noop, onsearch: noop, onhistoryscroll: noop, onnewchat: noop, onprojects: noop,
    onlibrary: noop, onprojectsettings: noop, onleaveproject: noop, onsettings: noop, oncollapse: noop
  };
  const base = {
    open: false, query: "", project: null, projectStatus: "", userName: "Mon compte", avatarSrc: "image.png",
    settingsOpen: false, groups: [], currentId: null, menuId: null, markFor, ...callbacks
  };
  const modern = (overrides = {}) => render(Sidebar, { props: { ...base, ...overrides } }).body;

  await test("barre latérale au repos : même balisage que index.html (sans France IDE ni contenu des paramètres)", () => {
    const expected = tokens(legacyAside);
    assert.ok(expected.length > 60, "la référence ne doit pas être vide par accident");
    assert.deepEqual(tokens(modern()), expected);
  });

  await test("tiroir ouvert : la classe « open » est ajoutée à <aside> comme le fait openSidebar()", () => {
    const expected = tokens(legacyAside.replace('<aside id="sidebar" class="sidebar"', '<aside id="sidebar" class="sidebar open"'));
    assert.deepEqual(tokens(modern({ open: true })), expected);
  });

  await test("projet ouvert : #project-context visible avec le nom et le statut", () => {
    let html = legacyAside.replace('<div id="project-context" hidden>', '<div id="project-context">');
    html = html.replace('<strong id="project-context-name"></strong>', '<strong id="project-context-name">Biologie &amp; &lt;chimie></strong>');
    html = html.replace('role="status"></p>', 'role="status">Enregistré</p>');
    const actual = modern({ project: { name: "Biologie & <chimie>", sharedWithMe: false }, projectStatus: "Enregistré" });
    assert.deepEqual(tokens(actual), tokens(html));
    assert.doesNotMatch(actual, /<chimie>/, "le nom du projet est échappé");
  });

  await test("projet partagé avec moi : « Paramètres du projet » masqué (comme renderProjectContext)", () => {
    let html = legacyAside.replace('<div id="project-context" hidden>', '<div id="project-context">');
    html = html.replace('<strong id="project-context-name"></strong>', '<strong id="project-context-name">Partagé</strong>');
    html = html.replace('id="project-settings-open" class="side-nav-item"', 'id="project-settings-open" class="side-nav-item" hidden');
    assert.deepEqual(tokens(modern({ project: { name: "Partagé", sharedWithMe: true } })), tokens(html));
  });

  await test("compte : nom, avatar et aria-expanded des paramètres ouverts", () => {
    let html = legacyAside.replace('<span class="user-name">Mon compte</span>', '<span class="user-name">Léa Martin</span>');
    html = html.replace('aria-expanded="false"', 'aria-expanded="true"');
    assert.deepEqual(tokens(modern({ userName: "Léa Martin", settingsOpen: true })), tokens(html));
    assert.match(modern({ avatarSrc: "data:image/png;base64,AAAA" }), /class="avatar avatar-img" src="data:image\/png;base64,AAAA"/);
  });

  await test("historique intégré : même balisage que le vrai renderHistory dans <nav id=\"history\">", () => {
    const groups = groupHistory(visibleConversations(dataset.map(c => ({ ...c })), { projectId: null, query: "" }), NOW);
    const html = legacyAside.replace(legacyHistoryNav, legacyHistory.render(dataset, { currentId: "a" }).html);
    assert.deepEqual(tokens(modern({ groups, currentId: "a" })), tokens(html));
  });

  await test("recherche : « Aucune conversation trouvée. » seulement quand une recherche est saisie", () => {
    assert.doesNotMatch(modern({ query: "" }), /history-empty/);
    assert.match(modern({ query: "zzz" }), /<div class="history-empty">Aucune conversation trouvée\.<\/div>/);
    assert.match(modern({ query: "zzz" }), /value="zzz"/);
  });

  await test("France IDE et paramètres complets sont volontairement absents de la coque", () => {
    const body = modern();
    assert.doesNotMatch(body, /france-ide-open|France IDE/);
    assert.doesNotMatch(body, /id="settings-modal"|settings-dialog/);
    assert.match(body, /aria-controls="settings-modal"/, "le bouton reste relié à la fenêtre des paramètres (qui vit dans l'iframe)");
  });

  await test("contrôle : une mutation du balisage est bien détectée par la comparaison", () => {
    const expected = tokens(legacyAside);
    assert.notDeepEqual(tokens(modern().replace("<span>Projets</span>", "<span>Projet</span>")), expected);
    assert.notDeepEqual(tokens(modern().replace('id="library-open" class="side-nav-item"', 'id="library-open" class="side-nav-item x"')), expected);
    assert.notDeepEqual(tokens(modern().replace('<span class="brand-badge">BETA</span>', "")), expected);
  });

  await test("menu « ⋯ » masqué : même balisage que #conv-menu", () => {
    const actual = render(ConversationMenu, { props: { open: false, pinned: false, anchor: null, onpin: noop, onrename: noop, ondelete: noop } }).body;
    assert.deepEqual(tokens(actual), tokens(legacyMenu));
  });

  await test("menu « ⋯ » ouvert : plus masqué, libellé Désépingler pour une discussion épinglée", () => {
    const open = render(ConversationMenu, { props: { open: true, pinned: true, anchor: null, onpin: noop, onrename: noop, ondelete: noop } }).body;
    const expected = legacyMenu.replace('class="popover conv-menu hidden"', 'class="popover conv-menu"').replace(">Épingler<", ">Désépingler<");
    assert.deepEqual(tokens(open), tokens(expected));
    assert.equal(pinLabel(false), "Épingler");
    assert.equal(pinLabel(true), "Désépingler");
  });

  await test("position du menu : identique au VRAI openConversationMenu legacy sur une grille de cas", () => {
    const classes = new Set(["hidden"]);
    const makeElement = () => ({
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} },
      style: {},
      textContent: "",
      setAttribute() {},
      offsetWidth: 0,
      offsetHeight: 0
    });
    const menu = makeElement();
    const pin = makeElement();
    const others = new Map();
    const context = vm.createContext({
      $: id => (id === "conv-menu" ? menu : id === "conv-pin" ? pin : (others.get(id) ?? others.set(id, makeElement()).get(id))),
      document: { querySelectorAll: () => [] },
      window: { innerWidth: 0, innerHeight: 0 },
      store: { conversations: [{ id: "x", pinned: false }] },
      closeDefaultModelMenu() {},
      closeSettingsImageModelMenu() {},
      closeReasoningMenu() {}
    });
    vm.runInContext("let menuConversationId = null;", context);
    const from = conversationsJs.indexOf("function closeMenus()");
    const to = conversationsJs.indexOf("async function syncConversation");
    assert.ok(from >= 0 && to > from, "tranche closeMenus … openConversationMenu introuvable");
    vm.runInContext(conversationsJs.slice(from, to), context);

    const viewports = [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 320, height: 480 }];
    const menuSize = { width: 180, height: 132 };
    let cases = 0;
    for (const viewport of viewports) {
      for (const left of [-20, 0, 8, 100, 250, 380, 1000]) {
        for (const top of [0, 40, 300, 560, 700, 840]) {
          const rect = { left, top, bottom: top + 30 };
          context.window.innerWidth = viewport.width;
          context.window.innerHeight = viewport.height;
          menu.offsetWidth = menuSize.width;
          menu.offsetHeight = menuSize.height;
          menu.style = {};
          vm.runInContext("closeMenus()", context);
          const row = { classList: { add() {} } };
          context.anchor = { closest: () => row, getBoundingClientRect: () => rect };
          vm.runInContext('openConversationMenu("x", anchor)', context);
          assert.equal(classes.has("hidden"), false, "le menu legacy doit être affiché");
          const actual = menuPosition(rect, menuSize, viewport);
          assert.equal(`${actual.left}px`, menu.style.left, `left pour ${JSON.stringify({ rect, viewport })}`);
          assert.equal(`${actual.top}px`, menu.style.top, `top pour ${JSON.stringify({ rect, viewport })}`);
          cases += 1;
        }
      }
    }
    assert.equal(cases, 126);
    // Libellé du premier élément : le legacy écrit « Épingler » pour une discussion non épinglée.
    assert.equal(pin.textContent, pinLabel(false));
  });
} finally {
  await server.close();
}

console.log(`test-svelte-sidebar-markup : ${count} tests réussis`);
