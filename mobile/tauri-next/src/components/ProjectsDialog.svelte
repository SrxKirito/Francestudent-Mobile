<script lang="ts">
  import { onMount } from "svelte";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import type { WorkspaceEngine } from "../lib/services/workspace-engine.ts";
  import { listProjects, projectChats, projectForm, projectPath, projectResult, rows } from "../lib/services/projects.ts";
  import type { Project, ProjectShare } from "../lib/services/projects.ts";
  import { errorMessage } from "../lib/utils/errors.ts";

  type Target = { id: string; projectId: string | null };
  let { api, engine, editId, target, onclose }: {
    api: ApiClient; engine: WorkspaceEngine; editId?: string; target?: Target; onclose: () => void;
  } = $props();
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let dialog: HTMLDialogElement;
  let projects = $state.raw<Project[]>([]);
  let shares = $state.raw<ProjectShare[]>([]);
  let editor = $state.raw<{ id: string | null } | null>(null);
  let name = $state("");
  let instructions = $state("");
  let invite = $state("");
  let showAccess = $state(false);
  let busy = $state(false);
  let message = $state("");
  let query = $state("");
  let sort = $state("date");
  let destination = $state("");
  let canMove = $state(false);
  const filtered = $derived(projects.filter(project => project.name.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"))).sort((a, b) => {
    const date = (row: Project) => Date.parse(row.lastActivityAt || row.updatedAt || row.createdAt || "") || 0;
    return (sort === "date" ? date(b) - date(a) : 0) || a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  }));

  onMount(() => {
    dialog.showModal();
    destination = target?.projectId ?? "";
    void run(async () => {
      await refresh();
      if (editId) await editExisting(editId);
    });
    return () => lifetime.abort();
  });

  function close() { if (!busy) onclose(); }

  async function refresh() {
    const result = await listProjects(api, signal);
    if (signal.aborted) return;
    projects = result.projects;
    message = result.message;
    canMove = true;
  }

  async function run(work: () => Promise<void>) {
    if (busy || signal.aborted) return;
    busy = true;
    message = "";
    try { await work(); }
    catch (error) { if (!signal.aborted) message = errorMessage(error); }
    finally { busy = false; }
  }

  function begin(project?: Project) {
    editor = { id: project?.id ?? null };
    name = project?.name ?? "";
    instructions = project?.customInstructions ?? "";
    showAccess = false;
    shares = [];
    invite = "";
    message = "";
  }

  async function editExisting(id: string) {
    const project = projects.find(row => row.id === id);
    if (project?.sharedWithMe) return;
    const data = await api.json<Partial<Project>>(projectPath(id), { signal });
    if (!signal.aborted) begin(projectResult(data, false));
  }

  function enter(project: Project) {
    void run(async () => {
      if (!engine.projectReady()) throw new Error("Attends la fin de la réponse en cours.");
      const [data, chats] = await Promise.all([
        api.json<Partial<Project>>(projectPath(project.id), { signal }),
        projectChats(api, project.id, signal)
      ]);
      if (signal.aborted) return;
      engine.enterProject(projectResult(data, project.sharedWithMe), chats);
      onclose();
    });
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    const id = editor?.id;
    void run(async () => {
      const body = projectForm(name, instructions);
      const data = await api.json<Partial<Project> | null>(id ? projectPath(id) : "/projects", {
        method: id ? "PATCH" : "POST", body, signal
      });
      if (signal.aborted) return;
      const saved = projectResult({ ...body, id: id ?? undefined, ...data }, false);
      if (id) engine.updateProject(saved);
      else {
        try {
          engine.enterProject(saved, []);
          onclose();
          return;
        } catch {
          message = "Projet créé. Ouvre-le depuis la liste après la réponse en cours.";
        }
      }
      editor = null;
      projects = [...projects.filter(row => row.id !== saved.id), saved];
    });
  }

  function removeProject() {
    const id = editor?.id;
    if (!id || !window.confirm("Supprimer définitivement ce projet ?")) return;
    void run(async () => {
      if (!engine.projectReady()) throw new Error("Attends la fin de la réponse en cours.");
      await api.json(projectPath(id), { method: "DELETE", signal });
      if (signal.aborted) return;
      engine.deleteProjectContext(id);
      projects = projects.filter(row => row.id !== id);
      editor = null;
    });
  }

  async function refreshShares(id: string) {
    const data = await api.json(projectPath(id) + "/shares", { signal });
    if (!signal.aborted) shares = rows<ProjectShare>(data, "users").filter(row => row && typeof row === "object");
  }

  function share(event: SubmitEvent) {
    event.preventDefault();
    const id = editor?.id;
    const userEmail = invite.trim();
    if (!id || !userEmail) return;
    void run(async () => {
      await api.json(projectPath(id) + "/shares", { method: "POST", body: { userEmail }, signal });
      invite = "";
      await refreshShares(id);
    });
  }

  function unshare(userId: number) {
    const id = editor?.id;
    if (!id || !window.confirm("Retirer cet accès au projet ?")) return;
    void run(async () => {
      await api.json(projectPath(id) + "/shares/" + encodeURIComponent(userId), { method: "DELETE", signal });
      await refreshShares(id);
    });
  }

  function move(event: SubmitEvent) {
    event.preventDefault();
    if (!target || !canMove || destination === (target.projectId ?? "")) return;
    const chat = target;
    const project = destination || chat.projectId;
    if (!project) return;
    void run(async () => {
      if (!engine.projectReady()) throw new Error("Attends la fin de la réponse en cours.");
      await api.json(projectPath(project) + "/chats/" + encodeURIComponent(chat.id), { method: destination ? "PUT" : "DELETE", signal });
      if (!signal.aborted) {
        engine.movedChat(chat.id, destination || null);
        onclose();
      }
    });
  }
</script>

<dialog id="svelte-projects" class="project-editor workspace-project-dialog" aria-labelledby="svelte-projects-title" bind:this={dialog} oncancel={event => { event.preventDefault(); close(); }}>
  <div class="settings-item-head">
    <h2 id="svelte-projects-title">{target ? "Déplacer la discussion" : editor ? editor.id ? "Paramètres du projet" : "Créer un projet" : "Projets"}</h2>
    <button type="button" class="settings-btn" disabled={busy} onclick={close} aria-label="Fermer">×</button>
  </div>
  {#if target}
    <form class="settings-form" onsubmit={move}>
      <label class="settings-label">Projet
        <select class="settings-input" disabled={busy || !canMove} bind:value={destination}>
          <option value="">Sans projet</option>
          {#each projects.filter(project => !project.sharedWithMe || project.id === target?.projectId) as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
          {#if target.projectId && !projects.some(project => project.id === target?.projectId)}<option value={target.projectId}>Projet actuel</option>{/if}
        </select>
      </label>
      <button class="settings-btn primary" disabled={busy || !canMove || destination === (target.projectId ?? "")}>Déplacer</button>
    </form>
  {:else if editor}
    <form class="settings-form" onsubmit={save}>
      <fieldset disabled={busy}>
        <label class="settings-label">Nom du projet <input class="settings-input" maxlength="50" bind:value={name} required></label>
        <label class="settings-label">Instructions personnalisées <textarea class="settings-input" maxlength="10000" bind:value={instructions}></textarea></label>
      </fieldset>
      <div class="settings-item-actions">
        <button class="settings-btn primary" disabled={busy || !name.trim()}>{editor.id ? "Enregistrer" : "Créer le projet"}</button>
        <button type="button" class="settings-btn" disabled={busy} onclick={() => { editor = null; message = ""; }}>Retour</button>
        {#if editor.id}<button type="button" class="settings-btn danger" disabled={busy} onclick={removeProject}>Supprimer le projet</button>{/if}
      </div>
    </form>
    {#if editor.id}
      <button type="button" class="settings-btn" aria-expanded={showAccess} disabled={busy} onclick={() => {
        const id = editor?.id;
        showAccess = !showAccess;
        if (showAccess && id) void run(() => refreshShares(id));
      }}>Gérer les accès</button>
      {#if showAccess}
        <form class="settings-form" onsubmit={share}>
          <label class="settings-label">Adresse e-mail <input class="settings-input" type="email" bind:value={invite} required></label>
          <button class="settings-btn" disabled={busy}>Partager</button>
        </form>
        {#each shares as row}
          {@const userId = row.userId}
          <div class="settings-item-head"><span>{row.userEmail || "Utilisateur"} · {row.owner ? "Propriétaire" : row.permission === "Write" ? "Écriture" : "Lecture"}</span>
            {#if !row.owner && typeof userId === "number" && Number.isInteger(userId)}
              <button type="button" class="settings-btn danger" disabled={busy} onclick={() => unshare(userId)}>Retirer</button>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  {:else}
    <div class="settings-item-actions">
      <button type="button" class="settings-btn" disabled={busy} onclick={() => begin()}>Créer un projet</button>
      <button type="button" class="settings-btn" disabled={busy} onclick={() => void run(refresh)}>Actualiser</button>
    </div>
    <div class="library-filters">
      <input type="search" class="settings-input" placeholder="Rechercher un projet" aria-label="Rechercher un projet" bind:value={query}>
      <select class="settings-input" aria-label="Trier les projets" bind:value={sort}><option value="date">Plus récents</option><option value="name">Nom A → Z</option></select>
    </div>
    {#each filtered as project (project.id)}
      <div class="settings-item">
        <div class="settings-item-actions">
          <button type="button" class="settings-btn" disabled={busy} onclick={() => enter(project)}>{project.name}</button>
          {#if project.sharedWithMe}<span class="settings-hint">Partagé</span>
          {:else}<button type="button" class="settings-btn small" disabled={busy} onclick={() => void run(() => editExisting(project.id))} aria-label={"Modifier " + project.name}>Modifier</button>{/if}
        </div>
      </div>
    {:else}
      {#if !busy && !message}<p class="settings-hint">Aucun projet dans cette liste.</p>{/if}
    {/each}
  {/if}
  {#if busy}<p role="status" class="settings-hint">Chargement…</p>{/if}
  {#if message}<p role="alert" class="settings-error">{message}</p>{/if}
</dialog>

<style>
  .workspace-project-dialog { max-height: 90dvh; overflow: auto; }
  textarea { min-height: 7rem; }
</style>
