<script lang="ts">
  import { editorRevision, editorTextLimit, readEditorHistory, redoEditor, reviseEditor, undoEditor,
    type EditorHistory } from "../lib/services/document-editor.ts";
  import type { AppSession } from "../lib/services/interactive-app-session.ts";
  import { safeFileName } from "../lib/services/file-preview.ts";
  import { tick, untrack } from "svelte";
  import { highlightCode, renderMarkdownText } from "../lib/services/markdown.ts";
  import { saveBytes } from "../lib/services/file-saver.ts";

  let { title, text, session, language, fileName, startEditing = false }: {
    title: string; text: string; session?: AppSession; language?: string; fileName?: string; startEditing?: boolean;
  } = $props();
  let history = $state.raw<EditorHistory>(readEditorHistory(""));
  let textarea = $state<HTMLTextAreaElement>();
  let message = $state("");
  let saving = $state(false);
  let editing = $state(untrack(() => startEditing));
  let workspace = $state<HTMLDialogElement>();
  let expandButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();
  let expanded = $state(false);
  let workspaceMode = $state<"edit" | "preview">("edit");
  let selection: [number, number] = [0, 0];
  let returnFocus = true;
  let typing = false;
  const revision = $derived(editorRevision(title, text));
  const uid = $props.id();

  $effect(() => {
    const bound = session;
    const initial = text;
    history = readEditorHistory(initial, bound?.read(revision));
    return bound?.observe(snapshot => {
      history = readEditorHistory(initial, snapshot);
      typing = false;
      message = "Révision appliquée au document.";
    });
  });

  function setHistory(next: EditorHistory) {
    history = next;
    session?.save(revision, JSON.stringify(next));
    message = "";
  }

  function input(value: string) {
    if (value === history.current) return;
    setHistory(typing ? { ...history, current: value } : reviseEditor(history, value));
    typing = true;
  }

  function moveHistory(move: (current: EditorHistory) => EditorHistory) {
    typing = false;
    setHistory(move(history));
  }

  function rememberSelection() {
    if (textarea?.getClientRects().length) selection = [textarea.selectionStart, textarea.selectionEnd];
  }

  async function expand() {
    if (!workspace || workspace.open) return;
    rememberSelection();
    returnFocus = true;
    workspaceMode = "edit";
    workspace.showModal();
    expanded = true;
    await tick();
    textarea?.setSelectionRange(...selection);
    closeButton?.focus();
  }

  async function finishWorkspace() {
    expanded = false;
    await tick();
    textarea?.setSelectionRange(...selection);
    if (returnFocus) expandButton?.focus({ preventScroll: true });
  }

  function closeWorkspace(restoreFocus = true) {
    rememberSelection();
    returnFocus = restoreFocus;
    workspace?.close();
  }

  function requestRevision() {
    if (!session?.followUp) return;
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    const partial = start < end && Boolean(textarea?.getClientRects().length);
    if (workspace?.open) closeWorkspace(false);
    session.followUp({ kind: "editor", title, revision, language, text: history.current,
      start: partial ? start : 0, end: partial ? end : history.current.length });
  }

  async function save() {
    saving = true;
    try {
      await saveBytes(safeFileName(fileName ?? title.slice(0, 130) + ".md"), new TextEncoder().encode(history.current));
      message = "Document enregistré.";
    } catch {
      message = "Enregistrement interrompu.";
    } finally { saving = false; }
  }
</script>

{#snippet editBox(id: string)}
  <textarea {id} aria-label={"Modifier " + title} class="settings-input" rows="8" maxlength={editorTextLimit}
    bind:this={textarea} value={history.current} oninput={event => input(event.currentTarget.value)}
    class:source={Boolean(language)} onblur={() => { typing = false; }}></textarea>
{/snippet}

{#snippet preview(id: string)}
  {#if language}
    <pre {id} class="editor-preview"><code>{@html highlightCode(history.current, language)}</code></pre>
  {:else}
    <article {id} class="editor-preview">{@html renderMarkdownText(history.current)}</article>
  {/if}
{/snippet}

{#snippet documentActions()}
  {#if session?.followUp}
    <button type="button" class="settings-btn" onclick={requestRevision}>Demander une révision</button>
  {/if}
  <button type="button" class="settings-btn" disabled={!history.past.length} onclick={() => moveHistory(undoEditor)}>Annuler la dernière modification</button>
  <button type="button" class="settings-btn" disabled={!history.future.length} onclick={() => moveHistory(redoEditor)}>Rétablir la modification</button>
  <button type="button" class="settings-btn" disabled={saving} onclick={() => void save()}>Enregistrer une copie</button>
{/snippet}

{#if !expanded}
  <section class="interactive-editor" aria-label={title}>
    <strong>{title}</strong>
    {#if editing}{@render editBox(uid)}
    {:else}{@render preview(uid)}{/if}
    <div class="editor-actions">
      <button type="button" class="settings-btn" aria-controls={uid} onclick={() => editing = !editing}>{editing ? "Voir l’aperçu" : "Modifier"}</button>
      <button type="button" class="settings-btn" aria-haspopup="dialog" bind:this={expandButton} onclick={() => void expand()}>Agrandir l’éditeur</button>
      {@render documentActions()}
    </div>
    {#if message}<p role="status">{message}</p>{/if}
  </section>
{/if}

<dialog class="editor-workspace" aria-labelledby={uid + "-title"} bind:this={workspace}
  oncancel={() => rememberSelection()} onclose={() => void finishWorkspace()}>
  {#if expanded}
    <header class="workspace-header">
      <h2 id={uid + "-title"}>{title}</h2>
      <button type="button" class="settings-btn" bind:this={closeButton} onclick={() => closeWorkspace()}>Fermer l’éditeur agrandi</button>
    </header>
    <div class="editor-actions workspace-mode" role="group" aria-label="Affichage de l’éditeur">
      <button type="button" class="settings-btn" aria-pressed={workspaceMode === "edit"} aria-controls={uid + "-draft"}
        onclick={() => { workspaceMode = "edit"; }}>Modifier</button>
      <button type="button" class="settings-btn" aria-pressed={workspaceMode === "preview"} aria-controls={uid + "-preview"}
        onclick={() => { rememberSelection(); workspaceMode = "preview"; }}>Aperçu</button>
    </div>
    <div class="workspace-body" class:preview-only={workspaceMode === "preview"}>
      <div class="workspace-draft">{@render editBox(uid + "-draft")}</div>
      <div class="workspace-preview" role="region" aria-label="Aperçu du document">
        {@render preview(uid + "-preview")}
      </div>
    </div>
    <footer class="workspace-footer">
      <div class="editor-actions">{@render documentActions()}</div>
      {#if message}<p role="status">{message}</p>{/if}
    </footer>
  {/if}
</dialog>

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  .editor-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .editor-actions button, .workspace-header button { min-height: 44px; }
  .editor-preview { margin-block: .6rem; overflow-wrap: anywhere; }
  pre { overflow: auto; }
  textarea.source { font-family: ui-monospace, monospace; white-space: pre; }
  textarea { display: block; font-size: 16px; width: 100%; margin-block: .55rem; resize: vertical; }

  .editor-workspace {
    box-sizing: border-box;
    position: fixed;
    inset: 0;
    inset-block-start: var(--ios-viewport-top, 0px);
    width: min(72rem, 100%);
    height: var(--ios-viewport-height, 100dvh);
    max-width: 100%;
    max-height: var(--ios-viewport-height, 100dvh);
    margin: 0 auto;
    padding: 0;
    overflow: auto;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }
  .editor-workspace[open] { display: grid; grid-template-rows: auto auto minmax(3rem, 1fr) auto; }
  .editor-workspace::backdrop { background: #0009; }
  .workspace-header, .workspace-mode, .workspace-footer { padding: .65rem .8rem; background: var(--surface); }
  .workspace-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .5rem; border-bottom: 1px solid var(--border); }
  .workspace-header h2 { margin: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
  .workspace-mode { border-bottom: 1px solid var(--border); }
  .workspace-mode button[aria-pressed="true"] { background: var(--hover); }
  .workspace-body { min-height: 0; display: grid; }
  .workspace-draft, .workspace-preview { min-width: 0; min-height: 0; overflow: auto; }
  .workspace-draft { padding: .65rem .8rem; }
  .workspace-draft textarea { height: 100%; min-height: 4rem; margin: 0; resize: none; }
  .workspace-preview { display: none; padding: .65rem 1rem; }
  .preview-only .workspace-draft { display: none; }
  .preview-only .workspace-preview { display: block; }
  .workspace-footer { border-top: 1px solid var(--border); }
  .workspace-footer p { margin: .4rem 0 0; }
  @media (max-width: 819px) {
    .editor-workspace { border: 0; }
    .workspace-header { padding-top: max(.65rem, env(safe-area-inset-top)); }
    .workspace-footer { padding-bottom: max(.65rem, env(safe-area-inset-bottom)); }
  }
  @media (min-width: 820px) {
    .editor-workspace[open] { grid-template-rows: auto minmax(3rem, 1fr) auto; }
    .workspace-mode { display: none; }
    .workspace-body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .workspace-body .workspace-draft, .workspace-body .workspace-preview { display: block; }
    .workspace-preview { border-inline-start: 1px solid var(--border); }
  }
</style>
