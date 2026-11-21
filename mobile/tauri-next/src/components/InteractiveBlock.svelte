<script lang="ts">
  import type { InteractiveContent } from "../lib/services/interactive-content.ts";
  import InteractiveChart from "./InteractiveChart.svelte";
  import StudyBlock from "./StudyBlock.svelte";
  let { data }: { data: InteractiveContent } = $props();
</script>

{#if data.kind === "study"}
  <StudyBlock data={data.content} />
{:else if data.kind === "chart"}
  <InteractiveChart {data} />
{:else}
  <section aria-label={data.title}>
    <strong>{data.title}</strong>
    {#if data.kind === "checklist"}
      {#each data.items as item, index (index)}
        <label><input type="checkbox"> <span>{item}</span></label>
      {/each}
    {:else}
      {#each data.items as item, index (index)}
        <details><summary>{item.title}</summary><p>{item.content}</p></details>
      {/each}
    {/if}
  </section>
{/if}

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; overflow-wrap: anywhere; }
  label, summary { padding: .35rem 0; cursor: pointer; }
  label { display: flex; align-items: baseline; gap: .4rem; }
  details p { margin: 0 0 .45rem; white-space: pre-wrap; }
</style>
