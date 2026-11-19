<script lang="ts">
  import LegacyFrame from "./components/LegacyFrame.svelte";
  import Shell from "./components/Shell.svelte";
  import { chatMode, CHAT_FLAG_KEY, uiMode, UI_FLAG_KEY } from "./lib/utils/ui-flag.ts";

  // Transition : l'iframe historique reste l'interface par défaut ; la nouvelle coque s'active avec ?ui=svelte.
  const mode = uiMode(window.location.search, window.localStorage.getItem(UI_FLAG_KEY));
  // Sous-drapeau : le chat Svelte (?chat=svelte) ne s'applique qu'avec la nouvelle coque.
  const chat = chatMode(window.location.search, window.localStorage.getItem(CHAT_FLAG_KEY)) === "svelte";
</script>

{#if mode === "svelte"}
  <Shell chatMode={chat} />
{:else}
  <LegacyFrame />
{/if}
