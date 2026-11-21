type Permissions = { microphone?: string; speechRecognition?: string };
type Subscription = { remove(): Promise<void> };

export interface SpeechAdapter {
  available(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<Permissions>;
  requestPermissions(): Promise<Permissions>;
  addListener(name: "partialResults" | "listeningState", callback: (event: { matches?: string[]; status?: string; error?: string }) => void): Promise<Subscription>;
  start(options: { language: string }): Promise<void>;
  stop(): Promise<void>;
}

export function appSpeech(): SpeechAdapter | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { __franceStudentSpeech?: SpeechAdapter }).__franceStudentSpeech ?? null;
}

type Run = { subscriptions: Subscription[]; start?: Promise<void> };

export function createDictation(plugin: SpeechAdapter, ui: {
  active(value: boolean): void;
  transcript(value: string): void;
  error(message: string): void;
  visible(): boolean;
}) {
  let current: Run | null = null;
  let starting = false;
  let stopping: Promise<void> | undefined;
  const permitted = (state: Permissions) => state?.speechRecognition === "granted" && state?.microphone === "granted";

  function stop(stopDevice = true): Promise<void> {
    const run = current;
    current = null;
    if (!run) return stopping ?? Promise.resolve();
    ui.active(false);
    const task = (async () => {
      await Promise.allSettled(run.subscriptions.splice(0).map(listener => listener.remove()));
      if (stopDevice && run.start) {
        await run.start.catch(() => {});
        await plugin.stop().catch(() => {});
      }
    })();
    stopping = task;
    void task.finally(() => { if (stopping === task) stopping = undefined; });
    return task;
  }

  async function start() {
    if (current || starting || stopping || !ui.visible()) return;
    starting = true;
    const run: Run = { subscriptions: [] };
    current = run;
    ui.active(true);
    const live = () => current === run && ui.visible();
    async function listen(name: "partialResults" | "listeningState", handler: (event: { matches?: string[]; status?: string; error?: string }) => void) {
      const subscription = await plugin.addListener(name, event => { if (live()) handler(event); });
      if (live()) run.subscriptions.push(subscription);
      else await subscription.remove();
    }

    try {
      const availability = await plugin.available();
      if (!live()) return;
      if (!availability?.available) throw new Error("Reconnaissance vocale indisponible.");
      let permissions = await plugin.checkPermissions();
      if (!live()) return;
      if (!permitted(permissions)) permissions = await plugin.requestPermissions();
      if (!live()) return;
      if (!permitted(permissions)) throw new Error("Accès au microphone ou à la reconnaissance vocale refusé.");
      await listen("partialResults", event => {
        const phrase = event.matches?.[0];
        if (typeof phrase === "string") ui.transcript(phrase);
      });
      if (!live()) return;
      await listen("listeningState", event => {
        if (event.status !== "stopped") return;
        if (event.error) ui.error("Dictée interrompue : " + event.error);
        void stop(false);
      });
      if (!live()) return;
      run.start = plugin.start({ language: "fr-FR" });
      await run.start;
    } catch (error) {
      if (live()) {
        ui.error(error instanceof Error ? error.message : "Impossible de démarrer la dictée.");
        await stop();
      }
    } finally {
      starting = false;
      if (current === run && !ui.visible()) void stop();
    }
  }

  return { start, stop };
}
