# Cartographie : Paramètres, Bibliothèque, Projets (legacy `mobile/www`)

Cartographie des écrans historiques, relevée le 20/11/2026. L’état actuel des écrans Svelte figure aux sections 7 et 8.

## 1. Paramètres (`#settings-modal`, quatre onglets)

| Onglet | Contenu relevé dans `index.html` | Code legacy | Endpoints relevés |
|---|---|---|---|
| Compte (`#panel-account`) | profil (nom, e-mail, avatar changer/retirer), « Budget du jour » (quota), activité, déconnexion | `settings.js` (avatar), `models.js` (quota), `account-activity.js` | `GET /user/usage`, `GET /user/tokenusage?tokenUsageDays=343` |
| Général (`#panel-general`) | affichage de la bibliothèque (colonnes), notification de fin de réponse, modèle par défaut, outil image + modèle d'image, recherche web (dialogue de domaines), personnalisation (raisonnement GPT, instructions personnalisées) | `general-settings.js`, `library.js` (colonnes, notifications), `models.js` | `GET/PATCH /user/instructions`, `GET/PUT /user/web-search-domains` |
| Skills (`#panel-skills`) | import, actualisation, recherche, liste avec activation et suppression | `settings.js` (l. 660-730) | `GET /skills?…`, `POST /skills`, `POST /skills/{id}` (activation), suppression |
| MCP (`#panel-mcp`) | liste des serveurs, assistant d'ajout (URL, identifiants, OAuth), découverte, activation, suppression | `settings.js` (l. 260-510) | `GET/POST /mcp/servers`, `POST /mcp/servers/{id}`, `/discover`, `DELETE`, `/oauth/start`, `/oauth/complete` |

Le script injecté `interface-settings.js` ajoute la section « Interface » dans `#panel-general`.

### Écrans demandés qui n'existent pas dans le legacy
- **Clé API** : aucune occurrence (recherche « Clé API », « API key », « apikey » dans `mobile/www`). Aucun écran ni endpoint à reprendre.
- **Stockage** : pas d'écran. Seuls existent le « Budget du jour » (quota d'usage, onglet Compte) et des messages d'erreur de stockage local (`core.js`, `settings.js`). À confirmer avec le propriétaire du produit : nouvelle fonctionnalité, ou autre nom pour le quota ?

## 2. Bibliothèque (`library.js`, 17,9 ko)
- Pas de balisage dans `index.html` : le dialogue `#file-library` est créé dynamiquement par `openLibrary()`.
- Les enregistrements sont locaux : base IndexedDB avec les magasins `library` et `files` (lecture/écriture dans `library.js`), alimentés par `indexConversationFiles()` à partir des conversations. Ce n'est **pas** la base `francestudent-conversations` que le Svelte utilise déjà. Le nom de cette autre base n'a pas été relevé (non vérifié).
- Dépendances : vignettes (`libraryThumbnail`), ouverture de la discussion d'origine (`openLibraryChat`), liste des projets via `GET /projects`, nombre de colonnes dans `store.libraryColumns` (défaut 3).

## 3. Projets (`projects.js`, 16,4 ko)
- `#projects-window` (liste, tri, recherche, état, réessayer) et `#project-editor` (nom, instructions, suppression), puis `#project-context` dans la barre latérale (« Paramètres du projet », « Retour à la page principale »).
- Endpoints relevés : `GET /projects`, `GET /projects/shared`, `POST /projects`, `PATCH /projects/{id}`. Suppression, contexte et partages : non vérifié.
- Le lien avec le chat (projet courant, instructions) passe par l'état du moteur legacy : non vérifié.

## 4. Point de conception tranché : réglages locaux
Les réglages locaux (colonnes de la bibliothèque, thème, modèle par défaut, outil et modèle d'image, notifications) vivent dans l'état `fs-chat-state` (`localStorage`), que le moteur legacy lit et réécrit en entier. Décision : pendant la transition, Svelte passe par le moteur historique via un pont (`window.__fsSettings`, exposé par `svelte-settings-engine.js` et injecté par `prepare-legacy.cjs`), comme pour le chat. L'architecture isole cette dépendance dans `src/lib/services/local-settings.ts` : pour supprimer le moteur historique, il suffira de remplacer l'implémentation du pont par une écriture directe (déjà prévue et testée dans ce module), sans toucher au store ni au composant.

## 5. État d'avancement
Paramètres > Général est migré : `SettingsDialog.svelte` (rendu), `settings.svelte.ts` (état), `general-settings.ts` (préférences du compte `/user/instructions`, filtres web `/user/web-search-domains`), `local-settings.ts` (réglages locaux), `interface-choice.ts` (choix de l'interface), `api-client.ts` / `api-runtime.ts` (client HTTP typé au-dessus du transport Rust existant).

Comportements à connaître :
- Le moteur historique synchronise l'outil image et le modèle d'image avec le serveur à l'envoi d'un message (`syncImageTool`), pas depuis l'écran Réglages. Il ajoute aussi, au premier envoi, un bloc `[FranceStudent-fichiers]` aux instructions personnalisées du compte (`syncFileInstructions`) : le dialogue Svelte l'affiche comme l'ancien écran, à part du texte éditable. Le bloc est conservé lors de l’enregistrement.
- Le modèle de texte par défaut reste local ; limite des instructions : 10 000 caractères côté Svelte (OpenAPI), contre 2 000 000 dans le code historique.
- Le dialogue Svelte s’ouvre sur Général. La voie classique reste accessible via le choix d’interface ou si le pont de réglages n’est pas disponible.
- Pas de commande Tauri dédiée aux Paramètres ni aux fichiers : le proxy générique `legacy_request` suffit.

Où se trouve la logique : le transport HTTP, l'échange de session, le Keychain, les téléversements par blocs et la validation des routes contre l'OpenAPI sont en Rust ; la logique des écrans (validation, analyse des réponses, stores de fichiers, rendu) est en TypeScript/JS.

## 6. Ordre de travail retenu
1. Cartographie (ce document) — fait.
2. Paramètres > Général — fait.
3. Paramètres > Compte (+ quota `/user/usage`).
4. Paramètres > Skills, puis MCP.
5. Paramètres > Clé API (`/user/@me/api-key`).
6. Stockage FRST : fichiers France Student via Files V2 (`/filesv2`, `/filesv2/usage`), distinct du budget quotidien.
7. Bibliothèque : fichiers FRST et fichiers générés par l'IA, avec miniatures ; IndexedDB ne doit pas rester l'unique source.
8. Projets.
Objectif final : supprimer l'iframe et le moteur JS historique.


## 7. Compte Svelte : reprise du 20/11/2026
Le panneau Compte est raccordé au shell : profil serveur et cache local, photo stockée sur l'appareil, quota du jour, activité, sessions avec confirmation et déconnexion via le pont historique. Les réponses tardives des lectures sont ignorées à la fermeture. La photo n'est pas envoyée au serveur. Les réglages et le compte utilisent encore le pont historique pour les écritures locales et la déconnexion.

La suite navigateur utilise un serveur et un trousseau simulés : elle couvre le profil, le quota, l'activité, la photo, la révocation et la déconnexion, mais ne vérifie pas les contrats du service réel. À valider sur iPhone et Android : sélection et persistance de photo, partage/export, zones sûres et défilement, suppression de session et accès au trousseau, fonctionnement en arrière-plan et réseau réel.


## 8. Écrans Svelte raccordés

| Écran | Comportement | Dépendance de transition |
|---|---|---|
| Skills et commandes `/` | Liste paginée, recherche, import par le transfert Rust, activation et suppression. Le composeur partage le catalogue et transmet le skill choisi au moteur. | Le moteur historique construit et envoie encore la requête de chat. |
| MCP | Liste, activation, suppression, découverte des outils, assistant d’ajout et fin du parcours OAuth par code ou URL de retour. | Transport Rust existant. L’ouverture du lien OAuth et le retour réel restent à contrôler sur téléphone. |
| Clé API | Consultation de la clé masquée et du budget, génération et révocation confirmées. La clé en clair est disponible temporairement dans Compte. | Transport Rust existant. La clé en clair est effacée à la fermeture, au changement d’onglet et en arrière-plan. |
| Stockage FRST | Quota, catégories, liste paginée, filtres, tri et suppression confirmée. | Le pont de l’iframe réutilise le cache Files V2 déjà testé. |
| Bibliothèque | Fichiers Files V2 et fichiers des discussions dans la même liste, filtres, miniatures texte et image selon le type, sauvegarde, aperçu, chat d’origine et classement local. | Index des fichiers générés, aperçus et reprise des réponses conservés dans le moteur historique. Les autres formats gardent une icône dans la grille. |
| Projets | Liste des projets propres et partagés, création, édition, suppression, partage, ouverture et déplacement des discussions synchronisées. | Le pont applique la sélection et les changements de contexte au moteur de chat existant. |

La migration de ces écrans permet de les utiliser depuis la coque Svelte. Le retrait complet de l’iframe demande encore de remplacer les dépendances de transition et de valider les parcours sur iPhone et Android.


## 9. Remplacement des ponts en mode Svelte

Les réglages et le profil écrivent directement dans `fs-chat-state`. SessionFlow gère la déconnexion et l’effacement du secret dans le stockage natif. L’historique réutilise IndexedDB avec un rattachement au compte. Les conversations anciennes dont le propriétaire ne peut pas être établi sont conservées et restent masquées. Le cache Files V2, le stockage des aperçus, l’index de la bibliothèque et le contexte de projet partagent les services du mode Svelte. Les requêtes et transferts passent par le transport Rust.

Les composants n’utilisent plus les ponts de l’iframe en mode Svelte. Les dépendances de transition décrites dans la section 8 ne concernent que l’étape hybride précédente. L’ancien écran reste accessible par le choix explicite « Interface classique ». Aucun test ni build n’a été exécuté pour ce remplacement, à la demande du contributeur.
