// Icônes de l'historique et des messages, reprises de `ICON_PATHS` / `icon()` (mobile/www/js/conversations.js).
// Le tracé « pin » est copié tel quel de l'ancienne interface (design identique), y compris sa syntaxe de chemin.

export const ICON_PATHS = {
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  like: '<path d="M7 10v11H4V10z"/><path d="M7 10l4-7a2 2 0 0 1 3 2l-1 4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7"/>',
  dislike: '<path d="M17 14V3h3v11z"/><path d="M17 14l-4 7a2 2 0 0 1-3-2l1-4H5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 6.4 3H17"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 63 3v2H7v-2l3-3z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, size = 16): string {
  return (
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICON_PATHS[name] || "") + "</svg>"
  );
}

/** Bouton « ⋯ » des lignes de l'historique. */
export const MORE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
