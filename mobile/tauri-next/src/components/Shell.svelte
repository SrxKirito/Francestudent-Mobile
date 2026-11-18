<script lang="ts">
  import { onMount } from "svelte";
  import LegacyFrame from "./LegacyFrame.svelte";
  import Login from "./Login.svelte";
  import Startup from "./Startup.svelte";
  import { createRuntimeSessionFlow } from "../lib/services/session-runtime.ts";
  import { SessionStore } from "../lib/stores/session.svelte.ts";
  import { parseStoredState, STORE_KEY } from "../lib/utils/state.ts";
  import { applyTheme } from "../lib/utils/theme.ts";

  const session = new SessionStore(createRuntimeSessionFlow());
  let stylesReady = $state(false);

  // Même viewport que mobile/www/index.html (zoom bloqué, le clavier redimensionne le contenu).
  const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content";

  onMount(() => {
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", VIEWPORT);
    void (async () => {
      // Les feuilles historiques sont chargées ici seulement : le chemin iframe n'en dépend pas.
      await import("../styles/legacy.ts");
      applyTheme(parseStoredState(window.localStorage.getItem(STORE_KEY), () => "").theme, document.documentElement);
      stylesReady = true;
      await session.start();
    })();
  });
</script>

{#if !stylesReady || session.screen === "starting"}
  {#if stylesReady}<Startup />{/if}
{:else if session.screen === "login"}
  <Login {session} />
{:else}
  <LegacyFrame />
{/if}
