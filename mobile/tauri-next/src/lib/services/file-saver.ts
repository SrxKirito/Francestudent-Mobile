import { save } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-fs";
import { saveResponseWithDialog, saveWithDialog } from "../../save-file.js";

// Enregistrement d'un fichier généré par l'application (CSV d'activité, …) : boîte de dialogue système puis écriture par blocs.
// Même chemin que `saveFile` du transport historique ; rejette avec « Enregistrement annulé. » si l'utilisateur annule.

export function saveBytes(name: string, bytes: Uint8Array): Promise<string> {
  return saveWithDialog(save, open, name, bytes);
}

/** Sauvegarde un téléchargement en flux via le sélecteur natif. */
export function saveResponse(name: string, response: Response): Promise<string> {
  return saveResponseWithDialog(save, open, name, response);
}

/** Demande la destination avant de démarrer le flux réseau ou de charger le fichier local. */
export async function saveStream(name: string, read: () => Promise<Response>): Promise<string> {
  const defaultPath = name.split(/[\\/]/).pop()?.replace(/[<>:"|?*\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "") || "fichier";
  const path = await save({ defaultPath });
  if (!path) throw new Error("Enregistrement annulé.");
  return saveResponseWithDialog(async () => path, open, defaultPath, await read());
}
