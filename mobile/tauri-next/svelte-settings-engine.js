// Pont de réglages : relie l'écran Paramètres Svelte aux fonctions du moteur historique (iframe).
//
// Chargé APRÈS les scripts de l'application historique (injection par prepare-legacy.cjs), il n'a aucun état,
// ne modifie rien et n'appelle rien au chargement : il ne fait qu'exposer `window.__fsSettings` (réglages)
// et `window.__fsAccount` (profil, photo de profil, déconnexion).
// Tout passe par du texte JSON, donc aucun objet n'est partagé entre l'iframe et Svelte.
// Chaque réglage appelle la fonction que l'écran historique appelle déjà (même stockage, même effet de bord) :
// quand le moteur historique disparaîtra, `createStorageSettings` (local-settings.ts) prend le relais sans changer l'écran.
(function () {
  "use strict";

  var DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";
  var THEMES = ["system", "light", "dark"];
  var WEB_MODES = ["open", "filtered", "disabled"];
  var COLUMNS = [1, 2, 3, 4];

  function models() {
    return typeof IMAGE_MODELS === "object" && IMAGE_MODELS ? IMAGE_MODELS : {};
  }

  function notificationsSupported() {
    try {
      return window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "ios";
    } catch (error) {
      return false;
    }
  }

  function need(name, available) {
    if (!available) throw new Error("Fonction du moteur historique indisponible : " + name + ".");
  }

  function read() {
    var theme = store.theme === "light" || store.theme === "dark" ? store.theme : "system";
    var imageModel = Object.prototype.hasOwnProperty.call(models(), store.imageModel) ? store.imageModel : DEFAULT_IMAGE_MODEL;
    return JSON.stringify({
      theme: theme,
      libraryColumns: store.libraryColumns || 3,
      completionNotifications: store.completionNotifications === true,
      defaultAgentId: Number.isInteger(store.defaultAgentId) ? store.defaultAgentId : null,
      imageTool: store.imageTool !== false,
      imageModel: imageModel,
      webSearchMode: WEB_MODES.indexOf(store.webSearchMode) >= 0 ? store.webSearchMode : "open"
    });
  }

  function catalog() {
    var list = models();
    return JSON.stringify({
      imageModels: Object.keys(list).map(function (id) {
        var info = list[id] || {};
        return { id: id, short: info.short || id, name: info.name || id };
      }),
      notificationsSupported: notificationsSupported() === true
    });
  }

  // Valide tout le correctif avant d'appliquer quoi que ce soit : une valeur invalide ne laisse aucune trace.
  function validate(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Réglages invalides.");
    var bad = function (key) {
      return new Error("Valeur invalide pour le réglage « " + key + " ».");
    };
    var valid = {};
    if (patch.theme !== undefined) {
      if (THEMES.indexOf(patch.theme) < 0) throw bad("theme");
      valid.theme = patch.theme;
    }
    if (patch.libraryColumns !== undefined) {
      if (COLUMNS.indexOf(patch.libraryColumns) < 0) throw bad("libraryColumns");
      valid.libraryColumns = patch.libraryColumns;
    }
    if (patch.defaultAgentId !== undefined) {
      if (patch.defaultAgentId !== null && !Number.isInteger(patch.defaultAgentId)) throw bad("defaultAgentId");
      valid.defaultAgentId = patch.defaultAgentId;
    }
    if (patch.imageTool !== undefined) {
      if (typeof patch.imageTool !== "boolean") throw bad("imageTool");
      valid.imageTool = patch.imageTool;
    }
    if (patch.imageModel !== undefined) {
      if (typeof patch.imageModel !== "string" || !Object.prototype.hasOwnProperty.call(models(), patch.imageModel)) throw bad("imageModel");
      valid.imageModel = patch.imageModel;
    }
    if (patch.webSearchMode !== undefined) {
      if (WEB_MODES.indexOf(patch.webSearchMode) < 0) throw bad("webSearchMode");
      valid.webSearchMode = patch.webSearchMode;
    }
    return valid;
  }

  function update(patchJson) {
    var patch = validate(JSON.parse(patchJson));
    var imageChanged = patch.imageTool !== undefined || patch.imageModel !== undefined;
    need("saveStore", typeof saveStore === "function");
    if (patch.theme !== undefined) need("applyTheme", typeof applyTheme === "function");
    if (patch.libraryColumns !== undefined) need("setLibraryColumns", typeof setLibraryColumns === "function");
    if (patch.defaultAgentId !== undefined) need("setDefaultModel", typeof setDefaultModel === "function");
    if (imageChanged) need("applyImageSettingsChange", typeof applyImageSettingsChange === "function");
    if (patch.webSearchMode !== undefined) need("applyWebSearchPreference", typeof applyWebSearchPreference === "function");

    if (patch.theme !== undefined) {
      store.theme = patch.theme;
      saveStore();
      applyTheme();
    }
    if (patch.libraryColumns !== undefined) setLibraryColumns(patch.libraryColumns);
    if (patch.defaultAgentId !== undefined) setDefaultModel(patch.defaultAgentId === null ? "" : String(patch.defaultAgentId));
    if (imageChanged) {
      if (patch.imageTool !== undefined) store.imageTool = patch.imageTool;
      if (patch.imageModel !== undefined) store.imageModel = patch.imageModel;
      // Un seul rafraîchissement : il remet aussi `imageToolSynced` à null (resynchro serveur au prochain message).
      applyImageSettingsChange();
    }
    if (patch.webSearchMode !== undefined) applyWebSearchPreference(patch.webSearchMode);
  }

  // Le texte d'état est celui que l'écran historique affiche lui-même (« Notifications locales activées… »).
  async function toggleNotifications() {
    need("toggleCompletionNotifications", typeof toggleCompletionNotifications === "function");
    await toggleCompletionNotifications();
    var status = $("completion-notifications-status");
    return status ? String(status.textContent || "") : "";
  }

  // Après un enregistrement réussi : le moteur ne doit plus ajouter sa consigne « fichiers » aux instructions.
  function instructionsSaved() {
    need("saveStore", typeof saveStore === "function");
    store.customInstructionsManaged = true;
    store.fileInstrSynced = true;
    saveStore();
  }

  // Une réponse est en cours dans l'ancienne interface : l'écran Paramètres ne doit pas recharger la page.
  function isBusy() {
    return typeof busy !== "undefined" && busy === true;
  }

  window.__fsSettings = {
    read: read,
    catalog: catalog,
    update: update,
    toggleNotifications: toggleNotifications,
    instructionsSaved: instructionsSaved,
    busy: isBusy
  };

  // --- Compte : profil mémorisé, photo de profil (stockée sur l'appareil), déconnexion -------------------
  var AVATAR_STORAGE_FULL = "Stockage plein : impossible d'enregistrer la photo.";
  var AVATAR_INVALID = "Choisis un fichier image.";

  function textOf(value) {
    return typeof value === "string" ? value : "";
  }

  function isAvatar(value) {
    return typeof value === "string" && /^data:image\//i.test(value);
  }

  function accountRead() {
    var profile = store.profile && typeof store.profile === "object" ? store.profile : {};
    return JSON.stringify({
      name: textOf(profile.name),
      email: textOf(profile.email),
      avatar: isAvatar(store.avatar) ? store.avatar : ""
    });
  }

  function accountSaveProfile(json) {
    var data = JSON.parse(json);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Profil invalide.");
    need("saveStore", typeof saveStore === "function");
    need("renderProfile", typeof renderProfile === "function");
    var current = store.profile && typeof store.profile === "object" ? store.profile : {};
    store.profile = Object.assign({}, current, { name: textOf(data.name), email: textOf(data.email) });
    saveStore();
    renderProfile();
  }

  // Même règle que l'écran historique : si le stockage refuse l'écriture, l'ancienne photo est restaurée.
  function accountSetAvatar(dataUrl) {
    if (!isAvatar(dataUrl)) throw new Error(AVATAR_INVALID);
    need("saveStore", typeof saveStore === "function");
    need("renderProfile", typeof renderProfile === "function");
    var had = Object.prototype.hasOwnProperty.call(store, "avatar");
    var previous = store.avatar;
    store.avatar = dataUrl;
    var saved = false;
    try {
      saved = saveStore() !== false;
    } catch (error) {
      saved = false;
    }
    if (!saved) {
      if (had) store.avatar = previous;
      else delete store.avatar;
      throw new Error(AVATAR_STORAGE_FULL);
    }
    renderProfile();
  }

  function accountRemoveAvatar() {
    need("saveStore", typeof saveStore === "function");
    need("renderProfile", typeof renderProfile === "function");
    delete store.avatar;
    saveStore();
    renderProfile();
  }

  // `logout()` historique efface la session, le profil et les drapeaux liés au compte. S'il s'arrête en route
  // (par exemple si le Keychain refuse l'oubli du lien), la session est toujours là : on le signale à Svelte.
  async function accountSignOut() {
    need("logout", typeof logout === "function");
    await logout();
    if (store.session !== "") throw new Error("Déconnexion impossible : la session est toujours active.");
  }

  window.__fsAccount = {
    read: accountRead,
    saveProfile: accountSaveProfile,
    setAvatar: accountSetAvatar,
    removeAvatar: accountRemoveAvatar,
    signOut: accountSignOut
  };
})();
