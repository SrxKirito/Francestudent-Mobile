<script lang="ts">
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<details class="render-options">
  <summary aria-label={label} title={label}>⋯</summary>
  <div class="render-options-body">
    {@render children()}
  </div>
</details>

<style>
  details { margin-block: .3rem; min-width: 0; }
  summary { display: grid; place-items: center; width: 44px; height: 44px; list-style: none; cursor: pointer;
    border: 1px solid var(--border); border-radius: .75rem; font-size: 1.25rem; color: var(--text); background: var(--surface); }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .render-options-body { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; padding: .4rem 0 0; }
  .render-options-body :global(button) { min-height: 44px; }
</style>
