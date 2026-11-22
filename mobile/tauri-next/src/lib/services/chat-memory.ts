export const memoryEntryLimit = 280;
const maxEntries = 20;
const prefix = "fs-chat-memory:";

export function memoryRequest(value: string): string | null {
  const match = /^(?:m[ée]morise\s+que|souviens-toi\s+que|\/m[ée]moriser)(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? (match[1] ?? "").trim() : null;
}

export interface MemoryEntry { id: string; text: string }
export interface MemorySnapshot { enabled: boolean; entries: MemoryEntry[] }

export interface ChatMemory {
  read(): MemorySnapshot;
  setEnabled(enabled: boolean): MemorySnapshot;
  save(text: string, id?: string): MemorySnapshot;
  remove(id: string): MemorySnapshot;
}

export function createChatMemory(storage: Pick<Storage, "getItem" | "setItem">, owner: () => string): ChatMemory {
  function storageKey() {
    const account = owner().trim().toLowerCase();
    return account ? prefix + encodeURIComponent(account) : "";
  }

  function readKey(key: string): MemorySnapshot {
    if (!key) return { enabled: false, entries: [] };
    try {
      const raw = JSON.parse(storage.getItem(key) ?? "null");
      const entries: MemoryEntry[] = [];
      const seen = new Set<string>();
      if (Array.isArray(raw?.entries)) {
        for (const entry of raw.entries.slice(0, maxEntries)) {
          if (typeof entry?.id !== "string" || entry.id.length > 60 || seen.has(entry.id) ||
              typeof entry.text !== "string" || !entry.text.trim() || entry.text.length > memoryEntryLimit) continue;
          entries.push({ id: entry.id, text: entry.text });
          seen.add(entry.id);
        }
      }
      return { enabled: raw?.enabled === true, entries };
    } catch { return { enabled: false, entries: [] }; }
  }

  function update(change: (snapshot: MemorySnapshot) => MemorySnapshot) {
    const key = storageKey();
    if (!key) throw new Error("Le compte n’est pas encore disponible.");
    const next = change(readKey(key));
    try { storage.setItem(key, JSON.stringify(next)); }
    catch { throw new Error("Impossible d’enregistrer la mémoire sur cet appareil."); }
    return next;
  }

  return {
    read: () => readKey(storageKey()),
    setEnabled: enabled => update(snapshot => ({ ...snapshot, enabled })),
    save(value, id) {
      const text = value.trim();
      if (!text || text.length > memoryEntryLimit) throw new Error("Saisis entre 1 et 280 caractères.");
      return update(snapshot => {
        if (id) {
          if (!snapshot.entries.some(entry => entry.id === id)) throw new Error("Ce souvenir a déjà été supprimé.");
          return { ...snapshot, entries: snapshot.entries.map(entry => entry.id === id ? { id, text } : entry) };
        }
        if (snapshot.entries.some(entry => entry.text === text)) return snapshot;
        if (snapshot.entries.length >= maxEntries) throw new Error("La mémoire contient déjà 20 souvenirs.");
        return { ...snapshot, entries: [...snapshot.entries, { id: crypto.randomUUID(), text }] };
      });
    },
    remove: id => update(snapshot => ({ ...snapshot, entries: snapshot.entries.filter(entry => entry.id !== id) }))
  };
}
