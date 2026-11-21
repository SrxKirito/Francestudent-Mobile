<script lang="ts">
  import { untrack } from "svelte";
  import type { FileThumbnail, WorkspaceEngine } from "../lib/services/workspace-engine.ts";

  let { engine, id, local, name }: { engine: WorkspaceEngine; id: string; local: boolean; name: string } = $props();
  let node: HTMLElement | undefined = $state();
  let thumbnail = $state.raw<FileThumbnail | null>(null);

  $effect(() => {
    if (!node) return;
    const target = node;
    const request = local ? engine.localThumbnail : engine.thumbnail;
    const fileId = id;
    let resource: FileThumbnail | undefined;
    const controller = new AbortController();
    const load = () => {
      void Promise.resolve().then(() => request(fileId, controller.signal)).then(result => {
        if (controller.signal.aborted) result.release();
        else { resource = result; thumbnail = result; }
      }).catch(() => {});
    };
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries, current) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      current.disconnect();
      load();
    }, { rootMargin: "120px" }) : null;
    if (observer) observer.observe(target);
    else load();
    return () => {
      controller.abort();
      observer?.disconnect();
      resource?.release();
      untrack(() => { thumbnail = null; });
    };
  });
</script>

<span class="library-thumbnail" aria-hidden="true" bind:this={node}>
  {#if thumbnail?.type === "image" && thumbnail.url}
    <img src={thumbnail.url} alt="" decoding="async">
  {:else if thumbnail?.type === "text"}
    <pre>{thumbnail.text}</pre>
  {:else}
    {name.includes(".") ? name.split(".").at(-1)?.toUpperCase().slice(0, 10) : "FICHIER"}
  {/if}
</span>
