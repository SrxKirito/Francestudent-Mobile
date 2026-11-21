"use strict";
// Vignettes des fichiers enregistrés (Files V2) : bornées en octets, en mémoire et en requêtes simultanées.
// - Images raster (png, jpg, webp, gif) : miniature réelle, sous une limite d'octets stricte.
// - Texte et code : quelques lignes, lues en tronquant le fichier ; jamais exécutés ni injectés en HTML.
// - Tout le reste (PDF, Word, PowerPoint, SVG, HEIC, archives…) : icône avec l'extension, SANS aucune requête.
// Les URL d'objet sont comptées par « bail » : une URL affichée n'est jamais révoquée avant sa libération.
(() => {
  const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|log|json|py|pyw|js|mjs|cjs|jsx|ts|tsx|html?|css|scss|xml|ya?ml|toml|ini|sql|sh|ps1|java|kt|swift|c|cc|cpp|h|hpp|cs|go|rs|rb|php|r|lua|dart|tex)$/i;
  const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

  function extension(name) {
    const match = /\.([A-Za-z0-9]{1,8})$/.exec(typeof name === "string" ? name : "");
    return match ? match[1].toLowerCase() : "";
  }
  const iconLabel = name => extension(name).slice(0, 4).toUpperCase() || "FICHIER";
  const icon = (name, reason) => ({ type: "icon", label: iconLabel(name), reason, release() {} });
  const abortError = () => Object.assign(new Error("Annulé"), { name: "AbortError" });
  const tooLarge = () => Object.assign(new Error("Fichier trop volumineux pour une miniature."), { code: "too-large" });

  function create(deps) {
    const {
      fetchBlob, createUrl, revokeUrl,
      maxCachedImages = 40, maxCachedTexts = 200, concurrency = 2,
      imageMaxBytes = 2 * 1024 * 1024, textMaxBytes = 16 * 1024,
      textMaxChars = 600, textMaxLines = 12, textMaxLineLength = 80
    } = deps || {};
    if (typeof fetchBlob !== "function" || typeof createUrl !== "function" || typeof revokeUrl !== "function") {
      throw new TypeError("fetchBlob, createUrl et revokeUrl sont requis.");
    }

    const cache = new Map(); // clé -> { result, url, leases } ; l'ordre d'insertion = récence d'usage
    const jobs = new Map();  // clé -> tâche (en attente ou en cours)
    const queue = [];
    let running = 0;

    const nameOf = file => (file && (file.filename || file.name)) || "";
    const keyOf = file => String(file.id) + ":" + (Number.isFinite(file.bytes) ? file.bytes : "?");

    // Détermine, sans aucune requête, ce que l'on peut afficher.
    function plan(file) {
      const name = nameOf(file);
      if (!file || typeof file.id !== "string" || !file.id) return { kind: "icon", reason: "unsupported" };
      const mime = IMAGE_MIME[extension(name)];
      if (mime) {
        if (Number.isFinite(file.bytes) && file.bytes > imageMaxBytes) return { kind: "icon", reason: "too-large" };
        return { kind: "image", mime };
      }
      if (TEXT_EXT.test(name)) return { kind: "text" };
      return { kind: "icon", reason: "unsupported" };
    }

    // Retire les plus anciennes entrées sans bail au-delà des plafonds.
    function trim() {
      let excess = [...cache.values()].filter(entry => entry.url).length - maxCachedImages;
      for (const [key, entry] of [...cache]) {
        if (excess <= 0) break;
        if (!entry.url || entry.leases > 0) continue;
        revokeUrl(entry.url);
        cache.delete(key);
        excess--;
      }
      excess = [...cache.values()].filter(entry => !entry.url).length - maxCachedTexts;
      for (const [key, entry] of [...cache]) {
        if (excess <= 0) break;
        if (entry.url) continue;
        cache.delete(key);
        excess--;
      }
    }

    // Chaque appelant reçoit son propre résultat ; release() est idempotent.
    function lease(key, entry) {
      cache.delete(key);
      cache.set(key, entry);
      if (!entry.url) return { ...entry.result, release() {} };
      entry.leases++;
      let released = false;
      return {
          ...entry.result,
        release() {
          if (released) return;
          released = true;
          if (cache.get(key) === entry && entry.leases > 0) {
            entry.leases--;
            trim();
          }
        }
      };
    }

    async function buildText(blob, name) {
      const raw = (await blob.text()).replace(/^\uFEFF/, "");
      const sample = raw.slice(0, textMaxBytes);
      if (CONTROL.test(sample)) return icon(name, "binary");
      const lines = sample
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .slice(0, textMaxLines)
        .map(line => (line.length > textMaxLineLength ? line.slice(0, textMaxLineLength) + "…" : line));
      let text = lines.join("\n").replace(/\s+$/, "");
      if (text.length > textMaxChars) text = text.slice(0, textMaxChars) + "…";
      return text ? { type: "text", text, release() {} } : icon(name, "empty");
    }

    async function execute(job) {
      const { file, spec } = job;
      const blob = await fetchBlob(file, {
          signal: job.controller.signal,
          limit: spec.kind === "image" ? imageMaxBytes : textMaxBytes,
          truncate: spec.kind === "text"
        });
      if (job.controller.signal.aborted) throw abortError();
      if (spec.kind === "text") return { result: await buildText(blob, nameOf(file)), cacheable: true };
      if (!blob || blob.size > imageMaxBytes) throw tooLarge();
      const url = await createUrl(blob, spec.mime);
      if (job.controller.signal.aborted) { revokeUrl(url); throw abortError(); }
      return { result: { type: "image", key: job.key, url }, cacheable: true };
    }

    async function run(job) {
      job.state = "running";
      running++;
      try {
        let outcome;
        try {
          outcome = await execute(job);
        } catch (error) {
          if (job.controller.signal.aborted) return;
          const reason = error && error.code === "too-large" ? "too-large" : "error";
          // Une erreur de réseau n'est pas mise en cache : la prochaine ouverture peut réessayer.
          outcome = { result: icon(nameOf(job.file), reason), cacheable: reason === "too-large" };
        }
        if (job.controller.signal.aborted) {
          if (outcome.result.url) revokeUrl(outcome.result.url);
          return;
        }
        const { result } = outcome;
        let entry = null;
        if (outcome.cacheable) {
          entry = { result, url: result.url || "", leases: 0 };
          cache.set(job.key, entry);
        }
        const waiters = [...job.waiters];
        job.waiters.clear();
        for (const waiter of waiters) {
          waiter.cleanup();
          waiter.resolve(entry ? lease(job.key, entry) : { ...result, release() {} });
        }
        if (entry) trim();
      } finally {
        running--;
        if (jobs.get(job.key) === job) jobs.delete(job.key);
        pump();
      }
    }

    function pump() {
      while (running < concurrency && queue.length) {
        const job = queue.shift();
        if (job.state === "queued" && job.waiters.size) void run(job);
        else if (jobs.get(job.key) === job) jobs.delete(job.key);
      }
    }

    // Retourne { type: "image", url, release } | { type: "text", text } | { type: "icon", label, reason }.
    // Ne rejette que pour une annulation (AbortError) ; toute autre erreur devient une icône.
    function request(file, options) {
      const signal = options && options.signal;
      if (signal && signal.aborted) return Promise.reject(abortError());
      const spec = plan(file);
      if (spec.kind === "icon") return Promise.resolve(icon(nameOf(file), spec.reason));
      const key = keyOf(file);
      const hit = cache.get(key);
      if (hit) return Promise.resolve(lease(key, hit));
      let job = jobs.get(key);
      if (!job) {
        job = { key, file, spec, state: "queued", waiters: new Set(), controller: new AbortController() };
        jobs.set(key, job);
        queue.push(job);
      }
      const current = job;
      return new Promise((resolve, reject) => {
          const waiter = {
            resolve, reject,
            cleanup() { if (signal) signal.removeEventListener("abort", onAbort); }
          };
          function onAbort() {
            if (!current.waiters.delete(waiter)) return;
            reject(abortError());
            if (current.waiters.size) return;
            current.controller.abort();
            const index = queue.indexOf(current);
            if (index !== -1) queue.splice(index, 1);
            if (jobs.get(current.key) === current) jobs.delete(current.key);
          }
          current.waiters.add(waiter);
          if (signal) signal.addEventListener("abort", onAbort, { once: true });
          pump();
        });
    }

    // Révoque tout (fermeture de la bibliothèque, changement de compte) et annule les requêtes en cours.
    function clear() {
      for (const job of jobs.values()) {
        job.controller.abort();
        for (const waiter of job.waiters) {
          waiter.cleanup();
          waiter.reject(abortError());
        }
        job.waiters.clear();
      }
      jobs.clear();
      queue.length = 0;
      for (const entry of cache.values()) if (entry.url) revokeUrl(entry.url);
      cache.clear();
    }

    return {
      plan, request, clear,
      stats: () => ({ cached: cache.size, images: [...cache.values()].filter(entry => entry.url).length, queued: queue.length, running })
    };
  }

  globalThis.tauriFileThumbnails = { create, extension, iconLabel };
})();
