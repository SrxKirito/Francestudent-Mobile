import { parseMarkdownBlocks } from "./markdown.ts";

export function speechText(markdown: string): string {
  return parseMarkdownBlocks(markdown).flatMap(block => block.type === "text" ? [block.content] : []).join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function chunks(text: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 220);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start) end = space;
      // Ne coupe pas une paire de substitution dans un mot long.
      if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
    }
    if (text.slice(start, end).trim()) result.push(text.slice(start, end).trim());
    start = end;
  }
  return result;
}

export interface ReadAloudPlayer {
  play(index: number, markdown: string): void;
  stop(): void;
}

let playbackSequence = 0;
function nextSequence(): number {
  playbackSequence = Math.max(playbackSequence + 1, Date.now());
  return playbackSequence;
}

export function createNativeReadAloud(
  transport: {
    start(sequence: number, text: string, language: string): Promise<void>;
    stop(sequence: number): Promise<void>;
  },
  onChange: (index: number | null) => void,
  onError: () => void,
  language: string,
  onEnd?: () => void
): ReadAloudPlayer {
  let active: number | null = null;
  let ticket = 0;

  function clear() {
    active = null;
    onChange(null);
  }

  function stop() {
    if (active === null) return;
    ticket++;
    clear();
    void transport.stop(nextSequence()).catch(() => {});
  }

  function play(index: number, markdown: string) {
    const previous = active;
    stop();
    if (previous === index) return;
    const text = speechText(markdown);
    if (!text) return;

    const id = ++ticket;
    active = index;
    onChange(index);
    void transport.start(nextSequence(), text, language).then(
      () => { if (ticket === id) { clear(); onEnd?.(); } },
      () => {
        if (ticket !== id) return;
        clear();
        onError();
      }
    );
  }

  return { play, stop };
}

export function createReadAloud(
  synthesis: Pick<SpeechSynthesis, "speak" | "cancel">,
  utterance: (text: string) => SpeechSynthesisUtterance,
  onChange: (index: number | null) => void,
  onError: () => void,
  language: string,
  onEnd?: () => void
) {
  let active: number | null = null;
  let ticket = 0;
  let current: SpeechSynthesisUtterance | null = null;
  function stop() {
    ticket++;
    if (active === null) return;
    active = null;
    current = null;
    onChange(null);
    synthesis.cancel();
  }
  function play(index: number, markdown: string) {
    const previous = active;
    stop();
    if (previous === index) return;
    const parts = chunks(speechText(markdown));
    if (!parts.length) return;
    const id = ++ticket;
    active = index;
    onChange(index);
    function speak(position: number) {
      if (id !== ticket) return;
      if (position >= parts.length) {
        active = null;
        current = null;
        onChange(null);
        onEnd?.();
        return;
      }
      try {
        current = utterance(parts[position]);
        current.lang = language;
        current.onend = () => speak(position + 1);
        current.onerror = () => { if (id === ticket) { stop(); onError(); } };
        synthesis.speak(current);
      } catch { stop(); onError(); }
    }
    speak(0);
  }
  return { play, stop };
}
