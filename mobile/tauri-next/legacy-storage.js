"use strict";
const originalOpenLibrary = openLibrary;

openLibrary = async function(initialKind) {
  await originalOpenLibrary(initialKind);
  const dialog = document.getElementById("file-library");
  if (!dialog) return;
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "storage-toggle"; toggle.textContent = "Fichiers enregistrés";
  toggle.setAttribute("aria-expanded", "false");
  const section = document.createElement("section"); section.className = "storage-panel"; section.hidden = true;
  const usage = document.createElement("p");
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const list = document.createElement("div"); list.className = "storage-list";
  const more = document.createElement("button"); more.type = "button"; more.textContent = "Charger plus"; more.hidden = true;
  section.append(usage, status, list, more);
  dialog.querySelector("header").after(toggle, section);
  let cursor = ""; let loaded = false; let loading = false;
  const session = store.session;
  const sessionActive = () => Boolean(session) && store.session === session;

  async function loadUsage() {
    try {
      const data = await settingsApi("/filesv2/usage");
      if (!sessionActive()) return;
      if (Number.isFinite(data?.usedBytes) && Number.isFinite(data?.maxBytes)) {
        const mb = value => (value / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
        usage.textContent = "Stockage utilisé : " + mb(data.usedBytes) + " Mo sur " + mb(data.maxBytes) + " Mo.";
      } else usage.textContent = "Quota de stockage indisponible.";
    } catch (error) { usage.textContent = "Quota indisponible : " + (error?.message || error); }
  }

  async function loadPage() {
    if (loading || !sessionActive()) return;
    loading = true; more.disabled = true; status.textContent = "Chargement des fichiers…";
    try {
      const page = await settingsApi("/filesv2?limit=30" + (cursor ? "&after=" + encodeURIComponent(cursor) : ""));
      if (!sessionActive()) return;
      if (!Array.isArray(page?.data)) throw new Error("Liste de fichiers non reconnue.");
      const next = typeof page.last_id === "string" ? page.last_id : "";
      if (page.has_more === true && (!next || next === cursor)) throw new Error("Curseur de pagination indisponible.");
      for (const file of page.data) {
        if (typeof file?.id !== "string" || !file.id) continue;
        const row = document.createElement("div"); row.className = "storage-row";
        const label = document.createElement("span"); label.textContent = typeof file.filename === "string" ? file.filename : "Fichier";
        const preview = document.createElement("button"); preview.type = "button"; preview.textContent = "Aperçu";
        preview.onclick = () => previewAttachment({ name: label.textContent, kind: "file", remoteKind: "file", remoteId: file.id });
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Supprimer";
        remove.onclick = async () => {
          if (!sessionActive()) { status.textContent = "La session a changé. Rouvre la bibliothèque."; return; }
          if (!confirm("Supprimer ce fichier du stockage France Student ?")) return;
          if (!sessionActive()) return;
          remove.disabled = true;
          try {
            const result = await settingsApi("/filesv2/" + encodeURIComponent(file.id), { method: "DELETE" });
            if (result?.deleted !== true) throw new Error("Suppression non confirmée par le serveur.");
            row.remove(); await loadUsage(); status.textContent = "Fichier supprimé du stockage.";
          } catch (error) { status.textContent = "Suppression impossible : " + (error?.message || error); }
          finally { remove.disabled = false; }
        };
        row.append(label, preview, remove); list.append(row);
      }
      cursor = next; more.hidden = page.has_more !== true;
      status.textContent = list.childElementCount ? "" : "Aucun fichier enregistré.";
      loaded = true;
    } catch (error) { status.textContent = "Chargement impossible : " + (error?.message || error); more.hidden = false; more.textContent = "Réessayer"; }
    finally { loading = false; more.disabled = false; }
  }

  more.onclick = () => { more.textContent = "Charger plus"; void loadPage(); };
  toggle.onclick = () => {
    if (!sessionActive()) { status.textContent = "La session a changé. Rouvre la bibliothèque."; return; }
    section.hidden = !section.hidden;
    toggle.setAttribute("aria-expanded", String(!section.hidden));
    if (!section.hidden && !loaded && !loading) { void loadUsage(); void loadPage(); }
  };
};
