import variant from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import wasmLocation from "@jitl/quickjs-wasmfile-release-sync/wasm?url";
import { appStateLimit, parseAppView, type AppRequest, type AppResponse } from "./interactive-app.ts";
import { object } from "./interactive-widgets.ts";

const engine = newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmLocation }));

self.addEventListener("message", async ({ data }: MessageEvent<AppRequest>) => {
  let response: AppResponse = { error: true };
  try {
    const quickjs = await engine;
    // Never install browser functions, module loaders, or Tauri bindings in the guest.
    const deadline = Date.now() + 180;
    const source = `(() => {
      "use strict";
      const parse = JSON.parse;
      const stringify = JSON.stringify;
      const state = parse(${JSON.stringify(data.state)});
      const event = parse(${JSON.stringify(JSON.stringify(data.event))});
      const app = (() => {
        ${data.code}
        return { render, update };
      })();
      const next = event ? app.update(state, event) : state;
      const snapshot = stringify(next);
      const view = app.render(parse(snapshot));
      return stringify({ state: snapshot, view });
    })()`;
    const result: unknown = quickjs.evalCode(source, {
      memoryLimitBytes: 4 * 1024 * 1024,
      maxStackSizeBytes: 256 * 1024,
      shouldInterrupt: () => Date.now() > deadline,
    });
    if (typeof result === "string" && result.length <= 65_000) {
      const output = object(JSON.parse(result));
      const state = output?.state;
      const view = parseAppView(output?.view);
      if (typeof state === "string" && state.length <= appStateLimit && object(JSON.parse(state)) && view.length) {
        response = { state, view };
      }
    }
  } catch {
    // Keep interpreter errors and generated source out of the chat transcript.
  }
  self.postMessage(response);
});
