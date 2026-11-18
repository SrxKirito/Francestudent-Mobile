// Outils de test partagés : exécute le VRAI `renderHistory()` de l'ancienne interface (mobile/www/js) dans un contexte vm,
// avec un faux DOM minimal, pour comparer l'historique TypeScript/Svelte à l'original.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(here, "..", "www");

export const DAY = 86_400_000;
export const NOW = new Date(2026, 10, 18, 15, 30).getTime();

const escapeText = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escapeAttribute = value => escapeText(value).replace(/"/g, "&quot;");

export function fakeElement(tag) {
  const element = {
    tag,
    attrs: {},
    children: [],
    set className(value) {
      element.attrs.class = value;
    },
    set title(value) {
      element.attrs.title = value;
    },
    get title() {
      return element.attrs.title ?? "";
    },
    set tabIndex(value) {
      element.attrs.tabindex = String(value);
    },
    set type(value) {
      element.attrs.type = value;
    },
    get className() {
      return element.attrs.class ?? "";
    },
    set textContent(value) {
      element.children = value === "" ? [] : [String(value)];
    },
    get textContent() {
      return element.children.filter(child => typeof child === "string").join("");
    },
    set innerHTML(value) {
      element.children = value === "" ? [] : [{ raw: value }];
    },
    get innerHTML() {
      return "";
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append(...items) {
      element.children.push(...items);
    },
    prepend(child) {
      element.children.unshift(child);
    },
    setAttribute(key, value) {
      element.attrs[key] = String(value);
    },
    addEventListener() {}
  };
  return element;
}

export function serialize(node) {
  if (typeof node === "string") return escapeText(node);
  if ("raw" in node) return node.raw;
  const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join("");
  return `<${node.tag}${attrs}>${node.children.map(serialize).join("")}</${node.tag}>`;
}

class FixedDate extends Date {
  static now() {
    return NOW;
  }
}

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `tranche introuvable : ${from} … ${to}`);
  return source.slice(start, end);
}

/** `agents` : catalogue des modèles tel que `normalizeAgent()` le produit. */
export function createLegacyHistory(agents = []) {
  const nav = fakeElement("nav");
  nav.attrs = { id: "history", class: "history", "aria-label": "Historique" };
  const context = vm.createContext({
    $: () => nav,
    window: {},
    document: { createElement: fakeElement },
    Date: FixedDate,
    String,
    Number,
    Array,
    agents,
    store: { conversations: [] },
    currentProject: null,
    currentId: null,
    openConversation() {},
    openConversationMenu() {}
  });
  const conversations = fs.readFileSync(path.join(www, "js", "conversations.js"), "utf8");
  const models = fs.readFileSync(path.join(www, "js", "models.js"), "utf8");
  vm.runInContext(fs.readFileSync(path.join(www, "logos.js"), "utf8"), context);
  vm.runInContext(slice(models, "const PROVIDER_NAMES", "async function loadAgents"), context);
  vm.runInContext(slice(conversations, "const ICON_PATHS", "function initials"), context);
  vm.runInContext(slice(conversations, "let historyQuery", "function closeMenus"), context);
  return {
    logos: context.window.PROVIDER_LOGOS,
    /** Rend l'historique et renvoie le HTML de `<nav id="history">` ainsi que la liste à plat des lignes. */
    render(conversations, { projectId = null, query = "", currentId = null, menuId = null } = {}) {
      context.store.conversations = conversations.map(conversation => ({ ...conversation }));
      context.currentProject = projectId === null ? null : { id: projectId };
      context.currentId = currentId;
      vm.runInContext(`historyQuery = ${JSON.stringify(query)}; menuConversationId = ${JSON.stringify(menuId)}`, context);
      vm.runInContext("renderHistory()", context);
      const lines = nav.children.map(child => {
        if (child.className === "history-label") return `# ${child.textContent}`;
        if (child.className === "history-empty") return `! ${child.textContent}`;
        return `item: ${child.children[1].textContent}`;
      });
      return { lines, html: serialize(nav) };
    },
    /** Évalue une expression dans le contexte de l'ancienne interface (ex. `providerLabel("x", "y")`). */
    evaluate: code => vm.runInContext(code, context),
    icon: (name, size) => vm.runInContext(`icon(${JSON.stringify(name)}, ${size})`, context)
  };
}
