<script lang="ts">
  import { onMount } from "svelte";
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
  let layout: Promise<typeof import("./AppLayout.svelte")> | undefined;

  function loadLayout() {
    return layout ??= import("./AppLayout.svelte");
  }

  // Même viewport que mobile/www/index.html (zoom bloqué, le clavier redimensionne le contenu).
  const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content";

  onMount(() => {
    const stopViewport = installMobileViewport();
    void session.start();
    if (window.localStorage.getItem(STORE_KEY + ":account-owner")) {
      void loadLayout().catch(() => { layout = undefined; });
    }
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", VIEWPORT);
    void (async () => {
      await import("../styles/native-shell.ts");
      applyTheme(parseStoredState(window.localStorage.getItem(STORE_KEY), () => "").theme, document.documentElement);
      stylesReady = true;
    })();
    return stopViewport;
  });
</script>

{#if !stylesReady || session.screen === "starting"}
  {#if stylesReady}<Startup />{/if}
{:else if session.screen === "login"}
  <Login {session} />
{:else}
  {#await loadLayout()}
    <Startup />
  {:then { default: AppLayout }}
    <AppLayout {legacyChat} tokens={session.tokens} onlogout={() => session.logout()} />
  {:catch}
    <p role="alert">Impossible de charger le chat. Rouvre l’application.</p>
  {/await}
{/if}
