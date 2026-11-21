<script lang="ts">
  import { onMount } from "svelte";
  import AppLayout from "./AppLayout.svelte";
  import Login from "./Login.svelte";
  import Startup from "./Startup.svelte";
  import { createRuntimeSessionFlow } from "../lib/services/session-runtime.ts";
  import { SessionStore } from "../lib/stores/session.svelte.ts";
  import { parseStoredState, STORE_KEY } from "../lib/utils/state.ts";
  import { installMobileViewport } from "../lib/utils/viewport.ts";
  import { chatMode, CHAT_FLAG_KEY } from "../lib/utils/ui-flag.ts";
  import { applyTheme } from "../lib/utils/theme.ts";

  const session = new SessionStore(createRuntimeSessionFlow());
  const legacyChat = chatMode(window.location.search, window.localStorage.getItem(CHAT_FLAG_KEY)) === "legacy";
  let stylesReady = $state(false);

  // Même viewport que mobile/www/index.html (zoom bloqué, le clavier redimensionne le contenu).
  const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content";

  onMount(() => {
    const stopViewport = installMobileViewport();
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", VIEWPORT);
    void (async () => {
      // Les feuilles historiques sont chargées ici seulement : le chemin iframe n'en dépend pas.
      await import("../styles/legacy.ts");
      await import("../styles/dialogs.css");
      await import("../styles/chat.css");
      const katex = document.createElement("link");
      katex.rel = "stylesheet";
      katex.href = "/legacy/katex/katex.min.css";
      document.head.append(katex);
      applyTheme(parseStoredState(window.localStorage.getItem(STORE_KEY), () => "").theme, document.documentElement);
      stylesReady = true;
      await session.start();
    })();
    return stopViewport;
  });
</script>

{#if !stylesReady || session.screen === "starting"}
  {#if stylesReady}<Startup />{/if}
{:else if session.screen === "login"}
  <Login {session} />
{:else}
  <AppLayout {legacyChat} tokens={session.tokens} onlogout={() => session.logout()} />
{/if}
