import { Channel, invoke } from "@tauri-apps/api/core";

type TransportEvent =
  | { kind: "started"; status: number; content_type: string | null }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "finished" };
type Request = { token: string; method: string; path: string; accept: string; body?: string };

export function installLegacyTransport() {
  const bridge = Object.freeze({
    exchange: (session: string, deviceId: string) => invoke("legacy_exchange", { session, deviceId }),
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
