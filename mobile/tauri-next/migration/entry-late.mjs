import { mountLegacyExport, GUARD_PROPERTY } from "./legacy-export-wiring.mjs";

// Classic-script bindings (let/const) are not window properties: reference them by name.
// A missing binding is an error, never a silent "false".
function binding(name, read) {
  try { return read(); }
  catch (error) { throw new Error(`Application indisponible (${name}) : ${error?.message || error}`); }
}

const container = document.getElementById("panel-account");
try {
  if (!container) throw new Error("Panneau du compte introuvable.");
  mountLegacyExport({
    capacitor: window.Capacitor,
    document,
    container,
    acquireGuard: window[GUARD_PROPERTY],
    localStorage,
    openPreviewDatabase: () => binding("aperçus", () => openPreviewDatabase()),
    globals: {
      isBusy: () => binding("busy", () => busy === true),
      isSyncRunning: () => binding("serverSyncRunning", () => serverSyncRunning === true),
      getWrite: () => binding("conversationWrite", () => conversationWrite),
      hasPending: () => binding("pendingConversations", () => pendingConversations !== null),
      readConversations: () => binding("store", () => store.conversations)
    }
  });
} catch (error) {
  console.error(error);
  if (container) {
    const note = document.createElement("p");
    note.setAttribute("role", "status");
    note.textContent = "Sauvegarde indisponible : " + (error?.message || error);
    container.append(note);
  }
}
