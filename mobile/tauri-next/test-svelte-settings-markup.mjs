// Compare la fenêtre Paramètres Svelte (rendu serveur via Vite) au balisage du vrai index.html legacy :
// en-tête et onglets à l'identique, panneau Général élément par élément (identifiants, classes, attributs, textes),
// puis les états (chargement, erreur, thème, colonnes, modèles, notifications, recherche web, interface).
// Ce test vérifie la structure : il ne dit RIEN du rendu visuel ni du comportement sur appareil.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { tokens } from "./test-markup-tokens.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(here, "..", "www", "index.html"), "utf8");
const interfaceScript = fs.readFileSync(path.join(here, "interface-settings.js"), "utf8");

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

function slice(source, from, to, offset = 0) {
  const start = source.indexOf(from, offset);
  assert.ok(start >= 0, `introuvable : ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end >= 0, `introuvable : ${to}`);
  return source.slice(start, end + to.length);
}

// Les valeurs de sélection (onglet actif, tabindex) dépendent de l'état : elles sont testées à part.
const flat = html => html.replace(/\s+aria-selected="[^"]*"/g, "").replace(/\s+tabindex="[^"]*"/g, "").replace(/&#10;|\n/g, " ");

const legacyFrame = slice(indexHtml, '<div id="settings-modal"', "</nav>");
const legacyGeneral = slice(indexHtml, '<section id="panel-general"', "</section>").replace(' aria-labelledby="tab-general" hidden>', ' aria-labelledby="tab-general">')
  .replace(/<div class="settings-field default-model-field">\s*<button id="settings-image-model-button"[\s\S]*?<div id="settings-image-models"[^>]*><\/div>\s*<\/div>/, "");
const legacyInterface = [...interfaceScript.split("\n").slice(51, 58).join("\n").matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(match => match[1]).join("");

function elements(html) {
  const found = new Map();
  for (const match of html.matchAll(/<([a-zA-Z0-9]+)((?:\s+[a-zA-Z:-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const attrs = {};
    for (const attr of match[2].matchAll(/\s+([a-zA-Z:-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = (attr[2] ?? "").replace(/&#10;/g, "\n");
    if (attrs.id !== undefined) found.set(attrs.id, { tag: match[1].toLowerCase(), attrs });
  }
  return found;
}

function texts(html) {
  return tokens(html).filter(token => token.startsWith("#")).map(token => token.slice(1));
}

function classes(value) {
  return (value ?? "").split(/\s+/).filter(item => item && item !== "hidden").sort().join(" ");
}

const IMAGE_MODELS = [
  { id: "gpt-image-2.6-sunburst", short: "Sunburst", name: "GPT Image 2.6 Sunburst" },
  { id: "gpt-image-2.5-flare", short: "Flare", name: "GPT Image 2.5 Flare" }
];
const agents = [
  { id: 1, name: "GPT-5 (rapide)", provider: "OpenAI", available: true },
  { id: 3, name: "GPT-4", provider: "OpenAI", available: false },
  { id: 4, name: "Maison", provider: "", available: true }
];

const server = await createServer({
  root: here,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null }
});

try {
  const { render } = await server.ssrLoadModule("svelte/server");
  const SettingsDialog = (await server.ssrLoadModule("/src/components/SettingsDialog.svelte")).default;
  const { SettingsStore } = await server.ssrLoadModule("/src/lib/stores/settings.svelte.ts");

  function build({ local = {}, catalog = {}, choice = { ui: "svelte", chat: false }, list = agents, account } = {}) {
    const settings = { theme: "system", libraryColumns: 3, completionNotifications: false, defaultAgentId: null, imageTool: true, imageModel: "gpt-image-2.5-flare", webSearchMode: "open", ...local };
    const gateway = {
      read: () => ({ ...settings }),
      catalog: () => ({ imageModels: IMAGE_MODELS, notificationsSupported: true, ...catalog }),
      update() {},
      toggleNotifications: async () => "",
      instructionsSaved() {},
      busy: () => false
    };
    const never = new Promise(() => {});
    const service = { loadPersonalization: () => never, savePersonalization: () => never, loadWebDomains: () => never, saveWebSettings: () => never };
    const host = { state: () => choice, apply: () => null, reload() {} };
    const store = new SettingsStore({ service, local: gateway, agents: () => list, interfaceHost: host, openClassic() {}, account });
    store.open = true;
    store.loadState = "ready";
    return store;
  }

  const html = store => render(SettingsDialog, { props: { store } }).body;
  // Le panneau contient la section Interface (imbriquée) : on coupe au DERNIER </section>, celui du panneau.
  const panel = store => {
    const out = html(store);
    const start = out.indexOf('<section id="panel-general"');
    assert.ok(start >= 0, "panneau Général absent");
    return out.slice(start, out.lastIndexOf("</section>") + "</section>".length);
  };

  await test("fenêtre fermée : rien n'est rendu", () => {
    const store = build();
    store.open = false;
    assert.ok(!html(store).includes("settings-modal"));
  });

  await test("en-tête et onglets : même balisage que index.html", () => {
    const actual = slice(html(build()), '<div id="settings-modal"', "</nav>");
    assert.deepEqual(tokens(flat(actual), { ignoreClasses: ["hidden", "active"] }), tokens(flat(legacyFrame), { ignoreClasses: ["hidden", "active"] }));
  });

  await test("onglets : Général sélectionné, les autres sortent de l'ordre de tabulation", () => {
    const head = slice(html(build()), '<nav id="settings-tablist"', "</nav>");
    const tabs = [...head.matchAll(/<button[^>]*>/g)].map(match => match[0]);
    assert.equal(tabs.length, 4);
    const selected = tabs.map(tab => /aria-selected="true"/.test(tab));
    assert.deepEqual(selected, [false, true, false, false]);
    assert.ok(/class="[^"]*\bactive\b/.test(tabs[1]) && !tabs.some((tab, i) => i !== 1 && /\bactive\b/.test(tab)));
    assert.deepEqual(tabs.map(tab => /tabindex="-1"/.test(tab)), [true, false, true, true]);
  });

  await test("panneau Général : chaque élément à identifiant du legacy existe avec la même balise, les mêmes classes et les mêmes attributs", () => {
    const expected = elements(legacyGeneral);
    const actual = elements(panel(build()));
    // Écarts voulus : le textarea n'a pas de maxlength (la limite du serveur, 10 000, est contrôlée à l'enregistrement) ;
    // le title du bouton du modèle par défaut est posé par JavaScript dans le legacy (absent du HTML statique), mais dynamique ici.
    const ignored = new Map([["custom-instructions", new Set(["maxlength"])], ["default-model-button", new Set(["title"])]]);
    const keys = ["role", "type", "aria-haspopup", "aria-labelledby", "aria-controls", "aria-label", "aria-expanded", "for", "title", "rows", "placeholder", "data-settings-close"];
    assert.ok(expected.size > 35, "le legacy doit exposer beaucoup d'identifiants");
    for (const [id, legacy] of expected) {
      const modern = actual.get(id);
      assert.ok(modern, `élément manquant : #${id}`);
      assert.equal(modern.tag, legacy.tag, `balise de #${id}`);
      assert.equal(classes(modern.attrs.class), classes(legacy.attrs.class), `classes de #${id}`);
      for (const key of keys) {
        if (ignored.get(id)?.has(key)) continue;
        assert.equal(modern.attrs[key], legacy.attrs[key], `attribut ${key} de #${id}`);
      }
    }
  });

  await test("panneau Général : tous les textes du legacy, dans le même ordre", () => {
    const wanted = texts(legacyGeneral);
    const got = texts(panel(build()));
    let position = 0;
    for (const text of wanted) {
      const found = got.indexOf(text, position);
      assert.ok(found >= 0, `texte absent ou déplacé : « ${text} »`);
      position = found + 1;
    }
  });

  await test("section Interface : même balisage que interface-settings.js, placée après le choix des colonnes", () => {
    const store = build();
    const out = panel(store);
    const section = slice(out, '<section class="tauri-interface-choice"', "</section>");
    const expected = legacyInterface.replace(/aria-checked="false"><span>Interface classique/, 'aria-checked="false"><span>Interface classique');
    const normalize = value => tokens(value.replace(/<section[^>]*>|<\/section>/g, "").replace(/\s+aria-checked="[^"]*"/g, "").replace(/\s+hidden(?=[\s>])/g, ""));
    assert.deepEqual(normalize(section), normalize(expected));
    assert.ok(out.indexOf('class="library-layout-choices"') < out.indexOf("tauri-interface-choice"));
    assert.ok(out.indexOf("tauri-interface-choice") < out.indexOf(">Notifications<"));
  });

  await test("section Interface : choix courant, bouton du nouveau chat visible seulement avec l'interface Svelte", () => {
    const svelte = slice(panel(build({ choice: { ui: "svelte", chat: true } })), '<section class="tauri-interface-choice"', "</section>");
    assert.ok(/data-ui-choice="svelte"[^>]*aria-checked="true"/.test(svelte) || /aria-checked="true"[^>]*data-ui-choice="svelte"/.test(svelte));
    assert.ok(/data-ui-choice="legacy"[^>]*aria-checked="false"/.test(svelte) || /aria-checked="false"[^>]*data-ui-choice="legacy"/.test(svelte));
    const chatOn = svelte.match(/<button[^>]*data-ui-chat[^>]*>/)[0];
    assert.ok(/aria-checked="true"/.test(chatOn) && !/\shidden/.test(chatOn));
    const classic = slice(panel(build({ choice: { ui: "legacy", chat: false } })), '<section class="tauri-interface-choice"', "</section>");
    const chatOff = classic.match(/<button[^>]*data-ui-chat[^>]*>/)[0];
    assert.ok(/\shidden/.test(chatOff) && /aria-checked="false"/.test(chatOff));
  });

  await test("thème et colonnes : un seul bouton coché, colonnes avec tabindex 0 / -1", () => {
    const out = panel(build({ local: { theme: "dark", libraryColumns: 2 } }));
    const theme = [...out.matchAll(/<button[^>]*data-theme-choice="(\w+)"[^>]*>/g)].map(match => [match[1], /aria-checked="true"/.test(match[0])]);
    assert.deepEqual(theme, [["system", false], ["light", false], ["dark", true]]);
    const columns = [...out.matchAll(/<button[^>]*data-library-columns="(\d)"[^>]*>/g)].map(match => [match[1], /aria-checked="true"/.test(match[0]), /tabindex="0"/.test(match[0]), /tabindex="-1"/.test(match[0])]);
    assert.deepEqual(columns, [["1", false, false, true], ["2", true, true, false], ["3", false, false, true], ["4", false, false, true]]);
  });

  await test("notifications : libellé selon l'état, bouton désactivé hors iOS", () => {
    assert.ok(/id="completion-notifications"[^>]*>Activer les notifications</.test(panel(build())));
    assert.ok(/id="completion-notifications"[^>]*>Désactiver les notifications</.test(panel(build({ local: { completionNotifications: true } }))));
    assert.ok(!/id="completion-notifications"[^>]*\sdisabled/.test(panel(build())));
    assert.ok(/id="completion-notifications"[^>]*\sdisabled/.test(panel(build({ catalog: { notificationsSupported: false } }))));
    assert.ok(panel(build()).includes("Notifications locales en arrière-plan ; pas de notification distante quand l’app est fermée."));
  });

  await test("modèle par défaut : Automatique, groupes par fournisseur, modèles indisponibles marqués", () => {
    const out = panel(build());
    assert.ok(/id="default-model-name"[^>]*><span class="model-title">Automatique</.test(out));
    assert.ok(/id="default-model-button"[^>]*title="Modèle par défaut : automatique \(dernier utilisé\)"/.test(out));
    const menu = slice(out, 'id="default-model-menu"', "</div></div>");
    assert.ok(menu.includes('data-id=""') && menu.includes("Automatique (dernier utilisé)"));
    assert.ok(/data-id=""[^>]*aria-selected="true"|aria-selected="true"[^>]*data-id=""/.test(menu));
    assert.deepEqual([...menu.matchAll(/class="menu-label">([^<]*)</g)].map(match => match[1]), ["OpenAI", "Autres modèles"]);
    const unavailable = menu.match(/<button[^>]*data-id="3"[^>]*>/)[0];
    assert.ok(/\bunavailable\b/.test(unavailable) && /aria-disabled="true"/.test(unavailable) && unavailable.includes("Ce modèle est indisponible pour le moment."));
    assert.ok(menu.includes('class="model-badge">Indisponible<'));
    assert.ok(!/data-id="1"[^>]*aria-selected="true"/.test(menu));
  });

  await test("modèle par défaut valide : nom sans parenthèse, coche sur le modèle, titre du bouton", () => {
    const out = panel(build({ local: { defaultAgentId: 1 } }));
    assert.ok(/id="default-model-name"[^>]*><span class="model-title">GPT-5</.test(out));
    assert.ok(out.includes('title="Modèle par défaut : GPT-5"'));
    const menu = slice(out, 'id="default-model-menu"', "</div></div>");
    assert.ok(/<button[^>]*data-id="1"[^>]*aria-selected="true"/.test(menu) || /<button[^>]*aria-selected="true"[^>]*data-id="1"/.test(menu));
    assert.equal((menu.match(/class="model-check"/g) ?? []).length, 1);
  });

  await test("modèle par défaut indisponible : retombe sur Automatique", () => {
    const out = panel(build({ local: { defaultAgentId: 3 } }));
    assert.ok(/id="default-model-name"[^>]*><span class="model-title">Automatique</.test(out));
  });

  await test("génération d’images : interrupteur disponible sans sélecteur de modèle", () => {
    const out = panel(build());
    assert.ok(/id="image-tool-toggle"[^>]*\schecked/.test(out));
    assert.ok(!out.includes("settings-image-model-button"));
  });

  await test("chargement : champs et lien Recherche web désactivés, statut, pas de bouton Réessayer", () => {
    const store = build();
    store.loadState = "loading";
    store.status = "Chargement des préférences…";
    const out = panel(store);
    assert.ok(/id="personalization-fields"[^>]*\sdisabled/.test(out));
    assert.ok(/id="web-settings-open"[^>]*\sdisabled/.test(out));
    assert.ok(/id="personalization-status"[^>]*>Chargement des préférences…</.test(out));
    assert.ok(!/id="personalization-status"[^>]*general-status-error/.test(out));
    assert.ok(/id="personalization-retry"[^>]*\shidden/.test(out));
  });

  await test("prêt : champs actifs, valeurs du compte, résumé de la recherche web", () => {
    const store = build();
    store.reasoning = "high";
    store.instructions = "Sois <bref> & clair.";
    store.webSummary = "Sites filtrés";
    const out = panel(store);
    assert.ok(!/id="personalization-fields"[^>]*\sdisabled/.test(out));
    assert.ok(!/id="web-settings-open"[^>]*\sdisabled/.test(out));
    assert.ok(/id="gpt-reasoning-label"[^>]*>Élevé</.test(out));
    assert.ok(/id="gpt-reasoning"[^>]*value="high"/.test(out));
    assert.ok(/data-reasoning="high"[^>]*aria-selected="true"/.test(out) && /data-reasoning="none"[^>]*aria-selected="false"/.test(out));
    assert.ok(/id="web-settings-summary">Sites filtrés</.test(out));
    const area = out.slice(out.indexOf('<textarea id="custom-instructions"'), out.indexOf("</textarea>") + 11);
    // Svelte échappe « < » et « & » dans le contenu d'un textarea ; « > » reste tel quel, sans risque dans ce contexte.
    assert.ok(out.includes("Sois &lt;bref> &amp; clair."), `le texte des instructions est échappé : ${area}`);
  });

  await test("enregistrement en cours : champs désactivés ; erreur : classe d'erreur et bouton Réessayer visible", () => {
    const saving = build();
    saving.saving = true;
    assert.ok(/id="personalization-fields"[^>]*\sdisabled/.test(panel(saving)));
    const failed = build();
    failed.loadState = "error";
    failed.status = "Impossible de charger les préférences : Réponse du serveur illisible.";
    failed.statusError = true;
    const out = panel(failed);
    assert.ok(/id="personalization-status"[^>]*general-status-error/.test(out));
    assert.ok(out.includes("Impossible de charger les préférences : Réponse du serveur illisible."));
    assert.ok(!/id="personalization-retry"[^>]*\shidden/.test(out));
    assert.ok(/id="personalization-fields"[^>]*\sdisabled/.test(out));
  });

  await test("recherche web : filtres visibles seulement en mode « Sites filtrés », champ selon le type de filtre", () => {
    const base = build();
    assert.ok(/id="web-domain-options"[^>]*\shidden/.test(panel(base)));
    const filtered = build();
    filtered.webMode = "filtered";
    const allow = panel(filtered);
    assert.ok(!/id="web-domain-options"[^>]*\shidden/.test(allow));
    assert.ok(!/id="web-allowed-field"[^>]*\shidden/.test(allow) && /id="web-blocked-field"[^>]*\shidden/.test(allow));
    filtered.webFilterType = "blocklist";
    const block = panel(filtered);
    assert.ok(/id="web-allowed-field"[^>]*\shidden/.test(block) && !/id="web-blocked-field"[^>]*\shidden/.test(block));
  });

  await test("recherche web : liste recopiée, champs désactivés pendant le chargement, Réessayer et erreur", () => {
    const store = build();
    store.webMode = "filtered";
    store.webAllowed = "wikipedia.org\nfrancestudent.org";
    store.webLoading = true;
    store.webStatus = "Chargement des filtres…";
    const loading = panel(store);
    assert.ok(/id="web-settings-fields"[^>]*\sdisabled/.test(loading));
    assert.ok(/id="web-allowed-domains"[^>]*>wikipedia\.org\s+francestudent\.org</.test(loading));
    assert.ok(/id="web-settings-retry"[^>]*\shidden/.test(loading));
    store.webLoading = false;
    store.webStatus = "Impossible de charger les filtres : Hors ligne.";
    store.webStatusError = true;
    store.webRetryVisible = true;
    const failed = panel(store);
    assert.ok(/id="web-settings-fields"[^>]*\sdisabled/.test(failed), "filtres non lus : les champs restent bloqués jusqu'à Réessayer");
    assert.ok(/id="web-settings-status"[^>]*general-status-error/.test(failed));
    assert.ok(!/id="web-settings-retry"[^>]*\shidden/.test(failed));
  });

  await test("erreur d'écriture locale : message visible dans le panneau", () => {
    const store = build();
    store.localError = "Impossible d’enregistrer les réglages : le stockage local est refusé.";
    assert.ok(panel(store).includes("Impossible d’enregistrer les réglages : le stockage local est refusé."));
    store.localError = "";
    assert.ok(!panel(store).includes("stockage local est refusé"));
  });

  await test("menus fermés au départ : listes masquées, boutons non déployés", () => {
    const out = panel(build());
    for (const id of ["default-model-menu", "gpt-reasoning-menu"]) assert.ok(new RegExp(`id="${id}"[^>]*class="[^"]*\\bhidden\\b|class="[^"]*\\bhidden\\b[^"]*"[^>]*id="${id}"`).test(out) || new RegExp(`<div[^>]*id="${id}"[^>]*>`).exec(out)?.[0].includes("hidden"), `menu ouvert : ${id}`);
    for (const id of ["default-model-button", "gpt-reasoning-button"]) assert.ok(new RegExp(`id="${id}"[^>]*aria-expanded="false"`).test(out), `bouton déployé : ${id}`);
  });

  await test("recherche web : tant que les filtres ne sont pas chargés, champs et bouton Enregistrer sont désactivés", () => {
    const loading = build();
    loading.webLoading = true;
    const during = panel(loading);
    assert.ok(/id="web-settings-fields"[^>]*\sdisabled/.test(during));
    assert.ok(/id="web-settings-save"[^>]*\sdisabled/.test(during));
    const failed = build();
    failed.webStatus = "Impossible de charger les filtres : Hors ligne.";
    failed.webStatusError = true;
    failed.webRetryVisible = true;
    const afterFailure = panel(failed);
    assert.ok(/id="web-settings-fields"[^>]*\sdisabled/.test(afterFailure), "pas de filtres lus : champs bloqués");
    assert.ok(/id="web-settings-save"[^>]*\sdisabled/.test(afterFailure));
    assert.ok(!/id="web-settings-retry"[^>]*\shidden/.test(afterFailure));
    const ready = build();
    ready.webLoaded = { filterType: "allowlist", allowedDomains: [], blockedDomains: [] };
    const out = panel(ready);
    assert.ok(!/id="web-settings-fields"[^>]*\sdisabled/.test(out));
    assert.ok(!/id="web-settings-save"[^>]*\sdisabled/.test(out));
    const saving = build();
    saving.webLoaded = ready.webLoaded;
    saving.webSaving = true;
    assert.ok(/id="web-settings-save"[^>]*\sdisabled/.test(panel(saving)));
  });

  // ---- Panneau Compte ----
  const legacyAccount = indexHtml.slice(indexHtml.indexOf('<section id="panel-account"'), indexHtml.indexOf('<section id="panel-mcp"')).trim();
  const NOW = new Date("2026-11-20T12:00:00Z");
  const compact = value => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const exact = value => new Intl.NumberFormat("fr-FR").format(value);
  const { AccountStore } = await server.ssrLoadModule("/src/lib/stores/account.svelte.ts");

  const ACCOUNT_DATA = {
    "/user/me": { name: "Léa Martin", email: "lea@example.org" },
    "/user/usage": { chatBudget: { usedPercent: 75.4, remainingPercent: 24.6, resetAt: "2026-11-21T08:30:00Z" } },
    "/user/tokenusage?tokenUsageDays=343": {
      totalTokenCount: 12345,
      last7DaysTokenUsage: [
        { date: "2026-11-19", inputTokens: 100, outputTokens: 50, reasoningTokens: 10, totalTokens: 160 },
        { date: "2026-11-20", inputTokens: 300, outputTokens: 100, reasoningTokens: 0, totalTokens: 400 }
      ]
    },
    "/user/sessions": [
      { id: "s1", since: "2026-11-01T10:00:00Z", os: "iOS 19", location: "Paris, France", lastActiveAt: "2026-11-20T11:00:00Z" },
      { id: "s2", since: "2026-10-01T10:00:00Z", os: "", location: "", lastActiveAt: "" }
    ]
  };

  function accountDeps(data = {}, local = {}) {
    const answers = { ...ACCOUNT_DATA, ...data };
    return {
      api: {
        json: async path => {
          const value = answers[path];
          if (value instanceof Error) throw value;
          if (value === undefined) throw new Error("route inconnue : " + path);
          return value;
        }
      },
      local: { read: () => ({ profile: { name: "", email: "" }, avatar: "" }), saveProfile() {}, setAvatar() {}, removeAvatar() {}, signOut: async () => {}, ...local },
      saver: async () => {},
      share: null,
      readAvatar: async () => "data:image/png;base64,AAAA",
      now: () => NOW,
      toast() {},
      signedOut: async () => {}
    };
  }

  async function accountStore({ data, local, activate = true } = {}) {
    const account = new AccountStore(accountDeps(data, local));
    const store = build({ account });
    store.tab = "account";
    if (activate) await account.activate();
    return { store, account };
  }

  // Svelte insère des commentaires `<!--[-->` autour des blocs `{#if}`/`{#each}` : ce sont des repères d'hydratation,
  // pas des éléments ; on les retire pour comparer le balisage réel (parent et premier enfant contigus).
  const accountPanel = store => {
    const out = html(store).replace(/<!--[\s\S]*?-->/g, "");
    const start = out.indexOf('<section id="panel-account"');
    assert.ok(start >= 0, "panneau Compte absent");
    return out.slice(start, out.lastIndexOf("</section>") + "</section>".length);
  };

  await test("panneau Compte : chaque élément à identifiant du legacy existe avec la même balise, les mêmes classes et les mêmes attributs", async () => {
    const { store } = await accountStore();
    const expected = elements(legacyAccount);
    const actual = elements(accountPanel(store));
    const keys = ["role", "type", "aria-label", "aria-live", "aria-hidden", "aria-labelledby", "title", "accept", "alt"];
    assert.ok(expected.size >= 14, "le legacy doit exposer les éléments du compte");
    for (const [id, legacy] of expected) {
      const modern = actual.get(id);
      assert.ok(modern, `élément manquant : #${id}`);
      assert.equal(modern.tag, legacy.tag, `balise de #${id}`);
      assert.equal(classes(modern.attrs.class), classes(legacy.attrs.class), `classes de #${id}`);
      for (const key of keys) assert.equal(modern.attrs[key], legacy.attrs[key], `attribut ${key} de #${id}`);
    }
  });

  await test("panneau Compte : tous les textes du legacy, dans le même ordre (état initial, avant chargement)", async () => {
    const { store } = await accountStore({ activate: false });
    const wanted = texts(legacyAccount);
    const got = texts(accountPanel(store));
    let position = 0;
    for (const text of wanted) {
      const found = got.indexOf(text, position);
      assert.ok(found >= 0, `texte absent ou déplacé : « ${text} »`);
      position = found + 1;
    }
    const out = accountPanel(store);
    assert.ok(/id="avatar-remove"[^>]*\shidden/.test(out));
    assert.ok(/id="activity-share"[^>]*\sdisabled/.test(out));
    assert.ok(/id="activity-content"[^>]*\shidden/.test(out));
  });

  await test("panneau Compte : nom, e-mail et avatar par défaut ou personnalisé", async () => {
    const { store, account } = await accountStore();
    const out = accountPanel(store);
    assert.ok(/id="profile-name"[^>]*>Léa Martin</.test(out));
    assert.ok(/id="profile-email"[^>]*>lea@example\.org</.test(out));
    assert.ok(/id="avatar-remove"[^>]*\shidden/.test(out), "sans photo personnalisée, Retirer est masqué");
    assert.ok(!/id="profile-avatar"[^>]*src="data:/.test(out));
    await account.changeAvatar({ type: "image/png", name: "a.png" });
    const custom = accountPanel(store);
    assert.ok(/id="profile-avatar"[^>]*src="data:image\/png;base64,AAAA"/.test(custom));
    assert.ok(!/id="avatar-remove"[^>]*\shidden/.test(custom));
    const anonymous = await accountStore({ data: { "/user/me": new Error("hors ligne") } });
    assert.ok(/id="profile-name"[^>]*>Mon compte</.test(accountPanel(anonymous.store)));
    const mailOnly = await accountStore({ data: { "/user/me": { name: "", email: "x@y.org" } } });
    assert.ok(/id="profile-name"[^>]*>x@y\.org</.test(accountPanel(mailOnly.store)));
  });

  await test("quota : ligne « Utilisé » avec barre, niveau d'alerte et note de réinitialisation", async () => {
    const { store } = await accountStore();
    const box = slice(accountPanel(store), 'id="quota-box"', "</div></div>");
    assert.ok(/<div class="quota-row-head"><span>Utilisé<\/span><strong>75 %<\/strong><\/div>/.test(box), box);
    assert.ok(/<div class="quota-bar"><span[^>]*class="warn"[^>]*style="width:\s*75\.4%/.test(box) || /<div class="quota-bar"><span[^>]*style="width:\s*75\.4%[^>]*class="warn"/.test(box), box);
    assert.ok(/<div class="quota-note">25 % restant · Réinitialisation (à|le) /.test(box), box);
    const danger = await accountStore({ data: { "/user/usage": { chatBudget: { usedPercent: 95, remainingPercent: 5 } } } });
    const dangerBox = slice(accountPanel(danger.store), 'id="quota-box"', "</div></div>");
    assert.ok(/class="danger"/.test(dangerBox) && />95 %</.test(dangerBox) && />5 % restant</.test(dangerBox), dangerBox);
    const low = await accountStore({ data: { "/user/usage": { chatBudget: { usedPercent: 10, remainingPercent: 90 } } } });
    assert.ok(!/class="(warn|danger)"/.test(accountPanel(low.store)));
  });

  await test("quota : messages du legacy (non communiqué, indisponible, chargement) dans la zone annoncée", async () => {
    const none = await accountStore({ data: { "/user/usage": {} } });
    assert.ok(/id="quota-box"[^>]*aria-live="polite"><div class="quota-note">Budget du jour non communiqué par le serveur\.</.test(accountPanel(none.store)));
    const failed = await accountStore({ data: { "/user/usage": new Error("HTTP 503") } });
    assert.ok(accountPanel(failed.store).includes("Quota indisponible (HTTP 503)."));
    const idle = await accountStore({ activate: false });
    assert.ok(accountPanel(idle.store).includes("Ouvre ce menu pour charger le quota."));
  });

  await test("activité : quatre indicateurs, calendrier de 343 cases, légende et analyses", async () => {
    const { store, account } = await accountStore();
    const out = accountPanel(store);
    assert.ok(!/id="activity-content"[^>]*\shidden/.test(out));
    assert.ok(!/id="activity-share"[^>]*\sdisabled/.test(out));
    assert.ok(/id="activity-status"[^>]*>Historique journalier disponible sur les 343 derniers jours\.</.test(out));
    const metrics = out.slice(out.indexOf('<div class="activity-metrics">'));
    assert.deepEqual([...metrics.matchAll(/<strong>([^<]*)<\/strong><span>([^<]*)<\/span>/g)].map(match => [match[2], match[1]]), [
      ["Tokens totaux", compact(12345)],
      ["Pic journalier", compact(400)],
      ["Jours actifs", compact(2)],
      ["Moyenne / jour renseigné", compact(280)]
    ]);
    assert.ok(out.includes(`${exact(560)} tokens · 2 jours renseignés`));
    const cells = [...out.matchAll(/<button[^>]*class="activity-cell[^"]*"[^>]*>/g)].map(match => match[0]);
    assert.equal(cells.length, 343);
    assert.ok(cells.every(cell => /type="button"/.test(cell)));
    const today = cells.at(-1);
    assert.ok(/data-level="4"/.test(today) && /title="2026-11-20 : 400 tokens"/.test(today) && /aria-label="2026-11-20 : 400 tokens"/.test(today) && !/unreported/.test(today), today);
    assert.ok(/data-level="2"/.test(cells.at(-2)) && /title="2026-11-19 : 160 tokens"/.test(cells.at(-2)));
    assert.ok(/unreported/.test(cells[0]) && /data-level="0"/.test(cells[0]) && /title="2025-12-13 : aucune donnée reçue"/.test(cells[0]), cells[0]);
    assert.equal((out.match(/class="activity-months"><span/g) ?? []).length, 1);
    assert.equal(slice(out, '<div class="activity-months">', "</div>").match(/<span/g).length, 49);
    assert.ok(out.includes('aria-label="Activité quotidienne des 343 derniers jours. Chaque case indique sa date et son nombre de tokens."'));
    assert.ok(out.includes("Clair = activité élevée · cases en pointillés = aucune donnée reçue."));
    const pairs = [...out.matchAll(/<div class="activity-pair"><span>([^<]*)<\/span><strong>([^<]*)<\/strong><\/div>/g)].map(match => [match[1], match[2]]);
    assert.deepEqual(pairs, [
      ["Total période", compact(560)],
      ["Pic journalier", "2026-11-20 · " + compact(400)],
      ["Jours actifs", "2"],
      ["🔵 Input", compact(400)],
      ["🟢 Output", compact(150)],
      ["🟠 Reasoning", compact(10)]
    ]);
    assert.ok(out.includes("<h4>Insights d’activité</h4>") && out.includes("<h4>Répartition tokens</h4>"));
    account.selectCell("2026-11-20 : 400 tokens");
    assert.ok(/id="activity-status"[^>]*>2026-11-20 : 400 tokens</.test(accountPanel(store)));
  });

  await test("activité : sans historique, message du legacy et pas de calendrier ; en erreur, statut explicite", async () => {
    const empty = await accountStore({ data: { "/user/tokenusage?tokenUsageDays=343": { totalTokenCount: 5, last7DaysTokenUsage: [] } } });
    const out = accountPanel(empty.store);
    assert.ok(out.includes("Aucun historique journalier disponible pour cette période."));
    assert.ok(!out.includes("activity-calendar-box") && !out.includes("activity-cell"));
    assert.ok(/<strong>—<\/strong><span>Pic journalier<\/span>/.test(out));
    const failed = await accountStore({ data: { "/user/tokenusage?tokenUsageDays=343": new Error("HTTP 500") } });
    const bad = accountPanel(failed.store);
    assert.ok(/id="activity-status"[^>]*>Activité indisponible : HTTP 500</.test(bad));
    assert.ok(/id="activity-share"[^>]*\sdisabled/.test(bad) && /id="activity-content"[^>]*\shidden/.test(bad));
  });

  await test("Compte expose la déconnexion sans la gestion des sessions", async () => {
    const { store } = await accountStore();
    const out = accountPanel(store);
    assert.ok(!out.includes('id="account-sessions"'));
    assert.ok(!out.includes("Mémoires du compte"));
    assert.ok(!out.includes('id="account-api-key"'));
    assert.ok(out.indexOf('id="logout"') > out.indexOf('id="account-activity"'));
  });

  await test("déconnexion : le bouton danger existe ; une erreur s'affiche dans une zone d'alerte", async () => {
    const { store, account } = await accountStore({ local: { signOut: async () => { throw new Error("Trousseau refusé"); } } });
    assert.ok(/id="logout"[^>]*class="settings-btn danger"[^>]*>Se déconnecter</.test(accountPanel(store)));
    assert.ok(!accountPanel(store).includes("Trousseau refusé"));
    await account.logout();
    assert.ok(/id="logout-status"[^>]*role="alert"[^>]*>[^<]*Trousseau refusé/.test(accountPanel(store)));
  });

  await test("onglets avec le Compte natif : même ordre, le Compte sélectionné", async () => {
    const { store } = await accountStore();
    const tabs = [...slice(html(store), '<nav id="settings-tablist"', "</nav>").matchAll(/<button[^>]*>/g)].map(match => match[0]);
    assert.deepEqual(tabs.map(tab => /aria-selected="true"/.test(tab)), [true, false, false, false]);
    assert.ok(/id="panel-account"/.test(html(store)) && !/id="panel-general"/.test(html(store)));
  });

  await test("le test détecte un écart : un texte ou une classe modifiés ne passent pas", () => {
    const out = panel(build());
    assert.notDeepEqual(texts(out.replace("Apparence", "Aspect")), texts(legacyGeneral));
    assert.notEqual(classes(elements(out.replace('class="settings-btn primary"', 'class="settings-btn"')).get("personalization-save").attrs.class), classes(elements(legacyGeneral).get("personalization-save").attrs.class));
  });

  console.log(`${count} tests de balisage de la fenêtre Paramètres : OK`);
} finally {
  await server.close();
}
