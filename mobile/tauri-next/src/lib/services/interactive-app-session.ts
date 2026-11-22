import type { EditorTarget } from "./document-editor.ts";
import type { Cell } from "./interactive-widgets.ts";

export interface AppFollowUp {
  kind: "app";
  title: string;
  state: string;
}

export interface TableFollowUp {
  kind: "table";
  title: string;
  columns: string[];
  rows: Cell[][];
}

export interface SimulatorFollowUp {
  kind: "simulator";
  title: string;
  fields: { id: string; label: string; value: Cell }[];
}

export interface EditorDraft {
  kind: "editor";
  title: string;
  revision: string;
  language?: string;
  text: string;
  start: number;
  end: number;
}

export interface EditorFollowUp extends EditorDraft {
  message: number;
  block: EditorTarget;
}

export type InteractiveFollowUp = AppFollowUp | TableFollowUp | SimulatorFollowUp | EditorFollowUp;

export interface AppSession {
  read(revision: string): string | undefined;
  save(revision: string, snapshot: string): void;
  forget(): void;
  observe(listener: (snapshot: string) => void): () => void;
  publish(revision: string, snapshot: string): void;
  followUp?(context: AppFollowUp | SimulatorFollowUp | EditorDraft): void;
}

export function createAppSessions() {
  const states = new Map<string, { revision: string; snapshot: string }>();
  const listeners = new Map<string, Set<(snapshot: string) => void>>();

  return {
    forBlock(conversationId: string, message: number, block: EditorTarget, followUp?: AppSession["followUp"]): AppSession {
      const key = JSON.stringify([conversationId, message, block]);
      const session: AppSession = {
        read(revision) {
          const entry = states.get(key);
          if (entry?.revision === revision) {
            states.delete(key);
            states.set(key, entry);
            return entry.snapshot;
          }
        },
        save(revision, snapshot) {
          states.delete(key);
          states.set(key, { revision, snapshot });
          if (states.size > 64) {
            const first = states.keys().next();
            if (!first.done) states.delete(first.value);
          }
        },
        forget() { states.delete(key); },
        observe(listener) {
          const watchers = listeners.get(key) ?? new Set();
          watchers.add(listener);
          listeners.set(key, watchers);
          return () => {
            watchers.delete(listener);
            if (!watchers.size && listeners.get(key) === watchers) listeners.delete(key);
          };
        },
        publish(revision, snapshot) {
          session.save(revision, snapshot);
          for (const listener of listeners.get(key) ?? []) listener(snapshot);
        },
        followUp
      };
      return session;
    },
    clear() { states.clear(); listeners.clear(); }
  };
}
