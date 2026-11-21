<script lang="ts">
  import FileFormatPreview from "./FileFormatPreview.svelte";
  import { renderCodeBlockInner, renderMarkdownText, parseMarkdownBlocks } from "../lib/services/markdown.ts";
  import { generatedArtifacts, generatedFile } from "../lib/services/file-preview.ts";
  import type { PreviewFile, GeneratedArtifact } from "../lib/services/file-preview.ts";
  import { parseInteractiveContent } from "../lib/services/interactive-content.ts";

  let { content, katexReady, openPreview }: { content: string; katexReady: boolean; openPreview?: (file: PreviewFile) => void } = $props();
  const rendered = $derived.by(() => {
    void katexReady;
    const artifacts = generatedArtifacts(content);
    const byIndex = new Map(artifacts.map(file => [file.fenceIndex, file]));
    const parts = parseMarkdownBlocks(content).map(block => {
      if (block.type === "text") return { interactive: null, inline: null, html: renderMarkdownText(block.content) };
      const interactive = block.open ? null : parseInteractiveContent(block.language, block.content);
      const artifact = byIndex.get(block.index);
      const inline = artifact && /\.html?$/i.test(artifact.name) ? artifact : null;
      const documentOnly = Boolean(openPreview && artifact && /\.(pdf|pptx|docx|xlsx)$/i.test(artifact.name));
      return { interactive, inline, html: interactive || inline || documentOnly ? "" : renderCodeBlockInner(block.content, block.language) };
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
      <InteractiveBlock data={part.interactive} />
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
