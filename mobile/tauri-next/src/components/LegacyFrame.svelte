<!-- Interface historique : référence visuelle tant que les écrans ne sont pas tous migrés.
     Les ponts natifs (jeton, Keychain, envoi, flux) sont fournis par installLegacyTransport(). -->
<script lang="ts">
  interface Props {
    /** Appelé à chaque chargement de la page de l'iframe, avec sa fenêtre (pour relier la coque Svelte au moteur historique). */
    onframe?: (frameWindow: Window | null) => void;
    /** Chat Svelte au premier plan : l'iframe reste vivante (moteur) mais ne reçoit ni clic ni focus. */
    inert?: boolean;
  }

  let { onframe, inert = false }: Props = $props();
  let frame: HTMLIFrameElement | undefined = $state();
</script>

<iframe bind:this={frame} title="France Student" src="/legacy/index.html" allow="web-share" {inert} onload={() => onframe?.(frame?.contentWindow ?? null)}></iframe>

<style>
  iframe { display: block; width: 100%; height: 100dvh; border: 0; }
</style>
