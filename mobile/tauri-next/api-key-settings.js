"use strict";

// API keys are shown once and never added to the application store.
(() => {
  const panel = document.getElementById("panel-account");
  const modal = document.getElementById("settings-modal");
  if (!panel || !modal) return;
  const section = document.createElement("section");
  section.className = "account-activity";
  section.innerHTML = '<h3 class="settings-section-title">Clé API</h3><p class="settings-hint" data-status>Consulte ta clé et ton budget API.</p><p data-key hidden></p><button type="button" class="settings-btn small" data-load>Consulter</button> <button type="button" class="settings-btn small" data-create>Générer une clé</button> <button type="button" class="settings-btn small danger" data-revoke>Révoquer</button>';
  const actions = panel.querySelector(".settings-actions");
  if (actions) actions.prepend(section); else panel.append(section);
  const status = section.querySelector("[data-status]");
  const key = section.querySelector("[data-key]");
  const buttons = [...section.querySelectorAll("button")];
  let generation = 0;
  function clearKey() { key.textContent = ""; key.hidden = true; }
  function clear() { generation++; clearKey(); status.textContent = "Consulte ta clé et ton budget API."; }
  new MutationObserver(() => { if (modal.classList.contains("hidden") || modal.classList.contains("is-closing")) clear(); }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  document.getElementById("logout")?.addEventListener("click", clear);
  async function request(method) {
    const session = store.session;
    const current = ++generation;
    clearKey();
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = "Chargement…";
    try {
      const result = await settingsApi("/user/@me/api-key", { method });
      if (current !== generation || session !== store.session || !settingsOpen()) return;
      if (method === "DELETE") { status.textContent = "Clé API révoquée."; return; }
      if (method === "POST" && typeof result?.key === "string" && result.key) {
        key.textContent = result.key; key.hidden = false;
        status.textContent = "Copie cette clé maintenant : elle ne sera plus affichée en clair.";
      } else {
        const budget = result?.budget;
        status.textContent = (result?.maskedKey ? "Clé : " + result.maskedKey + ". " : "Aucune clé affichée. ") + (typeof budget?.remainingUsd === "number" ? "Budget restant : " + budget.remainingUsd + " $." : "");
      }
    } catch (error) {
      if (current === generation && session === store.session) status.textContent = "Opération impossible : " + (error?.message || error);
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  section.querySelector("[data-load]").onclick = () => void request("GET");
  section.querySelector("[data-create]").onclick = () => { if (window.confirm("Générer une clé remplacera la clé existante. Continuer ?")) void request("POST"); };
  section.querySelector("[data-revoke]").onclick = () => { if (window.confirm("Révoquer la clé API actuelle ?")) void request("DELETE"); };
})();
