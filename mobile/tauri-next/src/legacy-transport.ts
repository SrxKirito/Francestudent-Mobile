import { save } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-fs";
import { saveWithDialog, saveResponseWithDialog } from "./save-file.js";
import { native, requestStream, uploadFile } from "./lib/services/transport.ts";

// Pont transitoire pour l'interface historique (iframe). Les appels Rust vivent dans
// lib/services/transport.ts, partagés avec la nouvelle interface Svelte.
export function installLegacyTransport() {
  const bridge = Object.freeze({
    exchange: native.exchange,
    login: native.login,
    readSession: native.readSession,
    writeSession: native.writeSession,
    deleteSession: native.deleteSession,
    scheduleMigration: native.scheduleMigration,
    saveFile: (name: string, bytes: Uint8Array) => saveWithDialog(save, open, name, bytes),
    saveResponse: (name: string, response: Response) => saveResponseWithDialog(save, open, name, response),
    canOpenSavedFile: native.speechSupported,
    openSavedFile: native.openSavedFile,
    upload: uploadFile,
    request: requestStream
  });
  Object.defineProperty(window, "__franceStudentTransport", { value: bridge, configurable: false, writable: false });
}
