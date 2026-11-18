# Audit de migration Capacitor → Tauri 2 (iOS)

Branche : `migration/tauri-mobile`. Document tenu à jour au fil des phases.
Dernière mise à jour : 2026-11-18.

## Légende de l'état

- **Testé (simulé)** : couvert par un test automatique exécuté dans cet environnement (Node `vm`/DOM factice, ou `cargo test`). Cela ne prouve **pas** le comportement sur iPhone.
- **Présent, non testé** : le code existe mais aucun test ne le couvre.
- **Non audité** : pas encore lu en détail.
- **Absent** : aucune implémentation trouvée.

Rien dans ce document n'a été exécuté sur un iPhone, un simulateur iOS, macOS ou Xcode : ces outils ne sont pas disponibles dans l'environnement d'audit.

## Architecture constatée

| Élément | Rôle | Remarque |
| --- | --- | --- |
| `mobile/www` | Interface historique JavaScript (Capacitor, production `org.francestudent.chat`) | Jamais modifiée par la migration |
| `mobile/tauri-next` | Application Tauri 2 + Svelte 5 (préversion `org.francestudent.mobile.next`, iOS ≥ 16.4) | Svelte 5 quasi vide : l'interface affichée est la copie de l'interface historique |
| `mobile/tauri-next/prepare-legacy.cjs` | Copie `mobile/www` vers `public/legacy` et injecte les scripts `tauri-*.js` | Injection par remplacement de chaînes : échoue explicitement si un point d'ancrage disparaît |
| `mobile/tauri-next/src-tauri` | Hôte Rust : commandes, session, import, plugins | Plugins `secure-keystore`, `fs`, `dialog` ; `stt` et `file-preview` (vendor) compilés **uniquement sur iOS** |
| `mobile/tauri-api` | Client Rust de l'API France Student | Files V2 : types MIME, liste, envoi en flux ; pas de lecture d'usage, de contenu ni de suppression côté Rust |
| `docs/api-audit` | OpenAPI et inventaire | `schemas.cjs` : lecture ciblée des schémas |

## Matrice de fonctionnalités

| Fonctionnalité | Capacitor (prod) | Tauri (préversion) | État | Action |
| --- | --- | --- | --- | --- |
| Connexion | `login.js` | `legacy-login.js` + commandes `legacy_login`, `legacy_exchange` | Testé (simulé) | Vérifier sur appareil |
| Session sécurisée | stockage local | `session_read/write/delete` + `secure-keystore` ; la session est retirée des instantanés `store` | Testé (simulé) | Vérifier sur appareil |
| Transport API | `fetch` direct | `legacy_request` / `legacy_cancel` (annulation) via Rust | Testé (simulé) | Aucune pour l'instant |
| Streaming des réponses | `stream.js` | `generate` / `cancel_generation`, `tauri-api/src/sse.rs` | Rust : 12 tests `tauri-api` ; JS : pont testé | Test sur appareil, reprise au premier plan (`resume-on-foreground.js` présent) |
| Historique des conversations | IndexedDB | IndexedDB conservé ; fusion des pièces jointes serveur/locales | Testé (simulé) | Aucune |
| Pièces jointes Files V2 | `/files/upload` pour les images, `/filesv2` pour le reste | Envoi par blocs (`upload_begin/chunk/finish/cancel`), 2 envois concurrents, aperçu borné à 6 Mo | Testé (simulé) | Voir « Fichiers » ci-dessous |
| Stockage — panneau bibliothèque | absent | `legacy-storage.js` (quota, liste paginée, suppression confirmée) | Testé (simulé) | À fusionner dans la couche de données commune (phase 8) |
| Stockage — onglet Paramètres | absent | `storage-settings.js` (nouveau) | Testé (simulé) | Test visuel sur appareil |
| Conversations archivées | absent | `archived-chats.js` (liste, restauration, téléchargement) | Testé (simulé) | Aucune |
| Conversations verrouillées | présent | `locked-chats*.js` | Testé (simulé) | Aucune |
| Recherche serveur | locale | `remote-chat-search.js` | Testé (simulé) | Aucune |
| Partage de projet | présent | `project-shares.js` | Testé (simulé) | Aucune |
| Messages enregistrés | présent | contrats PUT/GET/DELETE | Testé (simulé) | Aucune |
| Import ChatGPT | présent | `conversation-import.js` | Testé (simulé) | Aucune |
| Dictée vocale | `@capacitor-community/speech-recognition` | `tauri-plugin-stt` (vendor, iOS) + `legacy-speech.js` | Pont testé (simulé) ; plugin natif non compilé ici | Compilation et test sur iOS |
| Enregistrement / partage de fichier | plugins Capacitor | `save-file.js` + `dialog` / `fs`, `file-preview` (iOS) | Testé (simulé) pour les blocs et l'annulation | Test sur appareil |
| Clavier | `@capacitor/keyboard` | Aucun équivalent audité ; `ios-compat.js` gère le viewport | Non audité | Auditer le comportement du clavier sous WKWebView |
| Import des données de l'ancienne application (.fsbackup) | export Capacitor | Import Tauri branché ; **export Capacitor non branché dans l'application publiée** | Testé (simulé) ; build de transition jamais compilée | Compiler et tester la build de transition |
| Android | `build-android.yml` | Aucune cible Tauri Android | Hors périmètre iOS | À confirmer avec l'équipe |

## Fichiers : ce que l'API permet (et ne permet pas)

Source : `docs/api-audit/openapi.json`, lu via `node docs/api-audit/schemas.cjs`.

- `GET /filesv2/usage` renvoie `usedBytes`, `maxBytes`, `remainingBytes`, `filesBytes`, `skillsBytes` (et leurs équivalents en Go).
- `GET /filesv2` est paginé (`limit`, `after`, `has_more`, `last_id`) ; `DELETE /filesv2/{id}` renvoie `deleted`.
- `GET /filesv2/{id}/content` renvoie du contenu base64 ; `GET /filesv2/supported-mime-types` liste les types acceptés.
- Les images historiques passent par `GET /files` (liste d'identifiants) et `GET /files/{id}` ; **aucune taille n'est fournie** pour elles.
- `GET /chats/archived` renvoie des résumés et `hasMore` : **pas de taille ni de total**.
- Aucun endpoint de fichiers par projet : le classement de la bibliothèque par projet reste **local**.
- `POST /filesv2/legacy-migration` ne doit jamais être lancé automatiquement.
- Les messages exposent `usedFileIds` (historique) et `usedFilesV2Ids`. **Non établi** : où se trouvent les fichiers générés par l'IA (à investiguer avant la phase 6).

## Vérifications exécutées

| Commande | Résultat |
| --- | --- |
| `npm test` (`mobile/tauri-next`) | Toutes les vérifications passent (code de sortie 0) |
| `npm run check` | 0 erreur, 0 avertissement |
| `npm run build` | Réussi |
| `cargo check --locked` (`src-tauri`) | Réussi (cible Windows : plugins iOS non compilés) |
| `cargo test --lib --locked` (`src-tauri`) | 5 tests passés |
| `cargo test --locked` (`mobile/tauri-api`) | 12 tests passés |

## Limites connues de cet audit

1. Aucune compilation iOS ni test sur appareil.
2. Aucun compte de test : les réponses réelles de l'API n'ont pas été observées, seul le contrat OpenAPI est utilisé.
3. Les tests JavaScript utilisent un DOM factice : ils valident la logique, pas le rendu ni l'ergonomie tactile.
4. Les workflows GitHub n'ont pas été exécutés depuis cet environnement.

## Prochaines étapes

1. Phase 6 : établir comment les fichiers générés par l'IA sont exposés (messages, flux) avant de concevoir la bibliothèque unifiée.
2. Phase 5 : miniatures d'images bornées (chargement différé, cache limité, annulation).
3. Phase 8 : couche de données commune partagée par le panneau bibliothèque, l'onglet Stockage et la future bibliothèque.
4. `tauri-api` : ajouter usage, contenu et suppression Files V2 avec tests Rust.
