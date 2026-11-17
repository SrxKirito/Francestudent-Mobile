import { installEarlyGuard } from "./legacy-export-wiring.mjs";

// Classic-script bindings (let/const) are not window properties: reference them by name.
installEarlyGuard({
  IDBDatabase,
  Storage,
  locks: navigator.locks,
  localStorage,
  readConversations: () => {
    if (typeof store === "undefined") throw new Error("État de l’application indisponible.");
    return store.conversations;
  },
  target: window
});
