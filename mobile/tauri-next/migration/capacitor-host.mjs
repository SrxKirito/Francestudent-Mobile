import { createIosTemporaryFactory } from "./ios-sink.mjs";
import { exportLegacy } from "./orchestrate.mjs";

/**
 * Wiring for the transition Capacitor app. The application must provide a real
 * suspend/resume barrier and a native uniqueness check; missing guarantees are
 * errors, never silently replaced by a UI overlay or a no-op lock.
 */
export function createCapacitorExporter({ plugin, verifySingleWebView, suspend, drain, acquireGuard, readState, readConversations, openPreviewDatabase }) {
  for (const [name, value] of Object.entries({ verifySingleWebView, suspend, drain, acquireGuard, readState, readConversations, openPreviewDatabase })) {
    if (typeof value !== "function") throw new Error(`Prérequis d'export indisponible : ${name}.`);
  }
  const openTemporary = createIosTemporaryFactory(plugin);
  async function acquireExclusive() {
    if (await verifySingleWebView() !== true) throw new Error("Impossible de garantir une seule WebView active.");
    const resume = await suspend();
    if (typeof resume !== "function") throw new Error("Suspension des tâches non confirmée.");
    let release;
    try {
      await drain();
      release = await acquireGuard();
      if (typeof release !== "function" || typeof release.assertValid !== "function") throw new Error("Verrou d'export invalide.");
      if (await verifySingleWebView() !== true) throw new Error("Une autre WebView est active.");
      const combined = async () => { try { await release(); } finally { await resume(); } };
      combined.assertValid = async () => {
        if (await verifySingleWebView() !== true) throw new Error("Une autre WebView est active.");
        await release.assertValid();
      };
      return combined;
    } catch (error) { try { if (typeof release === "function") await release(); } finally { await resume(); } throw error; }
  }
  async function snapshot() {
    const rawState = readState();
    const conversations = structuredClone(readConversations());
    const previewDb = await openPreviewDatabase();
    return { rawState, conversations, previewDb };
  }
  return password => exportLegacy({ password, acquireExclusive, snapshot, openTemporary });
}
