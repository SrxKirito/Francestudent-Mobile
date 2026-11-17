// Adapte l'API Tauri STT au contrat utilisé par le composeur Capacitor.
// `addPluginListener` doit être fourni par @tauri-apps/api/core.
export function createSpeechAdapter(invoke, addPluginListener) {
  const listeners = new Set();
  return {
    async available() { return invoke("plugin:stt|is_available"); },
    async checkPermissions() { return invoke("plugin:stt|check_permission"); },
    async requestPermissions() { return invoke("plugin:stt|request_permission"); },
    async addListener(name, callback) {
      const event = name === "partialResults" ? "result" : name === "listeningState" ? "stateChange" : null;
      if (!event) throw new Error("Événement de dictée non pris en charge.");
      const listener = await addPluginListener("stt", event, payload => {
        if (name === "partialResults" && typeof payload?.transcript === "string") callback({ matches: [payload.transcript] });
        if (name === "listeningState" && payload?.state === "idle") callback({ status: "stopped" });
      });
      listeners.add(listener);
      return { async remove() { listeners.delete(listener); await listener.unregister(); } };
    },
    async removeAllListeners() {
      const old = [...listeners]; listeners.clear();
      await Promise.allSettled(old.map(listener => listener.unregister()));
    },
    async start(options = {}) {
      await invoke("plugin:stt|start_listening", { config: { language: options.language || "fr-FR", interimResults: true, continuous: false } });
    },
    async stop() { await invoke("plugin:stt|stop_listening"); }
  };
}

