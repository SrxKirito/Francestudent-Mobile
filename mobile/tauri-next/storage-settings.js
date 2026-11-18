"use strict";
// Onglet « Stockage » des paramètres : quota Files v2, catégories et gestion des fichiers.
// Toutes les valeurs affichées viennent du serveur ; rien n'est estimé ni inventé côté client.
(() => {
  const PAGE_SIZE = 30;
  const ARCHIVE_PROBE = 50;
  const NBSP = "\u00a0";
  const SESSION_CHANGED = "La session a changé. Rouvre l'onglet Stockage.";

  function finiteBytes(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function formatBytes(value) {
    const bytes = finiteBytes(value);
    if (bytes === null) return "—";
    const units = ["o", "Ko", "Mo", "Go", "To"];
    let amount = bytes, index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    const text = index === 0 ? String(Math.round(amount)) : amount.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    return text + NBSP + units[index];
  }

  function formatDate(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
    const date = new Date(value < 1e11 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("fr-FR");
  }

  function plural(count, one, many) { return count + " " + (count > 1 ? many : one); }

  function parseUsage(data) {
    if (!data || typeof data !== "object") return null;
    const used = finiteBytes(data.usedBytes), max = finiteBytes(data.maxBytes);
    if (used === null || max === null) return null;
    const remaining = finiteBytes(data.remainingBytes) ?? Math.max(0, max - used);
    return {
      used, max, remaining,
      percent: max > 0 ? Math.min(100, (used / max) * 100) : 0,
      full: max > 0 && used >= max,
      files: finiteBytes(data.filesBytes),
      skills: finiteBytes(data.skillsBytes)
    };
  }

  function describeError(error) {
    const message = error && typeof error.message === "string" ? error.message : "";
    return message || "Erreur inconnue.";
  }

  async function attempt(call, map) {
    try { return { ok: true, value: map(await call()) }; }
    catch (error) { return { ok: false, error: describeError(error) }; }
  }

  function usageOrThrow(data) {
    const parsed = parseUsage(data);
    if (!parsed) throw new Error("Quota de stockage non reconnu.");
    return parsed;
  }

  // Chaque catégorie est chargée indépendamment : une erreur n'invalide pas les autres.
  async function loadOverview(api) {
    const [usage, images, archived] = await Promise.all([
      attempt(() => api("/filesv2/usage"), usageOrThrow),
      attempt(() => api("/files"), data => {
        if (!Array.isArray(data)) throw new Error("Liste d'images non reconnue.");
        return { count: data.length };
      }),
      attempt(() => api("/chats/archived?limit=" + ARCHIVE_PROBE), data => {
        if (!Array.isArray(data?.chats)) throw new Error("Liste des archives non reconnue.");
        return { count: data.chats.length, more: data.hasMore === true };
      })
    ]);
    return { usage, images, archived };
  }

  function createController(deps) {
    const { doc, root, api, getSession } = deps;
    const state = { overview: null, overviewGen: 0, filesGen: 0, session: "", cursor: "", loading: false };
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    };
    const button = (label, className) => {
      const node = el("button", className || "settings-btn", label);
      node.type = "button";
      return node;
    };
    const status = () => { const node = el("p", "ss-status"); node.setAttribute("role", "status"); return node; };
    const sessionOk = session => Boolean(session) && getSession() === session;

    const title = el("h3", "settings-section-title", "Stockage");
    const hint = el("p", "settings-hint", "Ces chiffres viennent de ton compte France Student.");

    const overview = el("div", "ss-overview");
    const usageText = el("p", "ss-usage-text");
    const meter = el("div", "ss-meter");
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-label", "Stockage utilisé");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    const fill = el("div", "ss-meter-fill");
    meter.append(fill);
    meter.hidden = true;
    const remainingText = el("p", "ss-remaining");
    const categories = el("div", "ss-categories");
    const refreshButton = button("Actualiser", "settings-btn ss-refresh");
    const overviewStatus = status();
    overview.append(usageText, meter, remainingText, categories, refreshButton, overviewStatus);

    const detail = el("div", "ss-detail");
    detail.hidden = true;
    const back = button("← Stockage", "settings-btn ss-back");
    const detailTitle = el("h4", "ss-detail-title", "Fichiers enregistrés");
    const detailStatus = status();
    const list = el("div", "ss-list");
    const more = button("Charger plus", "settings-btn ss-more");
    more.hidden = true;
    detail.append(back, detailTitle, detailStatus, list, more);

    root.append(title, hint, overview, detail);

    function renderUsage(result) {
      if (!result || !result.ok) {
        meter.hidden = true;
        usageText.textContent = "Quota indisponible" + (result && result.error ? " : " + result.error : ".");
        remainingText.textContent = "";
        return;
      }
      const usage = result.value;
      usageText.textContent = formatBytes(usage.used) + " utilisés sur " + formatBytes(usage.max);
      meter.hidden = false;
      meter.className = "ss-meter" + (usage.percent >= 90 ? " is-high" : "");
      meter.setAttribute("aria-valuenow", String(Math.round(usage.percent)));
      fill.style.width = usage.percent + "%";
      remainingText.textContent = usage.full
        ? "Stockage plein : supprime des fichiers pour en envoyer de nouveaux."
        : formatBytes(usage.remaining) + " disponibles";
    }

    function category(name, detailText, isError, action, actionLabel) {
      const row = el(action ? "button" : "div", "ss-category" + (isError ? " is-error" : ""));
      if (action) { row.type = "button"; row.onclick = action; row.setAttribute("aria-label", actionLabel + " : " + name); }
      row.append(el("span", "ss-category-name", name), el("span", "ss-category-detail", detailText));
      return row;
    }

    function renderCategories(data) {
      const { usage, images, archived } = data;
      const unavailable = result => "Indisponible : " + result.error;
      const sizeOf = key => usage.ok ? (usage.value[key] === null ? "Taille non fournie" : formatBytes(usage.value[key])) : unavailable(usage);
      const archivedText = !archived.ok ? unavailable(archived)
        : plural(archived.value.count, "conversation archivée", "conversations archivées").replace(/^\d+/, digits => digits + (archived.value.more ? "+" : ""));
      const canOpenArchived = archived.ok && typeof deps.canOpenArchived === "function" && deps.canOpenArchived();
      categories.replaceChildren(
        category("Fichiers", sizeOf("files"), !usage.ok, () => openFiles(), "Voir"),
        category("Images", images.ok ? plural(images.value.count, "image", "images") + " · taille non fournie" : unavailable(images), !images.ok),
        category("Conversations archivées", archivedText, !archived.ok, canOpenArchived ? () => deps.openArchived() : null, "Ouvrir"),
        category("Skills", sizeOf("skills"), !usage.ok, typeof deps.openSkills === "function" ? () => deps.openSkills() : null, "Ouvrir")
      );
    }

    function renderOverview(data) {
      state.overview = data;
      renderUsage(data.usage);
      renderCategories(data);
      const failures = [data.usage, data.images, data.archived].filter(result => !result.ok).length;
      overviewStatus.textContent = failures ? "Certaines informations n'ont pas pu être chargées." : "";
    }

    function showView(name) {
      overview.hidden = name !== "overview";
      detail.hidden = name !== "detail";
    }

    async function refresh() {
      const session = getSession();
      const generation = ++state.overviewGen;
      if (!session) {
        usageText.textContent = "Connecte-toi pour voir ton stockage.";
        meter.hidden = true; remainingText.textContent = ""; overviewStatus.textContent = "";
        categories.replaceChildren();
        return;
      }
      overviewStatus.textContent = "Chargement…";
      refreshButton.disabled = true;
      try {
        const data = await loadOverview(api);
        if (generation !== state.overviewGen) return;
        if (!sessionOk(session)) { overviewStatus.textContent = SESSION_CHANGED; return; }
        renderOverview(data);
      } finally {
        if (generation === state.overviewGen) refreshButton.disabled = false;
      }
    }

    async function refreshUsageOnly(session) {
      const result = await attempt(() => api("/filesv2/usage"), usageOrThrow);
      if (!sessionOk(session) || !state.overview) return;
      state.overview.usage = result;
      renderUsage(result);
      renderCategories(state.overview);
    }

    function fileRow(file, session) {
      const name = typeof file.filename === "string" && file.filename ? file.filename : "Fichier";
      const row = el("div", "ss-row");
      const info = el("div", "ss-row-info");
      const meta = [formatBytes(file.bytes), formatDate(file.created_at)].filter(part => part && part !== "—");
      if (file.isValid === false) meta.push("fichier invalide");
      info.append(el("span", "ss-row-name", name), el("span", "ss-row-meta", meta.join(" · ")));
      const preview = button("Aperçu", "settings-btn small");
      preview.onclick = () => {
        if (!sessionOk(session)) { detailStatus.textContent = SESSION_CHANGED; return; }
        deps.previewFile({ name, kind: "file", remoteKind: "file", remoteId: file.id, size: file.bytes });
      };
      const download = button("Télécharger", "settings-btn small");
      download.onclick = () => {
        if (!sessionOk(session)) { detailStatus.textContent = SESSION_CHANGED; return; }
        void deps.downloadFile({ name, remoteId: file.id });
      };
      const remove = button("Supprimer", "settings-btn small danger");
      remove.onclick = async () => {
        if (!sessionOk(session)) { detailStatus.textContent = SESSION_CHANGED; return; }
        if (!deps.confirmAction("Supprimer « " + name + " » du stockage France Student ?")) return;
        if (!sessionOk(session)) return;
        remove.disabled = true;
        try {
          const result = await api("/filesv2/" + encodeURIComponent(file.id), { method: "DELETE" });
          if (result?.deleted !== true) throw new Error("Suppression non confirmée par le serveur.");
          row.remove();
          detailStatus.textContent = !list.childElementCount && more.hidden ? "Aucun fichier enregistré." : "Fichier supprimé du stockage.";
          await refreshUsageOnly(session);
        } catch (error) {
          detailStatus.textContent = "Suppression impossible : " + describeError(error);
        } finally { remove.disabled = false; }
      };
      const actions = el("div", "ss-row-actions");
      actions.append(preview, download, remove);
      row.append(info, actions);
      return row;
    }

    async function loadFilesPage() {
      const session = state.session, generation = state.filesGen;
      if (state.loading || !sessionOk(session)) return;
      state.loading = true; more.disabled = true; detailStatus.textContent = "Chargement des fichiers…";
      try {
        const page = await api("/filesv2?limit=" + PAGE_SIZE + (state.cursor ? "&after=" + encodeURIComponent(state.cursor) : ""));
        if (generation !== state.filesGen || !sessionOk(session)) return;
        if (!Array.isArray(page?.data)) throw new Error("Liste de fichiers non reconnue.");
        const next = typeof page.last_id === "string" ? page.last_id : "";
        if (page.has_more === true && (!next || next === state.cursor)) throw new Error("Curseur de pagination indisponible.");
        for (const file of page.data) {
          if (typeof file?.id === "string" && file.id) list.append(fileRow(file, session));
        }
        state.cursor = next;
        more.hidden = page.has_more !== true;
        more.textContent = "Charger plus";
        detailStatus.textContent = list.childElementCount ? "" : "Aucun fichier enregistré.";
      } catch (error) {
        if (generation === state.filesGen && sessionOk(session)) {
          detailStatus.textContent = "Chargement impossible : " + describeError(error);
          more.hidden = false; more.textContent = "Réessayer";
        }
      } finally {
        if (generation === state.filesGen) { state.loading = false; more.disabled = false; }
      }
    }

    function openFiles() {
      state.filesGen++;
      state.session = getSession();
      state.cursor = ""; state.loading = false;
      list.replaceChildren(); more.hidden = true; detailStatus.textContent = "";
      showView("detail");
      void loadFilesPage();
    }

    function reset() {
      state.overviewGen++; state.filesGen++;
      state.overview = null; state.loading = false;
      usageText.textContent = ""; meter.hidden = true; remainingText.textContent = "";
      categories.replaceChildren(); list.replaceChildren(); more.hidden = true;
      overviewStatus.textContent = ""; detailStatus.textContent = "";
      showView("overview");
    }

    async function show() {
      reset();
      await refresh();
    }

    refreshButton.onclick = () => { void refresh(); };
    back.onclick = () => { state.filesGen++; state.loading = false; showView("overview"); };
    more.onclick = () => { void loadFilesPage(); };

    return { show, refresh, openFiles, root, elements: { usageText, meter, fill, remainingText, categories, list, more, detailStatus, overviewStatus, refreshButton, back, overview, detail } };
  }

  function install(doc) {
    const tablist = doc.getElementById("settings-tablist");
    const panels = doc.querySelector("#settings-menu .settings-panels");
    if (!tablist || !panels || doc.getElementById("panel-storage")) return null;
    const tab = doc.createElement("button");
    tab.type = "button"; tab.className = "settings-tab"; tab.id = "tab-storage";
    tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "panel-storage");
    tab.setAttribute("aria-selected", "false"); tab.setAttribute("tabindex", "-1");
    tab.dataset.tab = "storage";
    const label = doc.createElement("span"); label.textContent = "Stockage";
    tab.append(label);
    const panel = doc.createElement("section");
    panel.id = "panel-storage"; panel.className = "settings-panel"; panel.dataset.panel = "storage";
    panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", "tab-storage");
    panel.hidden = true;
    tablist.append(tab); panels.append(panel);
    // L'état des autres scripts (store, archivedChats…) est lu au moment de l'appel, jamais au chargement.
    const archivedReady = () => typeof archivedChats === "object" && Boolean(archivedChats) && Boolean(archivedChats.toggle);
    return createController({
      doc, root: panel,
      api: (path, options) => settingsApi(path, options),
      getSession: () => (typeof store === "object" && store ? store.session : ""),
      confirmAction: message => confirm(message),
      previewFile: file => previewAttachment(file),
      downloadFile: file => downloadTauriRemoteFile(file),
      openSkills: () => { selectSettingsTab("skills", false); },
      canOpenArchived: archivedReady,
      openArchived: () => {
        if (!archivedReady()) return;
        if (typeof closeSettings === "function") closeSettings();
        if (!archivedChats.panel || archivedChats.panel.hidden !== false) archivedChats.toggle.click();
      }
    });
  }

  globalThis.tauriStorageSettings = { formatBytes, formatDate, parseUsage, loadOverview, createController, install };

  const controller = typeof document === "object" && document ? install(document) : null;
  if (controller && typeof selectSettingsTab === "function") {
    const original = selectSettingsTab;
    selectSettingsTab = function (name, focus) {
      const result = original.call(this, name, focus);
      if (name === "storage") void controller.show();
      return result;
    };
  }
})();
