"use strict";
// Couche de données commune des fichiers enregistrés (Files V2).
// Une seule source de vérité pour la bibliothèque et l'onglet Stockage :
//  - les fichiers sont indexés par identifiant serveur (jamais fusionnés par nom) ;
//  - la pagination est protégée contre les curseurs incohérents et les réponses en retard ;
//  - le quota est mis en cache brièvement et relu après une suppression ou un envoi ;
//  - tout est réinitialisé quand la session change.
// Aucune valeur n'est estimée côté client : ce qui n'est pas fourni par le serveur reste absent.
(() => {
  const PAGE_SIZE = 30;
  const USAGE_TTL_MS = 30000;
  const LIST_TTL_MS = 120000;

  function finiteBytes(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  function validateUsage(data) {
    if (!data || typeof data !== "object" || !finiteBytes(data.usedBytes) || !finiteBytes(data.maxBytes)) {
      throw new Error("Quota de stockage non reconnu.");
    }
    return { ...data };
  }

  function normalizeFile(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    return Object.freeze({ ...raw });
  }

  function create(options) {
    const { api, getSession } = options || {};
    if (typeof api !== "function" || typeof getSession !== "function") throw new TypeError("api et getSession sont requis.");
    const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : PAGE_SIZE;
    const usageTtl = Number.isFinite(options.usageTtlMs) ? options.usageTtlMs : USAGE_TTL_MS;
    const listTtl = Number.isFinite(options.listTtlMs) ? options.listTtlMs : LIST_TTL_MS;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const listeners = new Set();

    const blank = session => ({
      session, files: new Map(), cursor: "", hasMore: false, loaded: false, loadedAt: 0, stale: false, listGen: 0,
      moreInflight: null, reloadInflight: null, removing: new Map(),
      usage: null, usageAt: 0, usageGen: 0, usageInflight: null
    });
    let state = blank(getSession() || "");

    function emit(event) {
      for (const listener of [...listeners]) {
        try { listener(event); }
        catch (error) { if (typeof console === "object" && console) console.error("files-store : écouteur en erreur", error); }
      }
    }

    function sync() {
      const session = getSession() || "";
      if (session !== state.session) {
        state = blank(session);
        emit({ type: "reset" });
      }
      return session;
    }

    function requireSession() {
      if (!sync()) throw new Error("Connecte-toi pour accéder à tes fichiers.");
    }

    async function fetchPage(cursor) {
      const page = await api("/filesv2?limit=" + pageSize + (cursor ? "&after=" + encodeURIComponent(cursor) : ""));
      if (!Array.isArray(page?.data)) throw new Error("Liste de fichiers non reconnue.");
      const next = typeof page.last_id === "string" ? page.last_id : "";
      if (page.has_more === true && (!next || next === cursor)) throw new Error("Curseur de pagination indisponible.");
      return { items: page.data.map(normalizeFile).filter(Boolean), next, hasMore: page.has_more === true };
    }

    function isStale() {
      sync();
      return !state.loaded || state.stale || now() - state.loadedAt > listTtl;
    }

    // Charge la page suivante (ou la première si rien n'est chargé). Les appels simultanés partagent la même requête.
    async function loadMore() {
      requireSession();
      if (state.loaded && !state.hasMore) return { ok: true, added: 0 };
      if (state.moreInflight) return state.moreInflight;
      const current = state, generation = state.listGen, cursor = state.cursor;
      const run = (async () => {
        const page = await fetchPage(cursor);
        sync();
        if (current !== state || generation !== state.listGen) return { stale: true };
        let added = 0;
        for (const file of page.items) {
          if (!state.files.has(file.id)) added++;
          state.files.set(file.id, file);
        }
        state.cursor = page.next; state.hasMore = page.hasMore;
        // Charger une page de plus ne rend pas la première page plus fraîche : l'état « périmé » est conservé.
        if (!state.loaded) { state.loaded = true; state.loadedAt = now(); }
        emit({ type: "files" });
        return { ok: true, added };
      })();
      current.moreInflight = run;
      try { return await run; }
      finally { if (current.moreInflight === run) current.moreInflight = null; }
    }

    // Recharge depuis la première page. L'ancienne liste reste affichable tant que la réponse n'est pas arrivée.
    async function reload() {
      requireSession();
      if (state.reloadInflight) return state.reloadInflight;
      const current = state, generation = ++state.listGen;
      current.moreInflight = null;
      const run = (async () => {
        const page = await fetchPage("");
        sync();
        if (current !== state || generation !== state.listGen) return { stale: true };
        state.files = new Map(page.items.map(file => [file.id, file]));
        state.cursor = page.next; state.hasMore = page.hasMore;
        state.loaded = true; state.loadedAt = now(); state.stale = false;
        emit({ type: "files" });
        return { ok: true, added: page.items.length };
      })();
      current.reloadInflight = run;
      try { return await run; }
      finally { if (current.reloadInflight === run) current.reloadInflight = null; }
    }

    async function ensureLoaded() {
      requireSession();
      if (isStale()) return reload();
      return { ok: true, added: 0, cached: true };
    }

    // force : relit toujours le serveur (la réponse la plus récente gagne). Sinon : cache court + requête partagée.
    async function fetchUsage(opts) {
      requireSession();
      const current = state;
      if (!(opts && opts.force)) {
        if (current.usage && now() - current.usageAt < usageTtl) return current.usage;
        if (current.usageInflight) return current.usageInflight;
      }
      const generation = ++current.usageGen;
      const run = (async () => {
        const usage = validateUsage(await api("/filesv2/usage"));
        sync();
        if (current === state && generation === current.usageGen) {
          current.usage = usage; current.usageAt = now();
          emit({ type: "usage" });
        }
        return usage;
      })();
      current.usageInflight = run;
      try { return await run; }
      finally { if (current.usageInflight === run) current.usageInflight = null; }
    }

    // Suppression : le fichier n'est retiré du cache que si le serveur confirme `deleted: true`.
    async function remove(id) {
      requireSession();
      if (typeof id !== "string" || !id) throw new Error("Identifiant de fichier invalide.");
      const pending = state.removing.get(id);
      if (pending) return pending;
      const current = state;
      const run = (async () => {
        const result = await api("/filesv2/" + encodeURIComponent(id), { method: "DELETE" });
        if (result?.deleted !== true) throw new Error("Suppression non confirmée par le serveur.");
        sync();
        if (current === state) {
          state.files.delete(id);
          state.usageAt = 0;
          emit({ type: "files" });
          try { await fetchUsage({ force: true }); } catch { /* le quota reste marqué périmé */ }
        }
        return { deleted: true };
      })();
      current.removing.set(id, run);
      try { return await run; }
      finally { if (current.removing.get(id) === run) current.removing.delete(id); }
    }

    // À appeler après un envoi confirmé par le serveur. Sans objet fichier exploitable, la liste est seulement marquée périmée.
    function noteUploaded(raw) {
      if (!sync()) return false;
      state.usageAt = 0;
      const file = normalizeFile(raw);
      if (file && state.loaded) {
        const rest = [...state.files].filter(([key]) => key !== file.id);
        state.files = new Map([[file.id, file], ...rest]);
      } else if (!file) state.stale = true;
      emit({ type: "files" });
      return Boolean(file);
    }

    function invalidate() {
      sync();
      state.stale = true; state.usageAt = 0;
      emit({ type: "stale" });
    }

    function reset() {
      state = blank(getSession() || "");
      emit({ type: "reset" });
    }

    function subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Un écouteur est requis.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }

    // Au retour au premier plan, les données sont considérées comme périmées (rien n'est relu sans demande).
    function watchForeground(doc) {
      if (!doc || typeof doc.addEventListener !== "function") return () => {};
      const handler = () => { if (doc.visibilityState === "visible") invalidate(); };
      doc.addEventListener("visibilitychange", handler);
      return () => { if (typeof doc.removeEventListener === "function") doc.removeEventListener("visibilitychange", handler); };
    }

    return {
      files: () => { sync(); return [...state.files.values()]; },
      get: id => { sync(); return state.files.get(id) || null; },
      hasMore: () => { sync(); return state.hasMore; },
      isLoaded: () => { sync(); return state.loaded; },
      usage: () => { sync(); return state.usage; },
      isStale, loadMore, reload, ensureLoaded, fetchUsage, remove, noteUploaded, invalidate, reset, subscribe, watchForeground
    };
  }

  // Une seule instance partagée par la bibliothèque et l'onglet Stockage.
  let shared = null;
  function getShared(deps) {
    if (!shared) {
      shared = create(deps);
      if (typeof document === "object" && document) shared.watchForeground(document);
    }
    return shared;
  }

  globalThis.tauriFilesStore = { create, getShared, peekShared: () => shared, validateUsage };
})();
