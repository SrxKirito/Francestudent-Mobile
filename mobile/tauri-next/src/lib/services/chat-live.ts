// État « en direct » d'une réponse en cours, alimenté par les rappels de processChatStream. Pur (aucun DOM, aucune
// rune) : le magasin Svelte n'a plus qu'à recopier `live` dans son état réactif.
import type { ChatSource } from "../types/chat.ts";
import type { ProcessChatStreamOptions, StreamEvent, ToolProgress } from "../types/chat-stream.ts";

export interface LiveState {
  active: boolean;
  text: string;
  searching: boolean;
  sources: ChatSource[];
  imageStarted: boolean;
  tools?: ToolProgress[];
}

export function emptyLive(): LiveState {
  return { active: false, text: "", searching: false, sources: [], imageStarted: false };
}

export interface LiveTracker {
  readonly live: LiveState;
  /** Enveloppe les rappels : l'ancienne interface reçoit exactement les mêmes appels, dans le même ordre. */
  wrap(options: ProcessChatStreamOptions): ProcessChatStreamOptions;
  reset(): void;
}

export function createLiveTracker(update: (live: LiveState) => void): LiveTracker {
  let live = emptyLive();
  const push = (next: LiveState): void => {
    live = next;
    update(live);
  };
  const apply = (event: StreamEvent): void => {
    if (event.name === "web_search") push({ ...live, searching: true });
    else if (event.name === "sources") push({ ...live, searching: false, sources: event.data.map(source => ({ url: source.url, title: source.title, host: source.host })) });
    else if (event.name === "image_start") push({ ...live, imageStarted: true });
    else if (event.name === "tool_progress") {
      const previous = live.tools?.find(tool => tool.id === event.data.id);
      const others = live.tools?.filter(tool => tool.id !== event.data.id) ?? [];
      const progress = { ...event.data, label: event.data.label || previous?.label };
      push({ ...live, tools: [...others.slice(-4), progress] });
    }
  };
  return {
    get live() { return live; },
    wrap(options) {
      push({ ...emptyLive(), active: true });
      const forward = options.onEvent;
      return {
        ...options,
        onDelta: output => {
          push({ ...live, text: output, searching: false });
          options.onDelta(output);
        },
        onEvent: forward
          ? event => {
            apply(event);
            forward(event);
          }
          : undefined
      };
    },
    reset() {
      push(emptyLive());
    }
  };
}
