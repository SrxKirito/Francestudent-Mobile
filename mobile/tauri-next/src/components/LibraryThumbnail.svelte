<script lang="ts">
  import { untrack } from "svelte";
  import type { FileThumbnail, WorkspaceEngine } from "../lib/services/workspace-engine.ts";
  import WorkspaceIcon from "./WorkspaceIcon.svelte";

  let { engine, id, local, name, compact = false }: { engine: WorkspaceEngine; id: string; local: boolean; name: string; compact?: boolean } = $props();
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
      else release();
    }, { rootMargin: "160px" }) : null;
    if (observer) observer.observe(node);
    else load();
    return () => { observer?.disconnect(); release(); };
  });
</script>

<span class="library-thumbnail thumbnail" class:compact aria-hidden="true" bind:this={node}>
  {#if thumbnail?.type === "image" && thumbnail.url}
    <img src={thumbnail.url} alt="" decoding="async" onerror={() => { thumbnail = null; }}>
  {:else if thumbnail?.type === "text" && !compact}
    <pre>{thumbnail.text}</pre>
  {:else}
    <WorkspaceIcon name={engine.fileKind(name) === "image" ? "image" : "file"} size={compact ? 18 : 26} />
  {/if}
</span>

<style>
  .thumbnail { display: grid; place-items: center; overflow: hidden; background: var(--bg); color: var(--muted); border: 1px solid var(--border); }
  .thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .thumbnail.compact { width: 36px; height: 36px; aspect-ratio: 1; border-radius: 8px; flex: none; }
</style>
