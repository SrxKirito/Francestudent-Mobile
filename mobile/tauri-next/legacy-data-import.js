"use strict";

// Asks the native side to open the import-only page at the next launch. The
// import itself never runs inside this window: no chat code may write to the
// local stores while a backup is restored.
(() => {
  const transport = window.parent && window.parent.__franceStudentTransport;
  const panel = document.getElementById("panel-account");
  if (!transport || typeof transport.scheduleMigration !== "function" || !panel) return;
  const section = document.createElement("section");
  section.className = "account-activity";
  section.innerHTML = '<h3 class="settings-section-title">Données de l’ancienne application</h3><p class="settings-hint" data-status>Importe une sauvegarde chiffrée (.fsbackup) créée depuis l’ancienne application. Rien n’est écrasé.</p><button type="button" class="settings-btn small" data-schedule>Importer mes données</button>';
  const actions = panel.querySelector(".settings-actions");
  if (actions) actions.prepend(section); else panel.append(section);
  const status = section.querySelector("[data-status]");
  const button = section.querySelector("[data-schedule]");
  button.onclick = async () => {
    if (!window.confirm("L’import s’ouvrira au prochain lancement. Ferme ensuite complètement l’application puis rouvre-la. Continuer ?")) return;
    button.disabled = true;
    try {
      await transport.scheduleMigration();
      status.textContent = "Import programmé. Ferme complètement l’application puis rouvre-la : la page d’import s’ouvrira.";
    } catch (error) {
      status.textContent = "Import impossible : " + (error?.message || error);
      button.disabled = false;
    }
  };
})();
