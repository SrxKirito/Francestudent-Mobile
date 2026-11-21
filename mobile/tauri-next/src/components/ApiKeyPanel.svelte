<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import { copyText } from "../lib/utils/clipboard.ts";

  let { api }: { api: ApiClient } = $props();
  const hint = "Consulte ta clé et ton budget API.";
  let message = $state(hint);
  let key = $state("");
  let busy = $state(false);
  let request: AbortController | undefined;

  function clear() {
    request?.abort();
    key = "";
    message = hint;
  }

  onDestroy(clear);

  async function update(method: "GET" | "POST" | "DELETE") {
    if (busy) return;
    if (method === "POST" && !window.confirm("Générer une clé remplacera la clé existante. Continuer ?")) return;
    if (method === "DELETE" && !window.confirm("Révoquer la clé API actuelle ?")) return;
    const controller = request = new AbortController();
    key = "";
    busy = true;
    message = "Chargement…";
    try {
      const result = await api.json<{ key?: string; maskedKey?: string; budget?: { remainingUsd?: number } }>("/user/@me/api-key", { method, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (method === "DELETE") message = "Clé API révoquée.";
      else if (method === "POST" && typeof result?.key === "string" && result.key) {
        key = result.key;
        message = "Copie cette clé maintenant. Elle ne sera plus affichée en clair.";
      } else {
        const remaining = result?.budget?.remainingUsd;
        message = result?.maskedKey ? "Clé : " + result.maskedKey + "." : "Aucune clé affichée.";
        if (Number.isFinite(remaining) && typeof remaining === "number") {
          message += " Budget restant : " + remaining.toLocaleString("fr-FR", { style: "currency", currency: "USD" }) + ".";
        }
      }
    } catch {
      if (!controller.signal.aborted) message = "Opération impossible. Vérifie l’état de la clé avant de réessayer.";
    } finally {
      request = undefined;
      busy = false;
    }
  }

  async function copyKey() {
    const value = key;
    if (value && await copyText(value) && key === value) message = "Clé copiée dans le presse-papiers.";
  }
</script>

<svelte:document onvisibilitychange={() => { if (document.hidden) clear(); }} />
<section id="account-api-key" class="account-activity" aria-label="Clé API">
  <h3 class="settings-section-title">Clé API</h3>
  <p class="settings-hint" role="status">{message}</p>
  {#if key}
    <p><code class="api-key-value">{key}</code></p>
    <button type="button" class="settings-btn small" onclick={copyKey}>Copier la clé</button>
    <button type="button" class="settings-btn small" onclick={clear}>Masquer</button>
  {/if}
  <div class="settings-item-actions">
    <button type="button" class="settings-btn small" onclick={() => void update("GET")} disabled={busy}>Consulter</button>
    <button type="button" class="settings-btn small" onclick={() => void update("POST")} disabled={busy}>Générer une clé</button>
    <button type="button" class="settings-btn small danger" onclick={() => void update("DELETE")} disabled={busy}>Révoquer</button>
  </div>
</section>

<style>
  .api-key-value { overflow-wrap: anywhere; user-select: all; }
</style>
