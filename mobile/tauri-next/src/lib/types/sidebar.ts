/** Projet ouvert dans la barre latérale (`null` = page principale). */
export interface SidebarProject {
  name: string;
  /** Projet partagé avec moi : ses paramètres ne sont pas modifiables. */
  sharedWithMe: boolean;
}
