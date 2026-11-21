<script lang="ts">
  import { renderCodeBlockInner, renderMarkdownText, parseMarkdownBlocks, fileIconSvg } from "../lib/services/markdown.ts";
  import { generatedArtifacts, generatedFile } from "../lib/services/file-preview.ts";
  import type { PreviewFile, GeneratedArtifact } from "../lib/services/file-preview.ts";
  import { parseStudyContent } from "../lib/services/study-content.ts";
  import StudyBlock from "./StudyBlock.svelte";

  let { content, katexReady, openPreview }: { content: string; katexReady: boolean; openPreview?: (file: PreviewFile) => void } = $props();
  const rendered = $derived.by(() => {
    void katexReady;
    const artifacts = generatedArtifacts(content);
    const byIndex = new Map(artifacts.map(file => [file.fenceIndex, file]));
    const parts = parseMarkdownBlocks(content).map(block => {
      if (block.type === "text") return { study: null, html: renderMarkdownText(block.content) };
      const study = block.open ? null : parseStudyContent(block.language, block.content);
      const artifact = byIndex.get(block.index);
      const documentOnly = Boolean(openPreview && artifact && /\.(pdf|pptx)$/i.test(artifact.name));
      return { study, html: study || documentOnly ? "" : renderCodeBlockInner(block.content, block.language) };
    });
    return { artifacts, parts };
  });

  function preview(artifact: GeneratedArtifact) {
    openPreview?.(generatedFile(artifact.name, artifact.code));
  }
</script>

{#each rendered.parts as part, index (index)}
  {#if part.study}
    {#key part.study}
      <StudyBlock data={part.study} />
    {/key}
  {:else}
    {@html part.html}
  {/if}
{/each}

{#if openPreview && rendered.artifacts.length}
  <div class="assistant-artifacts" role="group" aria-label="Fichiers à télécharger">
    {#each rendered.artifacts as artifact (artifact.fenceIndex)}
      <button type="button" class="artifact" onclick={() => preview(artifact)} title={"Aperçu de " + artifact.name}>
        {@html fileIconSvg(artifact.name)}
        <span>{artifact.name}</span>
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
    padding: .5rem .75rem;
    border: 1px solid var(--border);
    border-radius: .7rem;
    background: var(--surface);
    color: var(--text);
    text-align: start;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .artifact :global(svg) { flex: 0 0 auto; }
  .artifact:hover { background: var(--hover); }
</style>
