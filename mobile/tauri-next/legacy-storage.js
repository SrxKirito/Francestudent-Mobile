"use strict";
const originalOpenLibrary = openLibrary;
let releaseStorageSubscription = null;

openLibrary = async function(initialKind) {
  await originalOpenLibrary(initialKind);
  const dialog = document.getElementById("file-library");
  if (!dialog) return;
  // Même cache que l'onglet Stockage des paramètres : une seule liste, un seul quota.
  const filesStore = globalThis.tauriFilesStore?.getShared({
    api: (path, options) => settingsApi(path, options),
    getSession: () => store.session
  });
  if (!filesStore) return;
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
  let loading = false;
  let rows = new Map();
  const session = store.session;
  const sessionActive = () => Boolean(session) && store.session === session;
  const describe = error => error?.message || error;

  function renderUsage(data) {
    if (data) {
      const mb = value => (value / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
      usage.textContent = "Stockage utilisé : " + mb(data.usedBytes) + " Mo sur " + mb(data.maxBytes) + " Mo.";
    } else usage.textContent = "Quota de stockage indisponible.";
  }

  async function loadUsage(force) {
    try {
      const data = await filesStore.fetchUsage({ force });
      if (!sessionActive() || data?.stale) return;
      renderUsage(filesStore.usage());
    } catch (error) {
      if (sessionActive()) usage.textContent = /non reconnu/.test(String(describe(error))) ? "Quota de stockage indisponible." : "Quota indisponible : " + describe(error);
    }
  }

  function fileRow(file) {
    const row = document.createElement("div"); row.className = "storage-row";
    const label = document.createElement("span"); label.textContent = typeof file.filename === "string" ? file.filename : "Fichier";
    const preview = document.createElement("button"); preview.type = "button"; preview.textContent = "Aperçu";
    preview.onclick = () => previewAttachment({ name: label.textContent, kind: "file", remoteKind: "file", remoteId: file.id, size: file.bytes });
    const download = document.createElement("button"); download.type = "button"; download.textContent = "Télécharger";
    download.onclick = () => { if (!sessionActive()) { status.textContent = "La session a changé. Rouvre la bibliothèque."; return; } void downloadTauriRemoteFile({ name: label.textContent, remoteId: file.id }); };
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Supprimer";
    remove.onclick = async () => {
      if (!sessionActive()) { status.textContent = "La session a changé. Rouvre la bibliothèque."; return; }
      if (!confirm("Supprimer ce fichier du stockage France Student ?")) return;
      if (!sessionActive()) return;
      remove.disabled = true;
      try {
        await filesStore.remove(file.id);
        if (sessionActive()) { syncList(); renderUsage(filesStore.usage()); status.textContent = "Fichier supprimé du stockage."; }
      } catch (error) { status.textContent = "Suppression impossible : " + describe(error); }
      finally { remove.disabled = false; }
    };
    row.append(label, preview, remove, download);
    return row;
  }

  function syncList() {
    const next = new Map();
    const ordered = [];
    for (const file of filesStore.files()) {
      const known = rows.get(file.id);
      const entry = known && known.file === file ? known : { file, row: fileRow(file) };
      next.set(file.id, entry); ordered.push(entry.row);
    }
    rows = next;
    list.replaceChildren(...ordered);
    if (filesStore.isLoaded()) more.hidden = !filesStore.hasMore();
  }

  async function load(action) {
    if (loading || !sessionActive()) return;
    loading = true; more.disabled = true; status.textContent = "Chargement des fichiers…";
    try {
      const result = await action();
      if (!sessionActive() || result?.stale) return;
      syncList();
      more.hidden = !filesStore.hasMore();
      status.textContent = filesStore.files().length ? "" : "Aucun fichier enregistré.";
    } catch (error) {
      if (sessionActive()) { status.textContent = "Chargement impossible : " + describe(error); more.hidden = false; more.textContent = "Réessayer"; }
    } finally { loading = false; more.disabled = false; }
  }

  more.onclick = () => { more.textContent = "Charger plus"; void load(() => filesStore.loadMore()); };
  toggle.onclick = () => {
    if (!sessionActive()) { status.textContent = "La session a changé. Rouvre la bibliothèque."; return; }
    section.hidden = !section.hidden;
    toggle.setAttribute("aria-expanded", String(!section.hidden));
    if (section.hidden || loading) return;
    // Liste déjà en cache (ouverte ailleurs) : affichage immédiat, rechargement seulement si périmée.
    if (filesStore.isLoaded()) { syncList(); renderUsage(filesStore.usage()); }
    void loadUsage(false);
    void load(() => filesStore.ensureLoaded());
  };

  // Un seul abonnement actif : la bibliothèque est recréée à chaque ouverture.
  if (releaseStorageSubscription) releaseStorageSubscription();
  releaseStorageSubscription = filesStore.subscribe(event => {
    if (section.hidden) return;
    if (event.type === "reset") {
      rows = new Map(); list.replaceChildren(); more.hidden = true;
      if (!sessionActive()) status.textContent = "La session a changé. Rouvre la bibliothèque.";
    } else if (!sessionActive()) return;
    else if (event.type === "files") syncList();
    else if (event.type === "usage") renderUsage(filesStore.usage());
  });
};
