import { Channel, invoke } from "@tauri-apps/api/core";

type TransportEvent =
  | { kind: "started"; status: number; content_type: string | null }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "finished" };
type Request = { token: string; method: string; path: string; accept: string; body?: string };

async function uploadFile(file: File, token: string, signal: AbortSignal, progress: (sent: number, total: number) => void): Promise<unknown> {
  const id = crypto.randomUUID();
  const event = new Channel<{ kind: "ready" }>();
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  event.onmessage = message => { if (message.kind === "ready") ready(); };
  const task = invoke("upload_begin", { id, token, name: file.name, mime: file.type, size: file.size, onEvent: event });
  // Observe early server failures while file chunks are still being prepared.
  void task.catch(() => {});
  const cancel = () => { void invoke("upload_cancel", { id }); };
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

export function installLegacyTransport() {
  const bridge = Object.freeze({
    exchange: (session: string, deviceId: string) => invoke("legacy_exchange", { session, deviceId }),
    login: (input: { url: string; method: string; data?: string; headers: Record<string, string> }) => invoke("legacy_login", { input }),
    upload: uploadFile,
    request: (request: Request): Promise<Response> => new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let started = false;
      let ended = false;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { controller = c; },
        cancel() { ended = true; void invoke("legacy_cancel", { id }); }
      });
      const onEvent = new Channel<TransportEvent>();
      onEvent.onmessage = event => {
        if (ended) return;
        if (event.kind === "started") {
          started = true;
          const headers = event.content_type ? { "content-type": event.content_type } : undefined;
          const noBody = [204, 205, 304].includes(event.status);
          resolve(new Response(noBody ? null : stream, { status: event.status, headers }));
          if (noBody) ended = true;
        } else if (event.kind === "chunk") {
          controller.enqueue(new Uint8Array(event.bytes));
        } else {
          ended = true;
          controller.close();
        }
      };
      void invoke("legacy_request", { ...request, id, onEvent }).catch(error => {
        if (ended) return;
        ended = true;
        if (started) controller.error(new Error(String(error)));
        else reject(new Error(String(error)));
      });
    })
  });
  Object.defineProperty(window, "__franceStudentTransport", { value: bridge, configurable: false, writable: false });
}
