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

  // Recherche, type et tri : appliqués aux fichiers déjà chargés (la liste serveur est paginée).
  const view = { query: "", kind: "*", sort: "date-desc" };
  const controls = document.createElement("div"); controls.className = "storage-controls";
  const search = document.createElement("input");
  search.type = "search"; search.placeholder = "Rechercher un fichier"; search.setAttribute("aria-label", "Rechercher dans les fichiers enregistrés");
  search.setAttribute("enterkeyhint", "search"); search.setAttribute("autocomplete", "off");
  const choose = (label, options) => {
    const select = document.createElement("select"); select.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option);
    }
    return select;
  };
  const kindSelect = choose("Filtrer par type", [["*", "Tous les types"], ["image", "Images"], ["document", "Documents"], ["presentation", "PowerPoint"], ["code", "Code"], ["other", "Autres"]]);
  const sortSelect = choose("Trier les fichiers", [["date-desc", "Plus récents"], ["date-asc", "Plus anciens"], ["size-desc", "Plus volumineux"], ["size-asc", "Plus petits"], ["name-asc", "Nom A → Z"], ["name-desc", "Nom Z → A"]]);
  controls.append(search, kindSelect, sortSelect);

  section.append(usage, controls, status, list, more);
  dialog.querySelector("header").after(toggle, section);
  let loading = false;
  let rows = new Map();
  const session = store.session;
  const sessionActive = () => Boolean(session) && store.session === session;
  const describe = error => error?.message || error;

  // Vignettes : bornées (octets, mémoire, requêtes simultanées) et chargées seulement pour les lignes visibles.
  const thumbs = globalThis.tauriFileThumbnails?.create({
    fetchBlob: (file, options) => tauriThumbnailBlob(file, options),
    createUrl: (blob, mime) => URL.createObjectURL(blob.type === mime ? blob : new Blob([blob], { type: mime })),
    revokeUrl: url => URL.revokeObjectURL(url)
  });
  const starters = new Map();
  const observer = thumbs && typeof IntersectionObserver === "function"
    ? new IntersectionObserver(observed => {
      for (const item of observed) {
        if (!item.isIntersecting) continue;
        observer.unobserve(item.target);
        const start = starters.get(item.target);
        if (start) start();
      }
    }, { rootMargin: "160px" })
    : null;
  const iconLabel = name => globalThis.tauriFileThumbnails?.iconLabel(name) || "FICHIER";

  function fileThumbnail(file) {
    const box = document.createElement("div");
    box.className = "storage-thumb"; box.setAttribute("aria-hidden", "true");
    const name = typeof file.filename === "string" ? file.filename : "";
    const showIcon = reason => {
      const label = document.createElement("span"); label.textContent = iconLabel(name);
      box.replaceChildren(label);
      box.setAttribute("data-state", reason || "icon");
    };
    showIcon();
    let controller = null, held = null, started = false, disposed = false;
    async function start() {
      if (started || disposed) return;
      started = true; controller = new AbortController();
      try {
        const result = await thumbs.request(file, { signal: controller.signal });
        if (disposed) { result.release(); return; }
        held = result;
        if (result.type === "image") {
          const image = document.createElement("img");
          image.alt = ""; image.decoding = "async"; image.draggable = false;
          image.onerror = () => showIcon("error");
          image.src = result.url;
          box.replaceChildren(image); box.setAttribute("data-state", "image");
        } else if (result.type === "text") {
          const text = document.createElement("pre"); text.textContent = result.text;
          box.replaceChildren(text); box.setAttribute("data-state", "text");
        } else showIcon(result.reason);
      } catch { /* annulée, ou erreur déjà traduite en icône : l'icône reste affichée */ }
    }
    const requestable = Boolean(thumbs) && thumbs.plan(file).kind !== "icon";
    if (requestable && observer) { starters.set(box, start); observer.observe(box); }
    return {
      element: box,
      dispose() {
        disposed = true; starters.delete(box);
        observer?.unobserve(box);
        controller?.abort();
        if (held) { held.release(); held = null; }
      }
    };
  }

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

  function fileRow(file, thumbnail) {
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
    row.append(thumbnail.element, label, preview, remove, download);
    return row;
  }

  function summary() {
    const all = filesStore.files();
    if (!all.length) return filesStore.isLoaded() ? "Aucun fichier enregistré." : "";
    const shown = list.childElementCount;
    const partial = filesStore.hasMore();
    const filtering = view.query.trim() !== "" || view.kind !== "*";
    if (!shown) return "Aucun fichier ne correspond" + (partial ? " parmi les " + all.length + " fichiers chargés. Charge-en davantage pour élargir la recherche." : ".");
    if (filtering && partial) return shown + " fichier(s) sur " + all.length + " chargés ; d’autres restent à charger.";
    if (view.sort !== "date-desc" && partial) return "Tri appliqué aux " + all.length + " fichiers déjà chargés.";
    return "";
  }

  function disposeRows() {
    for (const entry of rows.values()) entry.thumbnail.dispose();
    rows = new Map();
  }

  function syncList() {
    const next = new Map();
    const ordered = [];
    for (const file of globalThis.tauriFilesStore.arrange(filesStore.files(), view)) {
      const known = rows.get(file.id);
      let entry = known && known.file === file ? known : null;
      if (!entry) { const thumbnail = fileThumbnail(file); entry = { file, thumbnail, row: fileRow(file, thumbnail) }; }
      next.set(file.id, entry); ordered.push(entry.row);
    }
    // Les lignes retirées (suppression, filtre, rechargement) libèrent leur vignette.
    for (const [id, entry] of rows) if (next.get(id) !== entry) entry.thumbnail.dispose();
    rows = next;
    list.replaceChildren(...ordered);
    if (filesStore.isLoaded()) more.hidden = !filesStore.hasMore();
  }

  function refreshView() {
    syncList();
    if (!loading && filesStore.isLoaded()) status.textContent = summary();
  }
  search.oninput = () => { view.query = search.value; refreshView(); };
  kindSelect.onchange = () => { view.kind = kindSelect.value; refreshView(); };
  sortSelect.onchange = () => { view.sort = sortSelect.value; refreshView(); };

  async function load(action) {
    if (loading || !sessionActive()) return;
    loading = true; more.disabled = true; status.textContent = "Chargement des fichiers…";
    try {
      const result = await action();
      if (!sessionActive() || result?.stale) return;
      syncList();
      more.hidden = !filesStore.hasMore();
      status.textContent = summary();
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
  const release = filesStore.subscribe(event => {
    if (section.hidden) return;
    if (event.type === "reset") {
      disposeRows(); thumbs?.clear(); list.replaceChildren(); more.hidden = true;
      if (!sessionActive()) status.textContent = "La session a changé. Rouvre la bibliothèque.";
    } else if (!sessionActive()) return;
    else if (event.type === "files") refreshView();
    else if (event.type === "usage") renderUsage(filesStore.usage());
  });
  releaseStorageSubscription = release;

  // Fermeture : plus aucune URL d'objet, requête de vignette ni observateur ne survit à la bibliothèque.
  if (typeof dialog.addEventListener === "function") {
    dialog.addEventListener("close", () => {
      disposeRows(); thumbs?.clear(); observer?.disconnect(); starters.clear();
      release();
      if (releaseStorageSubscription === release) releaseStorageSubscription = null;
    }, { once: true });
  }
};
