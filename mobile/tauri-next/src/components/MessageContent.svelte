<script lang="ts">
  import FileFormatPreview from "./FileFormatPreview.svelte";
  import { renderCodeBlockInner, renderMarkdownText, parseMarkdownBlocks } from "../lib/services/markdown.ts";
  import { generatedArtifacts, generatedFile } from "../lib/services/file-preview.ts";
  import type { PreviewFile, GeneratedArtifact } from "../lib/services/file-preview.ts";
  import type { AppSession } from "../lib/services/interactive-app-session.ts";
  import { parseInteractiveContent, type InteractiveContent } from "../lib/services/interactive-content.ts";

  let { content, katexReady, openPreview, streaming = false, appSession, applyEditorEdit, editLanguage }: {
    content: string; katexReady: boolean; openPreview?: (file: PreviewFile) => void; streaming?: boolean;
    appSession?: (fence: number, kind: InteractiveContent["kind"]) => AppSession | undefined;
    applyEditorEdit?: (replacement: string) => string;
    editLanguage?: string;
  } = $props();
  const completed = new Map<number, { source: string; language: string; data: InteractiveContent | null }>();

  function interactiveAt(index: number, source: string, language: string): InteractiveContent | null {
    const cached = completed.get(index);
    if (cached?.source === source && cached.language === language) return cached.data;
    const data = parseInteractiveContent(language, source);
    completed.set(index, { source, language, data });
    return data;
  }

  const rendered = $derived.by(() => {
    void katexReady;
    const artifacts = streaming ? [] : generatedArtifacts(content);
    const byIndex = new Map(artifacts.map(file => [file.fenceIndex, file]));
    const parts = parseMarkdownBlocks(content).map(block => {
      if (block.type === "text") return { interactive: null, inline: null, status: "", html: renderMarkdownText(block.content) };
      const structured = /^(frst-ui|quiz|cards)$/i.test(block.language);
      const interactive = structured && (!streaming || !block.open)
        ? interactiveAt(block.index, block.content, block.language) : null;
      if (streaming && (!interactive || (interactive.kind === "app" || interactive.kind === "editor" || interactive.kind === "editor-edit"))) {
        return { interactive: null, inline: null, html: "",
          status: structured || /^html?$/i.test(block.language) ? "Préparation de l’aperçu…" : "Préparation du bloc de code…" };
      }
      const artifact = byIndex.get(block.index);
      const inline = artifact && /\.html?$/i.test(artifact.name) ? artifact : null;
      const documentOnly = Boolean(openPreview && artifact && /\.(pdf|pptx|docx|xlsx)$/i.test(artifact.name));
      return { interactive, inline, fence: block.index,
        status: structured && !interactive ? "Ce rendu interactif n’a pas pu être affiché. Tu peux régénérer la réponse." : "",
        html: structured || inline || documentOnly ? "" : renderCodeBlockInner(block.content, block.language) };
    });
    return { artifacts: artifacts.filter(file => !/\.html?$/i.test(file.name)), parts };
  });

  function preview(artifact: GeneratedArtifact) {
    openPreview?.(generatedFile(artifact.name, artifact.code));
  }
</script>

{#each rendered.parts as part, index (index)}
  {#if part.interactive}
    {#await import("./InteractiveBlock.svelte") then { default: InteractiveBlock }}
      <InteractiveBlock data={part.interactive} session={appSession?.(part.fence ?? index, part.interactive.kind)} {applyEditorEdit} {editLanguage} />
    {:catch}
      <p role="status">Rendu interactif indisponible.</p>
    {/await}
  {:else if part.inline}
    {@const artifact = part.inline}
    {#await import("./InlineHtmlPreview.svelte") then { default: InlineHtmlPreview }}
      <InlineHtmlPreview name={artifact.name} source={artifact.code} onexpand={openPreview ? () => preview(artifact) : undefined} />
    {:catch}
      {@html renderCodeBlockInner(artifact.code, "html")}
    {/await}
  {:else if part.status}
    <p class="settings-hint render-status">{part.status}</p>
  {:else}
    {@html part.html}
  {/if}
{/each}

{#if openPreview && rendered.artifacts.length}
  <div class="assistant-artifacts" role="group" aria-label="Fichiers à télécharger">
    {#each rendered.artifacts as artifact (artifact.fenceIndex)}
      <button type="button" class="artifact" onclick={() => preview(artifact)} title={"Aperçu de " + artifact.name}>
        <FileFormatPreview name={artifact.name} />
        <span class="artifact-name">{artifact.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .render-status { margin-block: .65rem; }
  .assistant-artifacts { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: .85rem; }
  .artifact {
    display: inline-flex;
    align-items: center;
    gap: .55rem;
    max-width: 100%;
    min-height: 42px;
    padding: .38rem .75rem .38rem .38rem;
    border: 1px solid var(--border);
    border-radius: .7rem;
    background: var(--surface);
    color: var(--text);
    text-align: start;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .artifact-name { min-width: 0; }
  .artifact:hover { background: var(--hover); }
</style>
