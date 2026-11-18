// Faux IndexedDB pour les tests Node : opérations asynchrones, valeurs clonées à l'appel (structured clone, comme le vrai),
// échecs et lenteur configurables. Une seule base, un seul object store.

export function fakeIndexedDB() {
  const state = {
    data: new Map(),
    storeName: null,
    opens: [],
    closed: 0,
    log: [],
    fail: { open: false, get: false, put: 0 },
    delay: 0
  };
  const later = fn => setTimeout(fn, state.delay);

  function readOperation(tx, mode, key) {
    const request = {};
    later(() => {
      if (state.fail.get) {
        tx.error = new Error("lecture refusée");
        tx.onerror();
        return;
      }
      request.result = state.data.has(key) ? structuredClone(state.data.get(key)) : undefined;
      state.log.push({ mode, op: "get", key });
      tx.oncomplete();
    });
    return request;
  }

  function writeOperation(tx, mode, value, key) {
    const request = {};
    const copy = structuredClone(value);
    later(() => {
      if (state.fail.put > 0) {
        state.fail.put -= 1;
        tx.error = new Error("quota dépassé");
        tx.onabort();
        return;
      }
      state.data.set(key, copy);
      state.log.push({ mode, op: "put", key, value: copy });
      request.result = key;
      tx.oncomplete();
    });
    return request;
  }

  function makeTransaction(storeName, mode) {
    if (storeName !== state.storeName) throw new Error("NotFoundError : object store inconnu");
    const tx = {
      objectStore: () => ({
        get: key => readOperation(tx, mode, key),
        put: (value, key) => writeOperation(tx, mode, value, key)
      })
    };
    return tx;
  }

  return {
    state,
    open(name, version) {
      state.opens.push({ name, version });
      const request = {};
      const db = {
        createObjectStore(storeName) {
          state.storeName = storeName;
        },
        close() {
          state.closed += 1;
        },
        transaction: makeTransaction
      };
      later(() => {
        if (state.fail.open) {
          request.error = new Error("ouverture refusée");
          request.onerror();
          return;
        }
        request.result = db;
        if (state.storeName === null) request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    }
  };
}
