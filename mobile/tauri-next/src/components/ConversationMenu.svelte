<script lang="ts">
  import { menuPosition, pinLabel } from "../lib/utils/menu.ts";
  import type { AnchorRect } from "../lib/utils/menu.ts";

  interface Props {
    open: boolean;
    pinned: boolean;
    /** Rectangle du bouton « ⋯ » sur lequel le menu s'ancre. */
    anchor: AnchorRect | null;
    onpin: () => void;
    onrename: () => void;
    ondelete: () => void;
  }

  let { open, pinned, anchor, onpin, onrename, ondelete }: Props = $props();

  let menu: HTMLDivElement | undefined = $state();

  // Positionné après l'affichage (la taille n'est connue que lorsque le menu n'est plus masqué), comme l'ancienne interface.
  $effect(() => {
    if (!open || !anchor || !menu) return;
    const position = menuPosition(
      anchor,
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    menu.style.left = position.left + "px";
    menu.style.top = position.top + "px";
  });
</script>

<!-- Le clic ne doit pas atteindre le gestionnaire « clic en dehors » qui ferme les menus. -->
<!-- Même balisage que l'ancienne interface (pas de tabindex : le focus est géré par les boutons internes). -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_interactive_supports_focus -->
<div id="conv-menu" class="popover conv-menu" class:hidden={!open} role="menu" bind:this={menu} onclick={event => event.stopPropagation()}>
  <button type="button" id="conv-pin" class="menu-item" role="menuitem" onclick={onpin}>{pinLabel(pinned)}</button>
  <button type="button" id="conv-rename" class="menu-item" role="menuitem" onclick={onrename}>Renommer</button>
  <button type="button" id="conv-delete" class="menu-item danger" role="menuitem" onclick={ondelete}>Supprimer</button>
</div>
