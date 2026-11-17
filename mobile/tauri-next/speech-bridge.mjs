// Adapte l'API Tauri STT au contrat du composeur historique.
export function createSpeechAdapter(invoke, addPluginListener) {
  const subscriptions = new Set();
  return {
    async available() { return invoke("plugin:stt|is_available"); },
    async checkPermissions() { return invoke("plugin:stt|check_permission"); },
    async requestPermissions() { return invoke("plugin:stt|request_permission"); },
    async addListener(name, callback) {
      if (name !== "partialResults" && name !== "listeningState") throw new Error("Événement de dictée non pris en charge.");
      let active = true;
      const registered = [];
      const remove = async () => {
        active = false;
        subscriptions.delete(remove);
        await Promise.allSettled(registered.splice(0).map(listener => listener.unregister()));
      };
      try {
        if (name === "partialResults") {
          registered.push(await addPluginListener("stt", "result", payload => {
            if (active && typeof payload?.transcript === "string") callback({ matches: [payload.transcript] });
          }));
        } else {
          registered.push(await addPluginListener("stt", "stateChange", payload => {
            if (active && payload?.state === "idle") callback({ status: "stopped" });
          }));
          registered.push(await addPluginListener("stt", "error", payload => {
            if (active) callback({ status: "stopped", error: payload?.message || "La reconnaissance vocale a été interrompue." });
          }));
        }
      } catch (error) {
        await remove();
        throw error;
      }
      subscriptions.add(remove);
      return { remove };
    },
    async removeAllListeners() {
      await Promise.allSettled([...subscriptions].map(remove => remove()));
    },
    async start(options = {}) {
      await invoke("plugin:stt|start_listening", { config: { language: options.language || "fr-FR", interimResults: true, continuous: false } });
    },
    async stop() { await invoke("plugin:stt|stop_listening"); }
  };
}
