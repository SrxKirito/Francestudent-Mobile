# Audit de migration Capacitor → Tauri 2 (iOS)

Branche : `migration/tauri-mobile` (ne jamais toucher `main`). Document tenu à jour au fil des phases.
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
| `mobile/tauri-next` | Application Tauri 2 + Svelte 5 (préversion `org.francestudent.mobile.next`, iOS ≥ 16.4) | `App.svelte` ne contient qu'une iframe vers `/legacy/index.html` : **pas de Svelte 5 réel**, l'interface affichée est la copie de l'interface historique |
| `mobile/tauri-next/prepare-legacy.cjs` | Copie `mobile/www` vers `public/legacy` et injecte les scripts `tauri-*.js` | Injection par remplacement de chaînes : échoue explicitement si un point d'ancrage disparaît |
| `mobile/tauri-next/src-tauri` | Hôte Rust : commandes, session, import, plugins | Plugins `secure-keystore`, `fs`, `dialog` ; `stt` et `file-preview` (vendor) compilés **uniquement sur iOS** |
| `mobile/tauri-api` | Client Rust de l'API France Student | Files V2 : types MIME, liste, **usage, métadonnées, contenu borné, suppression** (ajoutés au commit `88562a2`, 20 tests) et envoi en flux |
| `docs/api-audit` | OpenAPI et inventaire | `schemas.cjs` : lecture ciblée des schémas |

## Matrice de fonctionnalités

| Fonctionnalité | Capacitor (prod) | Tauri (préversion) | État | Action |
| --- | --- | --- | --- | --- |
| Connexion | `login.js` | `legacy-login.js` + commandes `legacy_login`, `legacy_exchange` | Testé (simulé) | Vérifier sur appareil |
| Session sécurisée | stockage local | `session_read/write/delete` + `secure-keystore` ; la session est retirée des instantanés `store` | Testé (simulé) | Vérifier sur appareil |
| Transport API | `fetch` direct | `legacy_request` / `legacy_cancel` via Rust. `apiFetch` du pont n'accepte pas de `signal` : l'annulation côté JS ferme la lecture du flux mais ne coupe pas la requête native | Testé (simulé) | Test réseau réel |
| Streaming des réponses | `stream.js` | `generate` / `cancel_generation`, `tauri-api/src/sse.rs` | Rust : tests `tauri-api` ; JS : pont testé | Test sur appareil, reprise au premier plan (`resume-on-foreground.js` présent) |
| Historique des conversations | IndexedDB | IndexedDB conservé ; fusion des pièces jointes serveur/locales | Testé (simulé) | Aucune |
| Pièces jointes Files V2 | `/files/upload` pour les images, `/filesv2` pour le reste | Envoi par blocs (`upload_begin/chunk/finish/cancel`), 2 envois concurrents, aperçu borné à 6 Mo | Testé (simulé) | Voir « Écarts constatés » (limite 50 Mo) |
| Données Files V2 (liste, quota, suppression) | absent | `files-store.js` : cache par id, requêtes partagées, réponses périmées ignorées, garde de session, tri/filtre purs `arrange` | Testé (simulé) | Aucune |
| Stockage — panneau bibliothèque | absent | `legacy-storage.js` : branché sur `files-store.js` (**fusion faite**, une seule liste et un seul quota partagés avec l'onglet Stockage) ; recherche, filtre par type, tri ; vignettes | Testé (simulé) | Test visuel sur appareil |
| Stockage — onglet Paramètres | absent | `storage-settings.js` (même couche de données) | Testé (simulé) | Test visuel sur appareil |
| Vignettes des fichiers serveur Files V2 | absentes | `file-thumbnails.js` + `tauriThumbnailBlob` : images ≤ 2 Mo, texte tronqué à 16 Ko, chargées seulement à la visibilité (`IntersectionObserver`, marge 160 px), 2 requêtes simultanées, URL d'objet à baux révoquées à la fermeture ; PDF/Office/SVG/HEIC = icône **sans requête** | Testé (simulé) | Rendu réel dans WKWebView non vérifié |
| Bibliothèque locale unifiée (`library.js`) | présente | Reprise telle quelle (voir « Correction sur les miniatures ») | Non modifiée ; non testée par un test dédié | Voir remarques ci-dessous |
| Conversations archivées | absent | `archived-chats.js` (liste, restauration, téléchargement) | Testé (simulé) | Aucune |
| Conversations verrouillées | présent | `locked-chats*.js` | Testé (simulé) | Aucune |
| Recherche serveur | locale | `remote-chat-search.js` | Testé (simulé) | Aucune |
| Partage de projet | présent | `project-shares.js` | Testé (simulé) | Aucune |
| Messages enregistrés | présent | contrats PUT/GET/DELETE | Testé (simulé) | Aucune |
| Import ChatGPT | présent | `conversation-import.js` | Testé (simulé) | Aucune |
| Dictée vocale | `@capacitor-community/speech-recognition` | `tauri-plugin-stt` (vendor, iOS) + `legacy-speech.js` | Pont testé (simulé) ; plugin natif non compilé ici | Compilation et test sur iOS |
| Enregistrement / partage de fichier | plugins Capacitor | `save-file.js` + `dialog` / `fs`, `file-preview` (iOS) | Testé (simulé) pour les blocs et l'annulation | Test sur appareil |
| Clavier / safe areas | `@capacitor/keyboard` + `ios-compat.js` | Voir « Clavier iOS » | Audité à la lecture du code, **non testé** | Test sur iPhone |
| Import des données de l'ancienne application (.fsbackup) | export Capacitor | Import Tauri branché ; **export Capacitor non branché dans l'application publiée** | Testé (simulé) ; build de transition jamais compilée | Compiler et tester la build de transition |
| Android | `build-android.yml` | Aucune cible Tauri Android | Hors périmètre iOS | À confirmer avec l'équipe |

## Correction sur les miniatures et la bibliothèque

Une affirmation initiale de l'audit disait que les miniatures étaient absentes. **C'était inexact.** Lecture de `mobile/www/js/library.js` :

- Il s'agit déjà d'une **bibliothèque unifiée locale** (IndexedDB `library`).
- Elle indexe les **fichiers envoyés** (`direction: 'sent'`), les **fichiers générés par blocs de code** (`direction: 'generated'`, avec `code` et `lang`) et les **images générées par l'IA** (`message.images`, `kind: 'image'`).
- Filtres : recherche, projet, type, origine. Tri : date décroissante uniquement. Colonnes : 1 à 4.
- **Les miniatures locales existaient** : image, PDF (page 1 via pdf.js), texte/code, première diapo d'un `.pptx`. Réserve : un PDF est chargé entier en mémoire, sans borne de taille.
- **Seuls les fichiers serveur Files V2 n'avaient pas de miniature.** C'est ce qui a été ajouté (`file-thumbnails.js`).
- Le dialogue `#file-library` est recréé à chaque ouverture et retiré du DOM à la fermeture : tout ce qui s'y accroche doit se libérer à `close` (c'est le cas pour les vignettes et l'abonnement au cache).

## Fichiers : ce que l'API permet (et ne permet pas)

Source : `docs/api-audit/openapi.json`, lu via `node docs/api-audit/schemas.cjs` (le fichier tient sur une seule ligne).

- `GET /filesv2/usage` renvoie `usedBytes`, `maxBytes`, `remainingBytes`, `filesBytes`, `skillsBytes` (et leurs équivalents en Go).
- `GET /filesv2` est paginé (`limit`, `after`, `has_more`, `last_id`) ; `DELETE /filesv2/{id}` renvoie `deleted`.
- `GET /filesv2/{id}/content` renvoie du contenu base64 ; `GET /filesv2/supported-mime-types` liste les types acceptés.
- `FileObject.created_at` et `bytes` sont typés par `oneOf` (JsonValue/KnownValue), donc **non typés précisément**. L'application traite `created_at` comme un nombre (secondes ou millisecondes) ; une valeur absente est triée en dernier et jamais estimée.
- Les images historiques passent par `GET /files` (liste d'identifiants) et `GET /files/{id}` ; **aucune taille n'est fournie** pour elles.
- `GET /chats/archived` renvoie des résumés et `hasMore` : **pas de taille ni de total**.
- Aucun endpoint de fichiers par projet : le classement de la bibliothèque par projet reste **local**.
- `POST /filesv2/legacy-migration` ne doit jamais être lancé automatiquement.
- Le contrat ne précise **aucune taille maximale de fichier** ni reprise d'upload.

### Fichiers générés par l'IA (phase 6) — état établi

**Établi par l'OpenAPI :**
- Les **images générées** sont exposées par `GET /chats/{chatId}/messages/{messageId}/images/{imageId}` et dans le flux SSE par `ChatStreamImageGenerationCallItem`.
- Les messages exposent `usedFileIds` (historique) et `usedFilesV2Ids`.
- Il n'existe **pas de modèle « fichier généré » côté serveur** en dehors des images.

**Conséquence :** les fichiers générés (PDF, docx, code…) sont produits **côté client** (`render.js`, `fileconvert.js`, `tauri-save.js`). Ils ne doivent **pas** être téléversés dans Files V2 : cela consommerait le quota de l'utilisateur sans demande de sa part.

**Non vérifiable sans compte de test :** la forme exacte de `ChatMessageDto.parts` (type `JsonNode`, non typé) et des identifiants d'images dans les réponses réelles.

## Écarts constatés (audits complémentaires)

### `fileconvert.js`
- Encore utilisé : `mobile/www/js/composer.js` (`addConvertedFile` : `extractText`, `describe`) et `mobile/www/js/library.js` (`embeddedThumbnail`, `extractText`), chargé par `index.html`.
- Le patch Tauri `addFiles` (`legacy-files.js`) envoie les fichiers directement vers Files V2 et ne passe pas par `addConvertedFile`. Mais la bibliothèque locale s'en sert toujours.
- **Décision : on ne le retire pas.** Un retrait exigerait de prouver que plus aucun chemin ne l'appelle, y compris côté Capacitor (production).

### Limite de 50 Mo
- L'original (`composer.js`) définit `MAX_FILE_BYTES = 50 * 1024 * 1024` et refuse les fichiers plus gros avec un message.
- Le `addFiles` du patch Tauri (`legacy-files.js`, ligne ~284) **ne reprend pas cette limite**.
- Côté Rust, `upload_begin` contrôle le nom (≤ 1024 octets), le type MIME accepté par le serveur, et refuse tout dépassement de la taille annoncée (blocs ≤ 256 Kio). **Il n'impose aucune taille maximale.**
- L'OpenAPI n'en précise pas non plus.
- **Mise à jour 2026-11-19 : écart résolu.** `legacy-files.js` (l. 284-292) applique désormais la même limite de 50 Mo et refuse le fichier avec un message avant tout envoi. `test-legacy-files.cjs` vérifie le refus à 50 Mo + 1 octet et l'acceptation à 50 Mo exactement. Le contrat OpenAPI ne précise toujours aucune limite serveur : la limite reste une règle du client.

### Clavier iOS et safe areas
- `mobile/www/js/ios-compat.js` dépend de `window.Capacitor` (détection de plateforme native, événements `keyboardWillShow/DidShow/WillHide/DidHide`, `Keyboard.setAccessoryBarVisible`).
- Sous Tauri, ces événements ne sont pas émis : `keyboardHeight` reste à 0. Reste le repli sur `visualViewport` (`resize`, `scroll`), `focusin` et `resize`, qui s'active si l'agent utilisateur est celui d'un iPhone.
- Le CSS s'appuie sur `--ios-viewport-height`, `env(safe-area-inset-*)` et `100dvh` ; la page historique déclare `viewport-fit=cover` et `interactive-widget=resizes-content`. L'enveloppe Tauri (`index.html`) déclare seulement `viewport-fit=cover`.
- **Non vérifiable ici** : le comportement de `visualViewport` et de `env(safe-area-inset-*)` à l'intérieur d'une **iframe** dans WKWebView. **À tester sur iPhone.**

### Workflow `tauri-iphone-preview.yml` (relu, non exécuté)
- Déclenché par `workflow_dispatch` et par les pushes sur `migration/tauri-mobile` touchant les chemins listés. Permissions `contents: read`.
- macOS 15, Xcode 16.4, Node 22, Rust stable avec la cible `aarch64-apple-ios`.
- Exécute `npm test`, `npm run check`, `npm run build`, `cargo test --locked` (`tauri-api`) et les tests Python du vérificateur d'IPA, puis construit une **IPA non signée**, la vérifie (`verify-ios-ipa.py`, architecture arm64) et la conserve 7 jours. **Aucune publication, aucune signature.**
- Observation : il ne lance pas `cargo test --lib` de `src-tauri` (5 tests). À ajouter si on veut les couvrir en CI.
- Les tests Python `test_verify_ios_ipa.py` n'ont **pas** été exécutés dans cette session.
- Les workflows `tauri-iphone-prerelease.yml` et `tauri-iphone-publish.yml` n'ont **pas** été relus ici : non audités.

## Vérifications exécutées

| Commande | Résultat |
| --- | --- |
| `npm test` (`mobile/tauri-next`) | Toutes les vérifications passent (code de sortie 0) |
| `npm run check` | 0 erreur, 0 avertissement (2026-11-19 : 1 erreur trouvée, `shell.svelte.ts` l. 59, `conversations` lu avant son initialisation par un `$derived` ; corrigée en initialisant le champ directement, puis revérifié : 0 erreur) |
| `npm run build` | Réussi |
| `cargo check --locked` (`src-tauri`) | Réussi (cible Windows : plugins iOS non compilés) |
| `cargo test --lib --locked` (`src-tauri`) | 5 tests passés |
| `cargo test --locked` (`mobile/tauri-api`) | **20 tests passés** |
| Tests Python du vérificateur d'IPA | Non exécutés |

Correctif découvert en route : un **BOM UTF-8** en tête de `package.json` faisait échouer `npm run check` et `npm run build` alors que les tests Node passaient. Il a été retiré, et `test-config-hygiene.cjs` (dans `npm test`) échoue désormais si un JSON de configuration en contient un.
Un bug réel a aussi été trouvé par un test : le tri décroissant plaçait les valeurs absentes en premier (`cmpNum`, commit `2658123`).

## Limites connues de cet audit

1. Aucune compilation iOS ni test sur appareil.
2. Aucun compte de test : les réponses réelles de l'API n'ont pas été observées, seul le contrat OpenAPI est utilisé.
3. Les tests JavaScript utilisent un DOM factice : ils valident la logique, pas le rendu ni l'ergonomie tactile (tailles de cibles ≥ 44 px, zoom iOS sur les champs à 16 px, apparence des vignettes).
4. Les workflows GitHub n'ont pas été exécutés depuis cet environnement.

## Rapport final (phase 17)

**Livré sur `migration/tauri-mobile` (rien publié, rien poussé sur `main`) :**
- `88562a2` : `tauri-api` — usage, métadonnées, contenu borné, suppression Files V2 (20 tests Rust).
- `e5844c0` : couche de données commune `files-store.js`, partagée par la bibliothèque et l'onglet Stockage.
- `2658123` : classification par type, tri et filtre purs, avec correction du tri des valeurs absentes.
- `6d83f83` : vignettes bornées Files V2, recherche/filtre/tri dans la bibliothèque, retrait du BOM, test de garde.

**Testé (tests unitaires simulés et `cargo test`) :** logique des données de fichiers, pagination, suppression confirmée, garde de session, tri/filtre, bornes et baux des vignettes, annulation, libération à la fermeture, contrats Rust de Files V2.

**Non vérifiable dans cet environnement :** iPhone réel, simulateur, compilation iOS/Xcode, clavier et safe areas sous WKWebView, rendu réel des vignettes, réponses réelles de l'API avec un compte, exécution des workflows GitHub.

**Non fait / à décider :**
- Svelte 5 réel : `App.svelte` reste une iframe vers l'interface historique.
- Limite de 50 Mo à reprendre dans le patch Tauri ou à confirmer côté serveur.
- Export `.fsbackup` côté Capacitor non branché dans l'application publiée ; build de transition jamais compilée.
- Android hors périmètre.
- Retrait de `fileconvert.js` : refusé faute de preuve d'absence d'usage.

## Prochaines étapes

1. ~~Limite de 50 Mo~~ : faite et testée (voir « Écarts constatés »).
2. Ajouter `cargo test --lib` de `src-tauri` au workflow de préversion ; exécuter les tests Python du vérificateur d'IPA.
3. Lancer la préversion iOS via le workflow, puis tester sur iPhone : clavier, safe areas, vignettes, import `.fsbackup`.
4. Relire `tauri-iphone-prerelease.yml` et `tauri-iphone-publish.yml` avant toute publication.
5. Décider du sort de l'iframe : migration réelle vers Svelte 5 ou statu quo documenté.