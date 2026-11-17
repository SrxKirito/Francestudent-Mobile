import { installExportGuard, acquireWebLock } from "./export-guard.mjs";
import { createCapacitorExporter } from "./capacitor-host.mjs";
import { mountMigrationUI } from "./ui.mjs";

/**
 * Wiring between the legacy Capacitor app and the export engine. Everything the
 * app owns (store, busy, conversationWrite...) is injected, so this module is
 * testable without a browser. The two browser entries only provide accessors.
 */
const STATE_KEY = "fs-chat-state";
const PLUGIN_NAME = "MigrationExport";
export const GUARD_PROPERTY = "__fsMigrationAcquireGuard";

/** Step A: must run synchronously first in <head>, before any app script can write. */
export function installEarlyGuard({ IDBDatabase, Storage, locks, localStorage, readConversations, target }) {
  if (typeof readConversations !== "function") throw new Error("Lecture des discussions requise.");
  if (Object.prototype.hasOwnProperty.call(target, GUARD_PROPERTY)) throw new Error("Garde d'export déjà installée.");
  const capture = () => {
    const conversations = readConversations();
    if (!Array.isArray(conversations)) throw new Error("Discussions locales indisponibles.");
    return JSON.stringify([localStorage.getItem(STATE_KEY), conversations]);
  };
  const acquire = installExportGuard({ IDBDatabase, Storage, acquireGlobal: () => acquireWebLock(locks), capture });
  Object.defineProperty(target, GUARD_PROPERTY, { value: acquire });
  return acquire;
}

/** Blocks the whole UI during the export. Refuses to start while a reply or a sync is running. */
export function createSuspender({ document, isBusy, isSyncRunning }) {
  return async function suspend() {
    if (isBusy()) throw new Error("Une réponse est en cours : attends sa fin avant de créer la sauvegarde.");
    if (isSyncRunning()) throw new Error("Une synchronisation est en cours : réessaie dans un instant.");
    const body = document.body;
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("aria-live", "assertive");
    overlay.textContent = "Sauvegarde en cours… Ne ferme pas l’application.";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:rgba(0,0,0,.72);color:#fff;font:600 17px system-ui,sans-serif";
    const blocked = Array.from(body.children).map(child => [child, child.inert === true]);
    for (const [child] of blocked) child.inert = true;
    body.append(overlay);
    let resumed = false;
    return async () => {
      if (resumed) return;
      resumed = true;
      for (const [child, wasInert] of blocked) child.inert = wasInert;
      overlay.remove();
    };
  };
}

/** Waits until the app's own conversation writer is idle; fails instead of exporting a stale copy. */
export async function drainConversationWrites({ getWrite, hasPending, timeoutMs = 15000, intervalMs = 50 }) {
  const deadline = Date.now() + timeoutMs;
  while (getWrite() || hasPending()) {
    if (Date.now() > deadline) throw new Error("Les discussions sont encore en cours d’enregistrement ; réessaie.");
    const write = getWrite();
    if (write) { try { await write; } catch { /* the app reports its own write errors */ } }
    else await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

/**
 * Step B: mounts the export-only UI when the native plugin exists. Returns null
 * on builds without it (the normal production app). `globals` are accessors for
 * the app's classic-script bindings.
 */
export function mountLegacyExport({ capacitor, document, container, acquireGuard, localStorage, globals, openPreviewDatabase, timeoutMs }) {
  if (!capacitor || typeof capacitor.isPluginAvailable !== "function" || !capacitor.isPluginAvailable(PLUGIN_NAME)) return null;
  if (typeof acquireGuard !== "function") throw new Error("Garde d'export absente : la sauvegarde est désactivée.");
  const plugin = (capacitor.Plugins && capacitor.Plugins[PLUGIN_NAME]) || (typeof capacitor.registerPlugin === "function" ? capacitor.registerPlugin(PLUGIN_NAME) : null);
  if (!plugin) throw new Error("Plugin d'export indisponible.");
  const exporter = createCapacitorExporter({
    plugin,
    verifySingleWebView: async () => (await plugin.verifySingleWebView())?.single === true,
    suspend: createSuspender({ document, isBusy: globals.isBusy, isSyncRunning: globals.isSyncRunning }),
    drain: () => drainConversationWrites({ getWrite: globals.getWrite, hasPending: globals.hasPending, timeoutMs }),
    acquireGuard,
    readState: () => localStorage.getItem(STATE_KEY),
    readConversations: globals.readConversations,
    openPreviewDatabase
  });
  const ui = mountMigrationUI({ document, container, host: { export: password => exporter(password) }, allowImport: false });
  return { ui, exporter };
}
