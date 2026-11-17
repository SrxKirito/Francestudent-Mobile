/** Attach only where the host supplies a real mutation lock and temporary writer. */
export function mountMigrationUI({ document, container, host }) {
  if (!document || !container || !host) throw new Error("Interface de transfert indisponible.");
  const section = document.createElement("section");
  const heading = document.createElement("h3"); heading.textContent = "Transférer les données locales";
  const help = document.createElement("p"); help.textContent = "La sauvegarde est chiffrée. Conserve sa phrase de sauvegarde : elle est nécessaire à la restauration.";
  const label = document.createElement("label"); label.textContent = "Phrase de sauvegarde (12 caractères minimum)";
  const password = document.createElement("input"); password.type = "password"; password.autocomplete = "off"; password.minLength = 12;
  label.append(password);
  const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.textContent = "Créer une sauvegarde";
  const fileLabel = document.createElement("label"); fileLabel.textContent = "Sauvegarde à importer";
  const file = document.createElement("input"); file.type = "file"; file.accept = ".fsbackup,application/octet-stream"; fileLabel.append(file);
  const inspectButton = document.createElement("button"); inspectButton.type = "button"; inspectButton.textContent = "Vérifier la sauvegarde";
  const restoreButton = document.createElement("button"); restoreButton.type = "button"; restoreButton.textContent = "Importer sans écraser";
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  section.append(heading, help, label, exportButton, fileLabel, inspectButton, restoreButton, status);
  container.append(section);
  let busy = false;
  async function run(action) {
    if (busy) return;
    if (password.value.length < 12) { status.textContent = "Saisis une phrase d’au moins 12 caractères."; return; }
    const secret = password.value;
    busy = true; exportButton.disabled = inspectButton.disabled = restoreButton.disabled = true;
    status.textContent = "Opération en cours…";
    try { await action(secret); }
    catch (error) { status.textContent = "Opération impossible : " + (error?.message || error); }
    finally { password.value = ""; busy = false; exportButton.disabled = inspectButton.disabled = restoreButton.disabled = false; }
  }
  function selected() { const item = file.files?.[0]; if (!item) throw new Error("Choisis une sauvegarde."); return item; }
  exportButton.onclick = () => run(async secret => { await host.export(secret); status.textContent = "Sauvegarde créée. Les données d’origine sont conservées."; });
  inspectButton.onclick = () => run(async secret => {
    const result = await host.inspect(selected(), secret);
    status.textContent = result.conflicts.length ? `${result.conflicts.length} conflit(s) détecté(s). Aucune donnée n’a été modifiée.` : `${result.records} élément(s) vérifié(s), sans conflit.`;
  });
  restoreButton.onclick = () => run(async secret => {
    const result = await host.restore(selected(), secret);
    status.textContent = result.restored ? "Import terminé. La sauvegarde et les données d’origine sont conservées." : `${result.conflicts.length} conflit(s) détecté(s). Aucun écrasement effectué.`;
  });
  return { section, destroy() { password.value = ""; section.remove(); } };
}
