// Menu contextuel d'une discussion (« ⋯ »), repris de `openConversationMenu()` (mobile/www/js/conversations.js).

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface MenuPosition {
  left: number;
  top: number;
}

/** Marge minimale entre le menu et le bord de la fenêtre, en pixels. */
const EDGE = 8;
/** Espace entre le bouton « ⋯ » et le menu. */
const GAP = 4;

/** Même calcul que l'ancienne interface : sous le bouton, ou au-dessus s'il déborderait en bas. */
export function menuPosition(anchor: AnchorRect, menu: Size, viewport: Size): MenuPosition {
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - menu.width - EDGE));
  const below = anchor.bottom + GAP;
  const top = below + menu.height > viewport.height - EDGE ? Math.max(EDGE, anchor.top - menu.height - GAP) : below;
  return { left, top };
}

export const PIN_LABEL = "Épingler";
export const UNPIN_LABEL = "Désépingler";

export function pinLabel(pinned: boolean): string {
  return pinned ? UNPIN_LABEL : PIN_LABEL;
}
