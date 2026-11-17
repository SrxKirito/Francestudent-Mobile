"use strict";
// Le parent ne fournit ce pont que sur une plateforme mobile compatible.
nativeSpeechPlugin = function() { return window.parent.__franceStudentSpeech || null; };

let speechStartup = false;
let speechShutdown = false;
const stopLegacyNativeDictation = stopNativeDictation;
stopNativeDictation = async function() {
  if (speechShutdown) return;
  speechShutdown = true;
  try { await stopLegacyNativeDictation(); } finally { speechShutdown = false; }
};

// Une session existe dès le premier await : un arrêt ou un arrière-plan peut
// ainsi invalider aussi les permissions et le démarrage encore en cours.
const beginNativeDictation = async function(plugin) {
  const session = { plugin };
  nativeDictation = session;
  const current = () => nativeDictation === session && document.visibilityState !== "hidden";
  const cleanup = async () => { try { await plugin.removeAllListeners(); } catch {} };
  try {
    const availability = await plugin.available();
    if (!current()) return true;
    if (!availability || !availability.available) { nativeDictation = null; return false; }
    let status = await plugin.checkPermissions();
    if (!current()) return true;
    if (!status || status.speechRecognition !== "granted" || status.microphone !== "granted") status = await plugin.requestPermissions();
    if (!current()) return true;
    if (!status || status.speechRecognition !== "granted" || status.microphone !== "granted") {
      nativeDictation = null;
      alert("L'accès au microphone ou à la reconnaissance vocale a été refusé.");
      return true;
    }
    const prompt = $("prompt");
    const base = prompt.value && !/\s$/.test(prompt.value) ? prompt.value + " " : prompt.value;
    await cleanup();
    if (!current()) return true;
    setMicState(true);
    await plugin.addListener("partialResults", data => {
      if (!current()) return;
      const text = data && Array.isArray(data.matches) ? data.matches[0] || "" : "";
      prompt.value = base + text;
      resizePrompt();
      updateSendButton();
    });
    if (!current()) { await cleanup(); return true; }
    await plugin.addListener("listeningState", data => {
      if (!data || data.status !== "stopped" || !current()) return;
      nativeDictation = null;
      setMicState(false);
      void cleanup();
      if (data.error) alert("La dictée a été interrompue : " + data.error);
    });
    if (!current()) { await cleanup(); return true; }
    await plugin.start({ language: "fr-FR", maxResults: 1, partialResults: true, popup: false });
    if (!current()) {
      await cleanup();
      try { await plugin.stop(); } catch {}
    }
    return true;
  } catch (error) {
    const notify = current();
    if (nativeDictation === session) nativeDictation = null;
    if (notify) setMicState(false);
    await cleanup();
    if (notify) alert("Impossible de démarrer la dictée : " + (error && error.message ? error.message : error));
    return true;
  }
};
startNativeDictation = async function(plugin) {
  if (speechStartup || speechShutdown) return true;
  speechStartup = true;
  try { return await beginNativeDictation(plugin); } finally { speechStartup = false; }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && nativeDictation) void stopNativeDictation();
});

