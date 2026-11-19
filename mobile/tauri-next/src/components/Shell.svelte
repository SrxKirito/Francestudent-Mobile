<script lang="ts">
  import { onMount } from "svelte";
  import AppLayout from "./AppLayout.svelte";
  import Login from "./Login.svelte";
  import Startup from "./Startup.svelte";
  import { createRuntimeSessionFlow } from "../lib/services/session-runtime.ts";
  import { SessionStore } from "../lib/stores/session.svelte.ts";
  import { parseStoredState, STORE_KEY } from "../lib/utils/state.ts";
  import { applyTheme } from "../lib/utils/theme.ts";

  interface Props {
    /** Chat Svelte (?chat=svelte) : charge aussi les feuilles propres au chat (messages, KaTeX, code PIN). */
    chatMode?: boolean;
  }

  let { chatMode = false }: Props = $props();

  const session = new SessionStore(createRuntimeSessionFlow());
  let stylesReady = $state(false);

  // Même viewport que mobile/www/index.html (zoom bloqué, le clavier redimensionne le contenu).
  const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content";

  onMount(() => {
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", VIEWPORT);
    void (async () => {
      // Les feuilles historiques sont chargées ici seulement : le chemin iframe n'en dépend pas.
      await import("../styles/legacy.ts");
      if (chatMode) {
        await import("../styles/chat.css");
        await import("../../locked-chats-ui.css");
        // Feuille KaTeX servie par le dossier legacy (polices comprises) ; le script est chargé à la demande par le chat.
        const katex = document.createElement("link");
        katex.rel = "stylesheet";
        katex.href = "/legacy/katex/katex.min.css";
        document.head.append(katex);
      }
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
  <AppLayout {chatMode} />
{/if}
