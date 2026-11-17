import { invoke } from "@tauri-apps/api/core";
import { createMigrationPage } from "./migration-page.mjs";

createMigrationPage({
  document,
  container: document.getElementById("migration"),
  invoke,
  indexedDB: window.indexedDB,
  storage: window.localStorage
});
