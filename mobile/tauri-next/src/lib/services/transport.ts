import { Channel, invoke } from "@tauri-apps/api/core";
import type { ApiRequest, ExchangeResult, LoginInput, LoginOutput, TransportEvent, UploadKind } from "../types/api.ts";

/** Envoi d'un fichier par blocs vers Rust (`upload_begin/chunk/finish/cancel`). Les blocs font 128 Kio. */
export async function uploadFile(
  file: File,
  token: string,
  signal: AbortSignal,
  progress: (sent: number, total: number) => void,
  kind: UploadKind = "file"
): Promise<unknown> {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const event = new Channel<{ kind: "ready" }>();
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  event.onmessage = message => { if (message.kind === "ready") ready(); };
  const mime = file.type || (kind === "skill" ? "application/octet-stream" : "");
  const task = invoke("upload_begin", { id, token, name: file.name, mime, size: file.size, kind, onEvent: event });
  // Observe early server failures while file chunks are still being prepared.
  void task.catch(() => {});
  const cancel = () => { void invoke("upload_cancel", { id }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.race([started, task.then(() => { throw new Error("Transfert terminé avant son initialisation."); })]);
    if (signal.aborted) throw new DOMException("Transfert annulé.", "AbortError");
    const blockSize = 128 * 1024;
    for (let offset = 0; offset < file.size; offset += blockSize) {
      if (signal.aborted) throw new DOMException("Transfert annulé.", "AbortError");
      const bytes = new Uint8Array(await file.slice(offset, offset + blockSize).arrayBuffer());
      await invoke("upload_chunk", { id, bytes: Array.from(bytes) });
      progress(offset + bytes.length, file.size);
    }
    if (signal.aborted) throw new DOMException("Transfert annulé.", "AbortError");
    await invoke("upload_finish", { id });
    return await task;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Requête HTTP exécutée par Rust (`legacy_request`), exposée comme une `Response` avec corps en flux. */
export function requestStream(request: ApiRequest, signal?: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const id = crypto.randomUUID();
    let started = false;
    let ended = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    function finish(): boolean {
      if (ended) return false;
      ended = true;
      signal?.removeEventListener("abort", abort);
      return true;
    }

    function cancelNative(): void {
      void invoke("legacy_cancel", { id }).catch(() => {});
    }

    function fail(error: unknown): void {
      if (!finish()) return;
      if (started) controller.error(error);
      else reject(error);
    }

    function abort(): void {
      if (ended) return;
      cancelNative();
      fail(signal?.reason ?? new DOMException("Requête annulée.", "AbortError"));
    }

    const stream = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      cancel() { if (finish()) cancelNative(); }
    });
    const onEvent = new Channel<TransportEvent>();
    onEvent.onmessage = event => {
      if (ended) return;
      if (event.kind === "started") {
        if (started) return;
        started = true;
        try {
          const headers = new Headers();
          if (event.content_type) headers.set("content-type", event.content_type);
          if (event.retry_after) headers.set("retry-after", event.retry_after);
          const noBody = [204, 205, 304].includes(event.status);
          resolve(new Response(noBody ? null : stream, { status: event.status, headers }));
          if (noBody) finish();
        } catch (error) {
          started = false;
          cancelNative();
          fail(error);
        }
      } else if (event.kind === "chunk") {
        if (started) controller.enqueue(new Uint8Array(event.bytes));
      } else if (started) {
        finish();
        controller.close();
      } else fail(new Error("Le transport a terminé sans réponse."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    void invoke("legacy_request", { ...request, id, onEvent }).catch(error => fail(new Error(String(error))));
  });
}

/** Commandes Rust d'authentification et de session sécurisée (Keychain iOS). */
export const native = {
  exchange: (session: string, deviceId: string) => invoke<ExchangeResult>("legacy_exchange", { session, deviceId }),
  login: (input: LoginInput) => invoke<LoginOutput>("legacy_login", { input }),
  readSession: () => invoke<string | null>("session_read"),
  writeSession: (value: string) => invoke<void>("session_write", { value }),
  deleteSession: () => invoke<void>("session_delete"),
  scheduleMigration: () => invoke("migration_schedule"),
  speechSupported: () => invoke<boolean>("speech_supported").catch(() => false),
  readAloudSupported: () => invoke<boolean>("read_aloud_supported").catch(() => false),
  readAloudStart: (sequence: number, text: string, language: string) => invoke<void>("read_aloud_start", { sequence, text, language }),
  readAloudStop: (sequence: number) => invoke<void>("read_aloud_stop", { sequence }),
  openSavedFile: (path: string) => invoke("plugin:file-preview|open", { path })
};
