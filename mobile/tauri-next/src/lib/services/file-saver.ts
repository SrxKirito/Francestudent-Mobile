import { isTauri, invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { mkdir, open, remove } from "@tauri-apps/plugin-fs";
import { saveResponseWithDialog, saveWithDialog } from "../../save-file.js";

function appleMobile(): boolean {
  return isTauri() && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
}

function fileName(name: string): string {
  return name.split(/[\\/]/).pop()?.replace(/[<>:"|?*\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "") || "fichier";
}

async function exportOnIos(name: string, write: (path: string) => Promise<unknown>): Promise<string> {
  const directory = await join(await appCacheDir(), "frst-exports", crypto.randomUUID());
  const path = await join(directory, fileName(name));
  await mkdir(directory, { recursive: true });
  try {
    await write(path);
    return await invoke<string>("plugin:file-preview|export_file", { path });
  } finally {
    await remove(path).catch(() => {});
    await remove(directory).catch(() => {});
  }
}

export function saveBytes(name: string, bytes: Uint8Array): Promise<string> {
  return appleMobile()
    ? exportOnIos(name, path => saveWithDialog(async () => path, open, name, bytes))
    : saveWithDialog(save, open, name, bytes);
}

export function saveResponse(name: string, response: Response): Promise<string> {
  return appleMobile()
    ? exportOnIos(name, path => saveResponseWithDialog(async () => path, open, name, response))
        .catch(async error => { await response.body?.cancel().catch(() => {}); throw error; })
    : saveResponseWithDialog(save, open, name, response);
}

export async function saveStream(name: string, read: () => Promise<Response>): Promise<string> {
  if (appleMobile()) {
    return exportOnIos(name, async path => saveResponseWithDialog(async () => path, open, name, await read()));
  }
  const defaultPath = fileName(name);
  const path = await save({ defaultPath });
  if (!path) throw new Error("Enregistrement annulé.");
  return saveResponseWithDialog(async () => path, open, defaultPath, await read());
}
