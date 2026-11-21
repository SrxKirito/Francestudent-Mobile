"use strict";

// Choix de l'interface dans Paramètres > Général : classique (iframe historique) ou Svelte 5 (bêta).
// Le réglage est lu par la page parente (App.svelte) au démarrage : on écrit donc ses clés locales puis on la recharge.
// Svelte 5 est l'interface par défaut ; l'interface classique est la clé fs-ui = "legacy" (et le chat historique fs-chat = "legacy").
// Les règles ci-dessous reprennent celles de src/lib/utils/ui-flag.ts (test-interface-settings.cjs les fige).

function tauriInterfaceRead(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function tauriInterfaceState(search, storage) {
  const params = new URLSearchParams(search);
  const askedUi = params.get("ui");
  const ui = askedUi === "svelte" || askedUi === "legacy" ? askedUi : (tauriInterfaceRead(storage, "fs-ui") === "legacy" ? "legacy" : "svelte");
  if (ui !== "svelte") return { ui, chat: false };
  const askedChat = params.get("chat");
  const chat = askedChat === "svelte" || askedChat === "legacy" ? askedChat === "svelte" : tauriInterfaceRead(storage, "fs-chat") !== "legacy";
  return { ui, chat };
}

// Enregistre le choix et renvoie l'adresse à ouvrir (sans ?ui ni ?chat, qui l'emporteraient sur le réglage), ou null
// si l'adresse est invalide ou si le stockage refuse l'écriture (les anciennes valeurs sont alors restaurées).
function tauriInterfaceApply(choice, storage, href) {
  let next;
  try {
    const url = new URL(href);
    url.searchParams.delete("ui");
    url.searchParams.delete("chat");
    next = url.href;
  } catch { return null; }
  const wanted = { "fs-ui": choice.ui === "svelte" ? "svelte" : "legacy", "fs-chat": choice.ui !== "svelte" ? null : (choice.chat ? "svelte" : "legacy") };
  const before = { "fs-ui": tauriInterfaceRead(storage, "fs-ui"), "fs-chat": tauriInterfaceRead(storage, "fs-chat") };
  const write = (key, value) => { if (value === null) storage.removeItem(key); else storage.setItem(key, value); };
  try {
    write("fs-ui", wanted["fs-ui"]);
    write("fs-chat", wanted["fs-chat"]);
  } catch {
    for (const key of ["fs-ui", "fs-chat"]) { try { write(key, before[key]); } catch { /* stockage refusé : rien de plus à faire */ } }
    return null;
  }
  return next;
}

(() => {
  const panel = document.getElementById("panel-general");
  if (!panel || typeof window === "undefined" || window.parent === window) return;
  let parentWindow;
  try { parentWindow = window.parent; void parentWindow.location.search; void parentWindow.localStorage; } catch { return; }
  const section = document.createElement("section");
  section.className = "tauri-interface-choice";
  section.innerHTML = '<h3 class="settings-section-title" id="tauri-interface-label">Interface</h3>'
    + '<div class="theme-choices tauri-interface-choices" style="grid-template-columns: repeat(2, 1fr)" role="radiogroup" aria-labelledby="tauri-interface-label">'
    + '<button type="button" class="theme-choice" data-ui-choice="legacy" role="radio" aria-checked="false"><span>Interface classique</span></button>'
    + '<button type="button" class="theme-choice" data-ui-choice="svelte" role="radio" aria-checked="false"><span>Interface Svelte 5 (bêta)</span></button>'
    + '</div>'
    + '<button type="button" class="settings-btn small" data-ui-chat role="switch" aria-checked="false" hidden>Utiliser aussi le nouveau chat (bêta)</button>'
    + '<p class="settings-hint" data-ui-status role="status">L’interface Svelte 5 est en cours de migration. Tu peux revenir à l’interface classique ici à tout moment.</p>';
  const anchor = panel.querySelector(".library-layout-choices");
  if (anchor) anchor.after(section); else panel.append(section);
  const choices = [...section.querySelectorAll("[data-ui-choice]")];
  const chatButton = section.querySelector("[data-ui-chat]");
  const status = section.querySelector("[data-ui-status]");

  function current() { return tauriInterfaceState(parentWindow.location.search, parentWindow.localStorage); }
  function refresh() {
    const state = current();
    for (const button of choices) button.setAttribute("aria-checked", button.dataset.uiChoice === state.ui ? "true" : "false");
    chatButton.hidden = state.ui !== "svelte";
    chatButton.setAttribute("aria-checked", state.chat ? "true" : "false");
  }
  function choose(choice) {
    const state = current();
    if (choice.ui === state.ui && choice.chat === state.chat) return;
    if (typeof busy !== "undefined" && busy) { status.textContent = "Attends la fin de la réponse en cours avant de changer d’interface."; return; }
    const href = tauriInterfaceApply(choice, parentWindow.localStorage, parentWindow.location.href);
    if (!href) { status.textContent = "Changement impossible : le stockage local de l’application est refusé."; refresh(); return; }
    status.textContent = "Rechargement de l’interface…";
    parentWindow.location.replace(href);
  }
  // Depuis l'interface classique, choisir Svelte active aussi son chat (valeur par défaut) ; sinon on garde le choix du chat.
  for (const button of choices) button.addEventListener("click", () => {
    const state = current();
    choose({ ui: button.dataset.uiChoice, chat: button.dataset.uiChoice === "svelte" && (state.ui === "svelte" ? state.chat : true) });
  });
  chatButton.addEventListener("click", () => choose({ ui: "svelte", chat: !current().chat }));
  refresh();
  const modal = document.getElementById("settings-modal");
  if (modal) new MutationObserver(refresh).observe(modal, { attributes: true, attributeFilter: ["class"] });
})();
