"use strict";
// Teste les commandes « /skill » (menu, surlignage bleu, consigne de forçage) et les modèles GPT Image 2.6.
// Le rendu visuel réel n'est pas testé ici : le DOM est simulé.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "skill-commands.js"), "utf8");
// Les tableaux venant du contexte vm n'ont pas le même prototype : comparaison via JSON.
assert.deepEqual = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

// ---------- Faux DOM minimal ----------
class FakeNode {
  constructor(tag, nodeType = 1) {
    this.tagName = String(tag || "").toUpperCase();
    this.nodeType = nodeType;
    this.childNodes = [];
    this.attrs = {};
    this.style = {};
    this.listeners = {};
    this.parentNode = null;
    this.className = "";
    this.id = "";
    this.hidden = false;
    this.nodeValue = "";
  }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; if (value) this.appendChild(makeText(value)); }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  replaceChildren(...nodes) { this.childNodes = []; nodes.forEach((node) => this.appendChild(node)); }
  insertBefore(node, ref) {
    const index = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    node.parentNode = this;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    return node;
  }
  removeChild(node) { this.childNodes = this.childNodes.filter((child) => child !== node); node.parentNode = null; return node; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  addEventListener(type, fn, capture) { (this.listeners[type] = this.listeners[type] || []).push({ fn, capture: !!capture }); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    for (const entry of this.listeners[event.type] || []) entry.fn.call(this, event);
    return true;
  }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
  find(predicate, out = []) {
    for (const child of this.childNodes) { if (predicate(child)) out.push(child); child.find(predicate, out); }
    return out;
  }
  querySelector(selector) {
    const name = selector.replace(/^\./, "");
    return this.find((node) => node.nodeType === 1 && node.className.split(/\s+/).includes(name))[0] || null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 40 }; }
  focus() {}
  setSelectionRange() {}
  scrollIntoView() {}
}
function makeText(value) { const node = new FakeNode("#text", 3); node.nodeValue = String(value); return node; }

class HTMLTextAreaElement extends FakeNode {
  get value() { return this._value || ""; }
  set value(next) { this._value = String(next); }
}
class FakeEvent { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } }

function createEnvironment(pages) {
  const body = new FakeNode("body");
  const byId = {};
  const register = (node, id) => { node.id = id; byId[id] = node; return node; };
  const composer = register(new FakeNode("form"), "composer");
  const prompt = register(new HTMLTextAreaElement("textarea"), "prompt");
  prompt.offsetWidth = 300; prompt.clientWidth = 300; prompt.offsetHeight = 40; prompt.scrollTop = 0;
  const actions = new FakeNode("div");
  actions.append(prompt);
  composer.append(actions);
  const messages = register(new FakeNode("div"), "messages");
  body.append(composer, messages);
  const documentListeners = new FakeNode("document");
  const document = {
    body,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => (tag === "textarea" ? new HTMLTextAreaElement(tag) : new FakeNode(tag)),
    createTextNode: makeText,
    querySelectorAll: (selector) => (selector === "#messages .message.user .bubble"
      ? messages.find((node) => node.className === "bubble" && node.parentNode && node.parentNode.className.includes("message user"))
      : []),
    addEventListener: (...args) => documentListeners.addEventListener(...args),
    activeElement: prompt
  };
  const calls = [];
  const sandbox = {
    document,
    window: { getComputedStyle: () => ({}), innerHeight: 800, addEventListener() {} },
    HTMLTextAreaElement,
    Event: FakeEvent,
    URLSearchParams,
    Object, Promise, Date, Set, Array, String, Math, Error, Number, parseFloat, console,
    settingsApi: async (url) => {
      calls.push(url);
      if (!pages.length) throw new Error("Hors ligne");
      const page = pages.shift();
      if (page instanceof Error) throw page;
      return page;
    }
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`function appendMessage(role, content, index, animate) {
    const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = content;
    const row = document.createElement("div"); row.className = "message " + role; row.appendChild(bubble);
    document.getElementById("messages").appendChild(row); return bubble; }`, context);
  vm.runInContext(source, context, { filename: "skill-commands.js" });
  return { context, prompt, composer, body, calls, documentListeners };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const makePages = () => [
  { data: [{ id: "s1", name: "frontend-design", description: "Interfaces soignées" }, { id: "s2", name: "Mon Skill", enabled: false }], has_more: true, last_id: "s2" },
  { data: [{ id: "s3", name: "Résumé Cours", description: "Fiches de révision" }], has_more: false }
];

function type(env, text) {
  env.prompt.value = text;
  env.prompt.dispatchEvent(new FakeEvent("input", { bubbles: true }));
}
function key(env, name, extra) {
  const event = new FakeEvent("keydown", { key: name, target: env.prompt, prevented: false, stopped: false, ...extra });
  event.preventDefault = () => { event.prevented = true; };
  event.stopPropagation = () => { event.stopped = true; };
  env.composer.dispatchEvent(event);
  return event;
}
const menuOf = (env) => env.body.find((node) => node.id === "skill-menu")[0];
const itemsOf = (menu) => menu.children.filter((node) => node.className.includes("skill-menu-item"));

async function main() {
  // --- Fonctions pures ---
  const env0 = createEnvironment(makePages());
  const api = vm.runInContext("TauriSkillCommands", env0.context);
  assert.equal(api.skillSlug({ name: "Résumé Cours" }), "resume-cours");
  assert.equal(api.skillSlug({ name: "frontend-design" }), "frontend-design");
  assert.equal(api.skillSlug({ id: "skill_01" }), "skill_01");
  assert.equal(api.skillSlug({ name: "  !!  " }), "skill");
  assert.equal(api.skillQuery("/"), "");
  assert.equal(api.skillQuery("/fro"), "fro");
  assert.equal(api.skillQuery("/fro "), null);
  assert.equal(api.skillQuery("bonjour /fro"), null);
  assert.equal(api.skillQuery("/a/b"), null);
  const list = [{ id: "a", name: "Design", description: "UI" }, { id: "b", name: "Autre", description: "pour le design" }, { id: "c", name: "Zèbre" }];
  assert.deepEqual(api.filterSkills(list, "").map((row) => row.slug), ["design", "autre", "zebre"]);
  assert.deepEqual(api.filterSkills(list, "des").map((row) => row.slug), ["design", "autre"], "préfixe d'abord, puis description");
  assert.deepEqual(api.filterSkills(list, "ZEB").map((row) => row.slug), ["zebre"], "insensible aux accents et à la casse");
  assert.deepEqual(api.filterSkills(list, "xyz"), []);
  const parsed = api.parseSkillCommand("  /Design fais un logo", list);
  assert.equal(parsed.slug, "design");
  assert.equal(parsed.start, 2);
  assert.equal(parsed.end, 9);
  assert.equal(api.parseSkillCommand("/design", list).end, 7, "commande seule");
  assert.equal(api.parseSkillCommand("/designer", list), null, "le nom doit être complet");
  assert.equal(api.parseSkillCommand("salut /design", list), null, "seulement en début de message");
  assert.equal(api.parseSkillCommand("/inconnu x", list), null);
  const prefix = api.skillPromptPrefix({ id: "s3", name: "Résumé Cours" }, "resume-cours");
  assert.match(prefix, /Résumé Cours/);
  assert.match(prefix, /\/resume-cours/);
  assert.match(prefix, /id : s3/);
  assert.match(prefix, /obligatoirement|Tu dois utiliser/);
  assert.ok(prefix.endsWith("\n\n"));

  // --- Menu, chargement paginé, skills désactivés exclus ---
  const env = createEnvironment(makePages());
  const menu = menuOf(env);
  assert.ok(menu && menu.hidden, "menu présent mais caché au départ");
  type(env, "/");
  assert.equal(menu.hidden, false);
  assert.match(menu.textContent, /Chargement/);
  await flush();
  assert.deepEqual(env.calls, ["/skills?limit=100", "/skills?limit=100&after=s2"], "pagination suivie");
  const items = itemsOf(menu);
  assert.deepEqual(items.map((item) => item.children[0].textContent), ["/frontend-design", "/resume-cours"], "skills activés uniquement");
  assert.match(items[1].children[1].textContent, /Fiches de révision/);
  assert.ok(items[0].className.includes("is-active"));

  // Filtrage en tapant
  type(env, "/res");
  assert.deepEqual(itemsOf(menu).map((item) => item.children[0].textContent), ["/resume-cours"]);
  type(env, "/zzz");
  assert.match(menu.textContent, /Aucun skill ne correspond/);
  assert.equal(env.calls.length, 2, "pas de rechargement pendant la même ouverture");

  // Clic sur un skill : /nom écrit, menu fermé, commande en bleu dans la saisie
  type(env, "/");
  itemsOf(menu)[1].dispatchEvent(new FakeEvent("click"));
  assert.equal(env.prompt.value, "/resume-cours ");
  assert.equal(menu.hidden, true);
  const mirrorSpan = env.prompt.parentNode.childNodes[1].querySelector("skill-command");
  assert.ok(mirrorSpan, "miroir avec la commande surlignée");
  assert.equal(mirrorSpan.textContent, "/resume-cours");
  assert.equal(env.prompt.getAttribute("data-skill-active"), "true");

  // Texte libre après la commande : la commande reste surlignée
  type(env, "/resume-cours fais une fiche sur Louis XIV");
  assert.equal(env.prompt.parentNode.childNodes[1].textContent, "/resume-cours fais une fiche sur Louis XIV");
  assert.equal(env.prompt.getAttribute("data-skill-active"), "true");

  // Forçage : consigne préfixée seulement si la commande est connue
  const prefixed = vm.runInContext('tauriSkillPrefix("/resume-cours fais une fiche")', env.context);
  assert.match(prefixed, /Résumé Cours/);
  assert.equal(vm.runInContext('tauriSkillPrefix("bonjour")', env.context), "");
  assert.equal(vm.runInContext('tauriSkillPrefix("/inconnu test")', env.context), "");
  assert.equal(vm.runInContext('tauriSkillPrefix("/mon-skill test")', env.context), "", "skill désactivé non forcé");

  // Réinitialisation par script (envoi du message) : plus de surlignage ni de texte masqué
  env.prompt.value = "";
  assert.equal(env.prompt.getAttribute("data-skill-active"), null);
  assert.equal(env.prompt.parentNode.childNodes[1].textContent, "");

  // Clavier : flèches + Entrée choisissent le skill et bloquent l'envoi ; Entrée sans menu passe
  type(env, "/");
  assert.equal(key(env, "ArrowDown").prevented, true);
  const enter = key(env, "Enter");
  assert.equal(enter.prevented && enter.stopped, true, "Entrée ne doit pas envoyer le message");
  assert.equal(env.prompt.value, "/resume-cours ");
  assert.equal(key(env, "Enter").prevented, false, "menu fermé : Entrée laissée à l'envoi");
  type(env, "/");
  assert.equal(key(env, "Enter", { shiftKey: true }).prevented, false, "Maj+Entrée = retour à la ligne");
  assert.equal(key(env, "Escape").prevented, true);
  assert.equal(menu.hidden, true);
  type(env, "/f");
  assert.equal(menu.hidden, false, "le menu se rouvre quand le texte change");
  type(env, "/f");
  type(env, "bonjour");
  assert.equal(menu.hidden, true);

  // Clic en dehors : le menu se ferme
  type(env, "/");
  assert.equal(menu.hidden, false);
  env.documentListeners.dispatchEvent(new FakeEvent("pointerdown", { target: env.body }));
  assert.equal(menu.hidden, true);

  // --- Bulles : commande en bleu, texte non interprété comme HTML ---
  const bubble = vm.runInContext('appendMessage("user", "/frontend-design <b>salut</b>", 0, false)', env.context);
  assert.equal(bubble.firstChild.className, "skill-command");
  assert.equal(bubble.firstChild.textContent, "/frontend-design");
  assert.equal(bubble.textContent, "/frontend-design <b>salut</b>");
  const plain = vm.runInContext('appendMessage("user", "/inconnu salut", 1, false)', env.context);
  assert.equal(plain.querySelector("skill-command"), null);
  const assistant = vm.runInContext('appendMessage("assistant", "/frontend-design", 2, false)', env.context);
  assert.equal(assistant.querySelector("skill-command"), null, "seules les bulles utilisateur sont colorées");

  // --- Erreur de chargement ---
  const failing = createEnvironment([new Error("Session expirée")]);
  type(failing, "/");
  await flush();
  assert.match(menuOf(failing).textContent, /Impossible de charger les skills : Session expirée/);
  assert.equal(vm.runInContext('tauriSkillPrefix("/frontend-design x")', failing.context), "");

  // --- Aucun skill activé ---
  const empty = createEnvironment([{ data: [], has_more: false }]);
  type(empty, "/");
  await flush();
  assert.match(menuOf(empty).textContent, /Aucun skill activé/);

  // --- Interface préparée pour Tauri (nécessite node prepare-legacy.cjs) ---
  const legacy = path.join(__dirname, "public/legacy");
  const composerJs = fs.readFileSync(path.join(legacy, "js/composer.js"), "utf8");
  const coreJs = fs.readFileSync(path.join(legacy, "js/core.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(legacy, "index.html"), "utf8");
  for (const id of ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"]) {
    assert.ok(composerJs.includes(`"${id}"`), `${id} absent de composer.js`);
    assert.ok(coreJs.includes(`"${id}"`), `${id} absent de la liste blanche de core.js`);
  }
  assert.ok(composerJs.includes("GPT Image 2.6 Sunburst") && composerJs.includes("GPT Image 2.6 Flare"));
  assert.ok(composerJs.includes("gpt-image-2.5-flare"), "les modèles 2.5 restent disponibles");
  assert.ok(/gpt-image-2\.5-flare"\s*;?\s*$|: "gpt-image-2\.5-flare"/m.test(coreJs), "modèle par défaut inchangé");
  assert.ok(composerJs.includes('sentText = tauriSkillPrefix(text) + sentText;'), "consigne de skill ajoutée à l'envoi");
  const settingsAt = indexHtml.indexOf('js/settings.js');
  const skillsAt = indexHtml.indexOf('js/tauri-skill-commands.js');
  assert.ok(skillsAt > settingsAt && settingsAt > 0, "script chargé après settings.js");
  assert.ok(indexHtml.includes('href="tauri-skill-commands.css"'));
  assert.ok(fs.existsSync(path.join(legacy, "js/tauri-skill-commands.js")));
  assert.ok(fs.existsSync(path.join(legacy, "tauri-skill-commands.css")));

  // Source Capacitor intacte
  const capacitorComposer = fs.readFileSync(path.join(__dirname, "../www/js/composer.js"), "utf8");
  assert.ok(!capacitorComposer.includes("2.6") && !capacitorComposer.includes("tauriSkillPrefix"), "mobile/www ne doit pas être modifié");

  console.log("skill commands ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
