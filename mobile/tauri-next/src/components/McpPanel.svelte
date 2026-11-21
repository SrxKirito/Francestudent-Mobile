<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import { listMcpServers, mcpCredentials, mcpIdentity, mcpOAuthCode, mcpPath, startMcpOAuth } from "../lib/services/mcp-settings.ts";
  import type { McpAuth, McpOAuth, McpServer } from "../lib/services/mcp-settings.ts";
  import { errorMessage } from "../lib/utils/errors.ts";

  let { api }: { api: ApiClient } = $props();
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let rows = $state.raw<McpServer[]>([]);
  let busy = $state(false);
  let message = $state("");
  let step = $state(0);
  let wizard: HTMLDialogElement;
  let addButton: HTMLButtonElement;
  let label = $state("");
  let url = $state("");
  let description = $state("");
  let auth = $state<McpAuth>("none");
  let token = $state("");
  let headers = $state("");
  let approval = $state(true);
  let formError = $state("");
  let oauth = $state.raw<McpOAuth | null>(null);
  let code = $state("");

  onDestroy(() => lifetime.abort());
  onMount(() => { void run(refresh); });

  async function refresh() {
    const list = await listMcpServers(api, signal);
    if (!signal.aborted) rows = list;
  }

  async function run(work: () => Promise<void>, failure?: string) {
    if (busy || signal.aborted) return;
    message = "";
    busy = true;
    try { await work(); }
    catch (error) { if (!signal.aborted) message = failure || errorMessage(error); }
    finally { busy = false; }
  }

  function openWizard() {
    label = url = description = token = headers = formError = "";
    auth = "none";
    approval = true;
    wizard.showModal();
    void goToStep(1);
  }

  async function goToStep(next: number) {
    step = next;
    formError = "";
    await tick();
    wizard.querySelector<HTMLElement>("fieldset input, fieldset select")?.focus();
  }

  function closeWizard() {
    wizard.close();
    step = 0;
    token = headers = "";
    addButton.focus();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    formError = "";
    try {
      const identity = mcpIdentity(label, url);
      if (step < 3) {
        await goToStep(step + 1);
        return;
      }
      const credentials = auth === "bearer" ? mcpCredentials(token, headers) : {};
      const mode = auth;
      busy = true;
      let created: McpServer;
      try {
        created = await api.json<McpServer>("/mcp/servers", { method: "POST", body: {
          ...identity, ...credentials, server_description: description.trim() || undefined,
          auth_type: mode, enabled: true, require_approval: approval ? "always" : "never"
        }, signal });
      } catch {
        if (!signal.aborted) formError = "Impossible d’ajouter le serveur MCP. Vérifie l’adresse et les identifiants.";
        return;
      }
      if (signal.aborted) return;
      closeWizard();
      try { await refresh(); }
      catch { if (!signal.aborted) message = "Serveur ajouté. Impossible d’actualiser la liste."; }
      if (mode === "oauth" && created?.id) {
        try { await connect(created.id); }
        catch { if (!signal.aborted) message = "Serveur ajouté. Impossible de démarrer la connexion OAuth."; }
      }
    } catch (error) {
      if (!signal.aborted) formError = errorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function connect(id: string) {
    oauth = null;
    code = "";
    const flow = await startMcpOAuth(api, id, signal);
    if (!signal.aborted) oauth = flow;
  }

  function change(server: McpServer, action: "toggle" | "discover" | "delete") {
    if (action === "delete" && !window.confirm("Supprimer le serveur « " + (server.server_label || server.id) + " » ?")) return;
    return run(async () => {
      const path = mcpPath(server.id);
      await api.json(path + (action === "discover" ? "/discover" : ""), {
        method: action === "delete" ? "DELETE" : "POST",
        body: action === "toggle" ? { enabled: server.enabled === false } : action === "discover" ? {} : undefined,
        signal
      });
      if (action === "delete" && oauth?.id === server.id) { oauth = null; code = ""; }
      await refresh();
    });
  }

  function finishOAuth(event: SubmitEvent) {
    event.preventDefault();
    const flow = oauth;
    if (!flow || busy) return;
    let authorization: string;
    try { authorization = mcpOAuthCode(code, flow.state); }
    catch (error) { message = errorMessage(error); return; }
    void run(async () => {
      await api.json("/mcp/servers/oauth/complete", { method: "POST", body: { code: authorization, state: flow.state }, signal });
      oauth = null;
      code = "";
      await refresh();
    }, "Impossible de terminer la connexion OAuth.");
  }
</script>

<div id="panel-mcp" class="settings-panel" role="tabpanel" aria-labelledby="tab-mcp">
  <h3 class="settings-section-title">Serveurs MCP</h3>
  <div class="settings-item-actions">
    <button type="button" class="settings-btn" bind:this={addButton} disabled={busy} onclick={openWizard}>Ajouter MCP</button>
    <button type="button" class="settings-btn" disabled={busy} onclick={() => void run(refresh)}>Actualiser</button>
  </div>
  {#if message}<p class="settings-error" role="alert">{message}</p>{/if}
  {#if busy}<p class="settings-hint" role="status">Opération en cours…</p>{/if}
  {#if !busy && !message && !rows.length}<p class="settings-hint">Aucun serveur MCP.</p>{/if}
  {#each rows as server (server.id)}
    <article class="settings-item" data-mcp-id={server.id}>
      <div class="settings-item-head">
        <div class="settings-item-info"><strong>{server.server_label || server.id}</strong><div class="settings-item-sub">{server.server_url ?? ""}</div></div>
        <label><input type="checkbox" role="switch" aria-label={"Activer " + (server.server_label || server.id)} checked={server.enabled !== false} disabled={busy} onchange={event => { event.currentTarget.checked = server.enabled !== false; void change(server, "toggle"); }}> {server.enabled !== false ? "Activé" : "Désactivé"}</label>
      </div>
      {#if server.server_description}<p class="settings-item-desc">{server.server_description}</p>{/if}
      <div class="settings-badges">
        <span class="settings-badge">{server.available_tools?.length ?? 0} outil(s)</span>
        {#if server.has_authorization}<span class="settings-badge ok">Authentifié</span>{/if}
        {#if server.oauth_status && server.oauth_status !== "none"}<span class="settings-badge">OAuth · {server.oauth_status}</span>{/if}
        {#if server.require_approval === "always"}<span class="settings-badge">Approbation requise</span>{/if}
      </div>
      {#if server.available_tools?.length}
        <details class="settings-tools"><summary>Voir les outils</summary><ul class="settings-tool-list">
          {#each server.available_tools as tool}<li><strong>{tool.title || tool.name}</strong><span>{tool.description ?? ""}</span></li>{/each}
        </ul></details>
      {/if}
      <div class="settings-item-actions">
        {#if server.auth_type === "oauth"}<button type="button" class="settings-btn" disabled={busy} onclick={() => void run(() => connect(server.id), "Impossible de démarrer la connexion OAuth.")}>Connecter mon compte</button>{/if}
        <button type="button" class="settings-btn" disabled={busy} onclick={() => void change(server, "discover")}>Actualiser les outils</button>
        <button type="button" class="settings-btn danger" disabled={busy} onclick={() => void change(server, "delete")}>Supprimer</button>
      </div>
      {#if oauth?.id === server.id}
        <form class="settings-form" onsubmit={finishOAuth}>
          <a href={oauth.url} target="_blank" rel="noopener noreferrer">Ouvrir la connexion OAuth</a>
          <label class="settings-label">Code d’autorisation ou URL de retour <input class="settings-input" autocomplete="off" type="password" bind:value={code} required></label>
          <div class="settings-item-actions"><button class="settings-btn" disabled={busy}>Terminer la connexion</button><button type="button" class="settings-btn" disabled={busy} onclick={() => { oauth = null; code = ""; }}>Annuler</button></div>
        </form>
      {/if}
    </article>
  {/each}
  <dialog class="project-editor" aria-label="Ajouter un serveur MCP" bind:this={wizard} oncancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) closeWizard(); }}>
    <form class="settings-form" onsubmit={submit}>
      <h3>Ajouter un serveur MCP</h3>
      <p class="settings-hint">Étape {step} sur 3</p>
      <fieldset disabled={busy}>
        {#if step === 1}
          <label class="settings-label">Nom <input class="settings-input" bind:value={label} required></label>
          <label class="settings-label">URL <input class="settings-input" type="url" inputmode="url" bind:value={url} required></label>
          <label class="settings-label">Description <textarea class="settings-input" bind:value={description}></textarea></label>
        {:else if step === 2}
          <label class="settings-label">Authentification <select class="settings-input" bind:value={auth}><option value="none">Sans authentification</option><option value="bearer">Token ou en-têtes</option><option value="oauth">OAuth</option></select></label>
          {#if auth === "bearer"}
            <label class="settings-label">Token <input class="settings-input" type="password" autocomplete="off" bind:value={token}></label>
            <label class="settings-label">En-têtes JSON <input class="settings-input" type="password" autocomplete="off" bind:value={headers}></label>
          {/if}
        {:else if step === 3}
          <p>{label} · {url}</p>
          <label class="settings-label"><input type="checkbox" bind:checked={approval}> Demander une approbation avant chaque appel</label>
        {/if}
      </fieldset>
      {#if formError}<p class="settings-error" role="alert">{formError}</p>{/if}
      <div class="settings-item-actions">
        <button type="button" class="settings-btn" disabled={busy} onclick={() => step > 1 ? void goToStep(step - 1) : closeWizard()}>{step > 1 ? "Retour" : "Annuler"}</button>
        <button class="settings-btn primary" disabled={busy}>{step === 3 ? "Ajouter le serveur" : "Continuer"}</button>
      </div>
    </form>
  </dialog>
</div>
