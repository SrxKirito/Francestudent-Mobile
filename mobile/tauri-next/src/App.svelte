<script lang="ts">
  import LegacyFrame from "./components/LegacyFrame.svelte";
  import Shell from "./components/Shell.svelte";
  import { uiMode, UI_FLAG_KEY } from "./lib/utils/ui-flag.ts";

  // Transition : l'iframe historique reste l'interface par défaut ; la nouvelle coque s'active avec ?ui=svelte.
  const mode = uiMode(window.location.search, window.localStorage.getItem(UI_FLAG_KEY));
</script>

{#if mode === "svelte"}
  <Shell />
{:else}
  <LegacyFrame />
{/if}
