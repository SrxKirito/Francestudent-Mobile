import { createStartupImportBarrier } from "./startup-import-barrier.mjs";
import { createTauriImportHost } from "./tauri-import-host.mjs";
import { mountMigrationUI } from "./ui.mjs";

function openDatabase(indexedDB, name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Base locale inaccessible."));
    request.onblocked = () => reject(new Error("Base locale bloquée par une autre fenêtre."));
  });
}

// Same schemas as mobile/www/js/core.js and preview.js: opening them here must
// never produce a layout the normal application would not recognise.
function openConversations(indexedDB) {
  return openDatabase(indexedDB, "francestudent-conversations", 1, db => db.createObjectStore("state"));
}
function openPreviews(indexedDB) {
  return openDatabase(indexedDB, "francestudent-previews", 2, db => {
    if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
    if (!db.objectStoreNames.contains("library")) db.createObjectStore("library", { keyPath: "id" });
  });
}

/**
 * Import-only page. `invoke` is Tauri's invoke; the native side
 * (src-tauri/src/migration_host.rs) holds the exclusive migration lease for
 * the whole process, so the per-operation lease below is a thin proxy.
 */
export function createMigrationPage({ document, container, invoke, indexedDB, storage }) {
  if (!document || !container || typeof invoke !== "function" || !indexedDB || !storage) throw new Error("Page d'import indisponible.");
  const vault = {
    async read() { return (await invoke("session_read")) || null; },
    async write(value) { await invoke("session_write", { value }); }
  };
  const acquireImportBarrier = createStartupImportBarrier({
    assertMigrationStartup: () => invoke("migration_assert"),
    async nativeLease() {
      await invoke("migration_assert");
      return {
        assertValid: () => invoke("migration_assert"),
 markWritesPossible: () => invoke("migration_mark_writes"),
 // The native lease stays held until the user leaves or the app exits.
        release: async () => {}
      };
    },
    async openDestination() {
      const conversationDb = await openConversations(indexedDB);
      let previewDb;
      try { previewDb = await openPreviews(indexedDB); }
      catch (error) { conversationDb.close(); throw error; }
      return { storage, conversationDb, previewDb, vault, async close() { conversationDb.close(); previewDb.close(); } };
    },
    restart: () => invoke("migration_finish")
  });
  const host = createTauriImportHost({ acquireImportBarrier });

  const intro = document.createElement("p");
  intro.textContent = "Importe les conversations, fichiers et réglages exportés depuis l’ancienne application. Rien n’est écrasé : les données déjà présentes sont conservées.";
  container.append(intro);
  const ui = mountMigrationUI({ document, container, host, allowExport: false });
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Revenir à l’application";
  const backStatus = document.createElement("p");
  backStatus.setAttribute("role", "status");
  back.onclick = async () => {
    back.disabled = true;
    try { await invoke("migration_cancel"); }
    catch (error) { backStatus.textContent = "Retour impossible : " + (error?.message || error); back.disabled = false; }
  };
  container.append(back, backStatus);
  return { ui, host, back };
}
