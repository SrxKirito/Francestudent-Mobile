<script lang="ts">
  import type { InteractiveContent } from "../lib/services/interactive-content.ts";
  import InteractiveChart from "./InteractiveChart.svelte";
  import StudyBlock from "./StudyBlock.svelte";
  import InteractiveTable from "./InteractiveTable.svelte";
  import InteractiveForm from "./InteractiveForm.svelte";
  import InteractiveCollection from "./InteractiveCollection.svelte";
  import InteractiveMap from "./InteractiveMap.svelte";
  import InteractiveEditor from "./InteractiveEditor.svelte";
  let { data }: { data: InteractiveContent } = $props();
</script>

{#if data.kind === "study"}
  <StudyBlock data={data.content} />
{:else if data.kind === "chart"}
  <InteractiveChart {data} />
{:else if data.kind === "table"}
  <InteractiveTable title={data.title} columns={data.columns} rows={data.rows} />
{:else if data.kind === "form" || data.kind === "simulator"}
  <InteractiveForm {data} />
{:else if data.kind === "map"}
  <InteractiveMap {data} />
{:else if data.kind === "editor"}
  <InteractiveEditor title={data.title} text={data.text} />
{:else if data.kind === "checklist" || data.kind === "accordion" || data.kind === "popover"}
  <section aria-label={data.title}>
    <strong>{data.title}</strong>
    {#if data.kind === "checklist"}
      {#each data.items as item, index (index)}
        <label><input type="checkbox"> <span>{item}</span></label>
      {/each}
    {:else}
      {#each data.items as item, index (index)}
        <details class:popover-details={data.kind === "popover"}><summary>{item.title}</summary><p>{item.content}</p></details>
      {/each}
    {/if}
  </section>
{:else if data.kind === "cards" || data.kind === "carousel" || data.kind === "timeline" || data.kind === "animation" || data.kind === "diagram"}
  <InteractiveCollection {data} />
{/if}

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; overflow-wrap: anywhere; }
  label, summary { padding: .35rem 0; cursor: pointer; }
  label { display: flex; align-items: baseline; gap: .4rem; }
  details p { margin: 0 0 .45rem; white-space: pre-wrap; }
  .popover-details summary { display: list-item; padding: .6rem 0; }
  .popover-details p { padding: .65rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); }
</style>
