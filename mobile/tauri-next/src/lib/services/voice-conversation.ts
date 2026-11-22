import { createDictation, type SpeechAdapter } from "./dictation.ts";
import { speechText } from "./read-aloud.ts";
import type { ChatState } from "../types/chat.ts";

export type VoicePhase = "idle" | "listening" | "sending" | "thinking" | "speaking";

export function createVoiceConversation(plugin: SpeechAdapter, ui: {
  state: () => ChatState;
  project: () => string | null;
  visible: () => boolean;
  update: (phase: VoicePhase, transcript: string) => void;
  send: (text: string) => boolean;
  speak: (index: number, text: string) => void;
  quiet: () => void;
  error: (message: string) => void;
}) {
  let phase: VoicePhase = "idle";
  let transcript = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let stopping: Promise<void> | undefined;
  let conversation: string | null = null;
  let project: string | null = null;
  let userIndex = -1;

  function publish(next: VoicePhase) {
    phase = next;
    ui.update(next, transcript);
  }

  function stop() {
    if (phase === "idle") return;
    generation++;
    clearTimeout(timer);
    transcript = "";
    publish("idle");
    ui.quiet();
    const pending = dictation.stop();
    stopping = pending;
    void pending.finally(() => { if (stopping === pending) stopping = undefined; });
  }

  function fail(message: string) {
    stop();
    ui.error(message);
  }

  function currentScope() {
    return ui.visible() && ui.state().id === conversation && ui.project() === project;
  }

  async function send() {
    if (phase !== "listening") return;
    clearTimeout(timer);
    if (!currentScope()) { stop(); return; }
    const text = transcript.trim();
    if (!text) { fail("Aucune parole détectée."); return; }
    const run = generation;
    publish("sending");
    await dictation.stop();
    if (run !== generation || (phase as VoicePhase) !== "sending") return;
    if (!currentScope()) { stop(); return; }
    const accepted = ui.send(text);
    if (run !== generation) return;
    if (!accepted) { fail("Impossible d’envoyer la question vocale."); return; }
    const snap = ui.state();
    conversation = snap.id;
    userIndex = snap.messages.length - 1;
    transcript = "";
    publish("thinking");
    sync(snap);
  }

  const dictation = createDictation(plugin, {
    visible: () => phase === "listening" && currentScope(),
    active: listening => {
      if (!listening && phase === "listening") queueMicrotask(() => void send());
    },
    transcript: value => {
      if (phase !== "listening" || value === transcript) return;
      transcript = value;
      publish("listening");
      clearTimeout(timer);
      if (value.trim()) timer = setTimeout(() => void send(), 1_500);
    },
    error: fail
  });

  function listen() {
    if (!currentScope()) { stop(); return; }
    transcript = "";
    publish("listening");
    const run = generation;
    if (stopping) {
      void stopping.then(() => { if (generation === run && phase === "listening") void dictation.start(); });
    } else void dictation.start();
  }

  function start() {
    if (phase !== "idle" || !ui.visible()) return;
    const state = ui.state();
    if (state.busy || state.pending || state.composer.attachments.length) {
      ui.error("La conversation vocale nécessite un chat prêt à recevoir une question.");
      return;
    }
    conversation = state.id;
    project = ui.project();
    generation++;
    listen();
  }

  function sync(state: ChatState) {
    if (phase === "idle" || phase === "sending") return;
    if (!currentScope()) { stop(); return; }
    if (phase !== "thinking" || state.busy) return;
    const answer = state.messages[userIndex + 1];
    if (!answer || answer.role !== "assistant" || state.pending || !speechText(answer.content)) {
      fail("La réponse n’a pas pu être lue. Tu peux continuer dans le chat.");
      return;
    }
    publish("speaking");
    ui.speak(answer.index, answer.content);
  }

  function playbackEnded() {
    if (phase === "speaking") listen();
  }

  function skip() {
    if (phase !== "speaking") return;
    ui.quiet();
    playbackEnded();
  }

  return { start, stop, send, sync, skip, playbackEnded, playbackFailed: () => {
    if (phase === "speaking") fail("La lecture vocale a été interrompue.");
  } };
}
