"use strict";
// Move the session only after the secure store confirms it was persisted.
const originalStartApp = startApp;
const originalActivateSession = activateSession;
const originalLogout = logout;
let secureSessionReady = false;

async function writeVerifiedSession(value) {
  const previous = await tauriTransport.readSession();
  try {
    await tauriTransport.writeSession(value);
    if (await tauriTransport.readSession() !== value) throw new Error("La session n'a pas été confirmée par le stockage sécurisé.");
  } catch (error) {
    if (previous && previous !== value) { try { await tauriTransport.writeSession(previous); } catch {} }
    throw error;
  }
}

startApp = async function() {
  try {
    const old = store.session;
    let secure = await tauriTransport.readSession();
    if (old && secure && old !== secure) throw new Error("Deux sessions locales différentes ont été trouvées. Les données ont été conservées.");
    if (old && !secure) { await writeVerifiedSession(old); secure = old; }
    store.session = secure || "";
    saveStore = function() {
      try {
        const snapshot = { ...store };
        delete snapshot.session;
        localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
      } catch { alert("Stockage plein : les données locales n'ont pas pu être enregistrées."); }
    };
    secureSessionReady = true;
    return originalStartApp();
  } catch (error) {
    bindEvents();
    showLogin("Stockage sécurisé indisponible : " + (error?.message || error));
  }
};

activateSession = async function(session) {
  if (!secureSessionReady) throw new Error("Stockage sécurisé indisponible. Relance l’application avant de te connecter.");
  const token = await tauriTransport.exchange(session, store.deviceId);
  if (!token || typeof token.accessToken !== "string" || !token.accessToken) throw authError("Session refusée.");
  await writeVerifiedSession(session);
  return originalActivateSession(session);
};

logout = async function() {
  try { await tauriTransport.deleteSession(); }
  catch (error) { showToast("Déconnexion impossible : " + (error?.message || error), true); return; }
  return originalLogout();
};
