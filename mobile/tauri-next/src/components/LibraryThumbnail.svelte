<script lang="ts">
  import { untrack } from "svelte";
  import type { FileThumbnail, WorkspaceEngine } from "../lib/services/workspace-engine.ts";
  import WorkspaceIcon from "./WorkspaceIcon.svelte";

  let { engine, id, local, name, compact = false, eager = false }: { engine: WorkspaceEngine; id: string; local: boolean; name: string; compact?: boolean; eager?: boolean } = $props();
  let node: HTMLElement | undefined = $state();
  let thumbnail = $state.raw<FileThumbnail | null>(null);

  $effect(() => {
    if (!node) return;
    const request = local ? engine.localThumbnail : engine.thumbnail;
    const fileId = id;
    let resource: FileThumbnail | undefined;
    let controller: AbortController | undefined;
    function release() {
      controller?.abort();
      controller = undefined;
      resource?.release();
      resource = undefined;
      untrack(() => { thumbnail = null; });
    }
    function load() {
      if (controller) return;
      const task = controller = new AbortController();
      void (async () => {
        try {
          const result = await request(fileId, task.signal);
          if (task.signal.aborted) result.release();
          else { resource = result; thumbnail = result; }
        } catch { /* Le pictogramme reste visible. */ }
      })();
    }
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load();
      else if (!eager) release();
    }, { rootMargin: "160px" }) : null;
    if (eager || !observer) load();
    if (observer) observer.observe(node);
    return () => { observer?.disconnect(); release(); };
  });
</script>

<span class="library-thumbnail thumbnail" class:compact aria-hidden="true" bind:this={node}>
  {#if thumbnail?.type === "image" && thumbnail.url}
    <img src={thumbnail.url} alt="" decoding="async" onerror={() => { thumbnail = null; }}>
  {:else if thumbnail?.type === "text"}
    <span class="excerpt">{thumbnail.text}</span>
  {:else}
    <WorkspaceIcon name={engine.fileKind(name) === "image" ? "image" : "file"} size={compact ? 18 : 26} />
  {/if}
</span>

<style>
  .thumbnail { display: grid; place-items: center; overflow: hidden; background: var(--bg); color: var(--muted); border: 1px solid var(--border); }
  .thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .thumbnail .excerpt { align-self: start; width: 100%; padding: 8px; box-sizing: border-box; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); font: .64rem/1.35 monospace; }
  .thumbnail.compact .excerpt { padding: 3px; font-size: 4px; }
  .thumbnail.compact { width: 36px; height: 36px; aspect-ratio: 1; border-radius: 8px; flex: none; }
</style>
