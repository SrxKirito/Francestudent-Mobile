import type { ApiClient } from "../services/api-client.ts";
import { errorMessage } from "../utils/errors.ts";

interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const slug = (skill: Skill) => normalize(skill.name).replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "") || "skill";

export function skillQuery(text: string): string | null {
  return /^\/([^\s/]*)$/.exec(text)?.[1] ?? null;
}

export class SkillsStore {
  skills = $state.raw<Skill[]>([]);
  loading = $state(false);
  busy = $state(false);
  error = $state("");
  #loadedAt = 0;
  #request: Promise<boolean> | null = null;
  #life = new AbortController();

  constructor(private api: ApiClient, private upload: (file: File, signal: AbortSignal) => Promise<unknown>) {}

  get signal() { return this.#life.signal; }

  dispose() { this.#life.abort(); }

  search(query: string) {
    const needle = normalize(query.trim());
    return this.skills.filter(skill => normalize(skill.name + " " + skill.description).includes(needle));
  }

  choices(query: string) {
    const needle = normalize(query);
    const rows = this.skills.filter(skill => skill.enabled).map(skill => ({ skill, command: slug(skill) }));
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.command, (counts.get(row.command) ?? 0) + 1);
    return rows.filter(row => counts.get(row.command) === 1 && (row.command.includes(needle) || normalize(row.skill.name + " " + row.skill.description).includes(needle)))
      .sort((a, b) => Number(b.command.startsWith(needle)) - Number(a.command.startsWith(needle)));
  }

  command(text: string) {
    const match = /^\s*\/([^\s/]+)(?=\s|$)/.exec(text);
    if (!match) return null;
    return this.choices("").find(row => row.command === normalize(match[1])) ?? null;
  }

  prefix(text: string): string {
    const row = this.command(text);
    if (!row) return "";
    const { skill, command } = row;
    return "[Skill imposé par l’utilisateur : « " + skill.name + " » (commande /" + command + ", id : " + skill.id +
      "). Tu dois utiliser ce skill, ses instructions et ses ressources. Si le skill est introuvable ou inutilisable, indique-le clairement avant de répondre autrement.]\n\n";
  }

  load(force = false): Promise<boolean> {
    if (this.signal.aborted) return Promise.resolve(false);
    if (this.#request) return this.#request;
    if (!force && Date.now() - this.#loadedAt < 60000) return Promise.resolve(true);
    this.loading = true;
    this.error = "";
    const request = this.#read().then(skills => {
      if (this.signal.aborted) return false;
      this.skills = skills;
      this.#loadedAt = Date.now();
      return true;
    }).catch(error => {
      if (!this.signal.aborted) this.error = "Impossible de charger les skills : " + errorMessage(error);
      return false;
    }).finally(() => {
      this.#request = null;
      this.loading = false;
    });
    this.#request = request;
    return request;
  }

  async #read(): Promise<Skill[]> {
    const skills = new Map<string, Skill>();
    const cursors = new Set<string>();
    let cursor = "";
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("after", cursor);
      const page = await this.api.json<{ data: unknown[]; has_more?: boolean; last_id?: string }>("/skills?" + params, { signal: this.signal });
      if (!Array.isArray(page?.data)) throw new Error("Réponse de skills invalide.");
      for (const item of page.data) {
        const row = item as Partial<Skill> & { disabled?: boolean } | null;
        if (typeof row?.id !== "string" || !row.id || skills.has(row.id)) continue;
        skills.set(row.id, {
          id: row.id,
          name: typeof row.name === "string" && row.name ? row.name : row.id,
          description: typeof row.description === "string" ? row.description : "",
          enabled: row.enabled !== false && row.disabled !== true
        });
      }
      if (!page.has_more) return [...skills.values()];
      cursor = page.last_id || (page.data.at(-1) as Partial<Skill> | null)?.id || "";
      if (!cursor || cursors.has(cursor)) break;
      cursors.add(cursor);
    }
    throw new Error("Pagination des skills invalide ou trop longue.");
  }

  toggle(skill: Skill) {
    const enabled = !skill.enabled;
    return this.#change(async () => {
      await this.api.json("/skills/" + encodeURIComponent(skill.id), { method: "POST", body: { enabled }, signal: this.signal });
      this.skills = this.skills.map(row => row.id === skill.id ? { ...row, enabled } : row);
    });
  }

  remove(skill: Skill) {
    return this.#change(async () => {
      await this.api.json("/skills/" + encodeURIComponent(skill.id), { method: "DELETE", signal: this.signal });
      this.skills = this.skills.filter(row => row.id !== skill.id);
    });
  }

  import(file: File) {
    if (!/\.(md|zip)$/i.test(file.name)) {
      this.error = "Choisis un fichier Markdown ou ZIP.";
      return;
    }
    return this.#change(() => this.upload(file, this.signal));
  }

  async #change(action: () => Promise<unknown>) {
    if (this.busy || this.loading || this.signal.aborted) return;
    this.busy = true;
    this.error = "";
    try {
      await action();
      this.#loadedAt = 0;
      await this.load(true);
    } catch (error) {
      if (!this.signal.aborted) this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }
}
