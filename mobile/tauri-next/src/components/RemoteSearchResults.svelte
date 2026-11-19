<script lang="ts">
  import "../../remote-chat-search.css";
  import type { RemoteSearchState } from "../lib/services/legacy-engine.ts";

  interface Props {
    search: RemoteSearchState;
    onopen: (index: number) => void;
  }

  let { search, onopen }: Props = $props();
</script>

<!-- Même balisage et mêmes classes que remote-chat-search.js. Rien n'est affiché tant que le serveur n'a rien à dire. -->
<div class="remote-chat-search-status" role="status" hidden={search.status === ""}>{search.status}</div>
<div class="remote-chat-search-results" hidden={search.results.length === 0}>
  {#each search.results as title, index (index)}
    <button type="button" class="remote-chat-search-result" onclick={() => onopen(index)}>{title}</button>
  {/each}
</div>
