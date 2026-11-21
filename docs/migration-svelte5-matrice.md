# Matrice de migration — interface historique → Svelte 5 + TypeScript

Branche : `migration/tauri-mobile` (ne pas toucher `main`). Créé le 2026-11-18.

## État de la branche au 21 novembre 2026

La coque monte `AppLayout.svelte` après ouverture de la session. Le chat et l’historique Svelte sont actifs par défaut. `?ui=legacy` conserve l’interface historique complète. `?ui=svelte&chat=legacy` charge le transport Tauri avant l’iframe, puis attache le pont après le chargement de sa fenêtre. Chaque mode utilise un seul moteur pour écrire l’historique.

| Phase | État vérifié et écarts |
| --- | --- |
| 1 — Coque et pont | Injection et ordre des scripts, attachement/détachement, identifiants numériques et textuels, synchronisation, filtre projet, recherche et rendu serveur exercés. Le test VM supprime volontairement `projectId` dans une copie du pont et vérifie que l’assertion échoue. |
| 2–3 — Historique | Ouverture, recherche locale et distante, archives, import ChatGPT, renommage, suppression et épinglage existent dans les services Svelte. Les conversations verrouillées et le PIN sont exclus de l’interface Svelte à la demande du propriétaire. Les messages enregistrés sont ajoutés, listés et retirés via l’API depuis le chat et la bibliothèque. Les conversations actives peuvent être exportées en JSON texte. Les archives gardent le téléchargement fourni par le serveur. |
| 4 — Chat | Transport SSE, reprise, arrêt, pièces jointes, Markdown, KaTeX, code, citations et dictée sont présents. Le terminal SSE sans identifiant reste pris en compte à la reprise. La cartographie de `render.js`, `stream.js` et `composer.js` est dans [migration-chat-cartographie.md](migration-chat-cartographie.md). |
| 5–6 — Rendus et recherche d’images | Le registre Svelte versionné rend quiz, cartes mémoire, graphiques (courbes, barres, secteurs et dispersion), listes à cocher et accordéons. Les autres composants et la galerie de recherche d’images restent à faire. OpenAPI v0 expose la recherche web et les images générées dans le flux, mais aucun endpoint ni événement de galerie d’images trouvées. Il faut confirmer un fournisseur autorisé et un contrat backend avant de brancher une galerie. |
| 7 — Espace de travail | Paramètres, Compte, Skills, MCP, clé API, Projets, Bibliothèque et Files V2 sont présents. L’onglet Stockage envoie et télécharge via Files V2. Le transfert affiche sa progression et peut être annulé. La limite de 50 Mo s’applique aux pièces jointes et aux envois depuis Stockage. Les parcours de bout en bout et les écarts de parité restent à vérifier sur mobile. |
| 8 — Capacités IA | Recherche web avec sources, analyse de fichiers et d’images, génération d’images, dictée, options de modèle et instructions existent dans le chat. Génération DOCX/XLSX, voix temps réel, mémoire et états d’outils restent à valider ou porter. |
| 9 — Rust | Les deux interfaces utilisent les commandes typées de session, le transfert segmenté et le transport Rust existant. Le chemin `connect` / `list_chats` / `generate` expose des commandes typées, mais `generate` n’embarque ni projet ni images et ne couvre pas la reprise du chat Svelte. Conserver un seul chemin actif par opération et ne remplacer ce transport qu’après alignement des contrats. |
| 10–12 — Mesures, validation et retrait | Mesure du build Vite disponible. Profiler RAM, CPU, réseau, batterie et démarrage sur appareil. Conserver l’iframe et `prepare-legacy.cjs` jusqu’à validation explicite. |

Le premier build après stabilisation donne **400,84 kB** pour le JavaScript `main` (135,81 kB gzip), soit **+339,04 kB** par rapport à la coque de référence (61,8 kB). Le point d’entrée inclut désormais le chat, les paramètres, les projets, la bibliothèque et les aperçus. Le CSS historique mesure **109,53 kB** (20,84 kB gzip), contre 109,5 kB. Ce sont des tailles de fichiers de build et elles ne mesurent ni le temps de démarrage, ni la RAM.

`npm test`, `npm run check`, `npm run build` et `npm run verify:browser` ont été exécutés sur Windows. Chrome CDP exerce le clavier et la souris sur le chat Svelte, la modale d’import et le pont de secours face à un backend simulé. `cargo check --locked` a compilé les cibles de vérification Windows. Les builds et parcours iOS/Android, le DOMParser et OAuth avec réponses réelles, le Keychain, IndexedDB dans les WebViews, la caméra, le microphone, le partage et la barre d’accessoires iOS restent à vérifier sur appareil.

France IDE est exclu de cette préversion Tauri. Le tracé SVG d’épinglage hérité signalé dans l’audit reste inchangé. Les changements locaux de `legacy-files.js` et les scripts de travail ne font pas partie du commit. La documentation OpenAPI est accessible à [France Student OpenAPI](https://api.francestudent.ai/v3/api-docs).

## Relevé initial du 18 novembre 2026

Légende de la colonne « État » :
- **Lu** : le fichier a été lu dans cette session, les constats sont vérifiés.
- **À auditer** : présent d'après l'arborescence ou `index.html`, **pas encore lu**. Aucun constat n'est affirmé.
- **Non commencé** : aucune ligne de Svelte écrite.

État au 2026-11-18 (commits `41da78c` puis `cba074e`, plus la couche de données des conversations) : **2 écrans sur la liste ci-dessous sont portés (démarrage, connexion)**, plus les fondations (types, état persistant, jeton, session/Keychain, transport) et la liste d'historique avec son stockage (écrits et testés, **pas encore montés**). Ils ne s'affichent qu'avec `?ui=svelte` (ou `localStorage["fs-ui"]="svelte"`) ; **par défaut, `App.svelte` affiche toujours l'iframe historique**. Une fois connecté, la nouvelle coque affiche l'iframe : la conversation, la barre latérale, les paramètres, les projets et la bibliothèque sont encore 100 % historiques.

Légende complémentaire pour « État » : **Migré** = composant Svelte écrit ; **Testé (Node/SSR)** = vérifié par un test automatisé exécuté, **jamais** sur iPhone/WebView.

Limites connues de la version hybride : la coque et l'iframe font chacune un échange de jeton au démarrage (deux requêtes au lieu d'une) ; une déconnexion faite *dans* l'iframe affiche l'écran de connexion historique, pas celui de Svelte.

**Périmètre réel plus large que `mobile/www`** : l'iframe charge aussi 7 feuilles Tauri (`legacy-files`, `remote-chat-search`, `archived-chats`, `chat-context`, `project-shares`, `storage-settings`, `skill-commands`) et ~17 scripts `tauri-*.js` (chats verrouillés, import de conversations, stockage, commandes /skill, Files V2…). Ces écrans doivent être migrés aussi, ils ne sont pas dans `index.html`.

## 1. Constats vérifiés

1. L'interface affichée est la copie de `mobile/www` placée dans `mobile/tauri-next/public/legacy` par `prepare-legacy.cjs` (copie complète, puis patches par remplacement de chaînes).
2. `prepare-legacy.cjs` retire France IDE (bouton, CSS, `ide-link.js`, `ide-link-remembered.js`, `chat-shares.js`). Ces fonctions **ne sont donc pas dans la préversion Tauri** : elles n'ont pas à être migrées sans décision de l'équipe.
3. Il injecte 17 scripts `tauri-*.js` (+ 7 feuilles CSS) et modifie par chaîne exacte `core.js`, `composer.js`, `conversations.js`, `stream.js`, `library.js`, `app.js`. Chaque ancre manquante fait échouer le script. Ces patches sont du comportement à reproduire en Svelte, pas à perdre.
4. Les scripts historiques sont des scripts classiques à portée globale, dépendants de l'ordre de chargement (`core.js` en premier, `app.js` en dernier) et d'identifiants DOM (`$("id")`). Il n'y a ni modules ni état isolé.
5. `main.ts` installe `window.__franceStudentTransport` (fonction `installLegacyTransport`) et, si `speech_supported`, `window.__franceStudentSpeech`. L'iframe consomme ce pont.
6. 20 CSS historiques sont chargés dans un ordre qui compte (`style.css` → … → `ios-compat.css`, + `katex.min.css`). La cascade est une dépendance de design à préserver telle quelle.
7. `tsconfig.json` est `strict`, mais `include` ne couvre que `src/**`. Le JS racine (`legacy-*.js`, `files-store.js`…) n'est donc pas vérifié par `npm run check`.
8. `package.json` : Svelte 5, Vite 6, svelte-check. Pas de dépendance de test de composants (Vitest, @testing-library/svelte) : les tests actuels sont des scripts Node avec DOM factice.

### Constats complémentaires (lecture de `app.js` l. 1-200, `core.js` l. 1-220, liste des fonctions de `js/*.js`)

- `app.js` : `bindEvents()` branche à la main des dizaines d'écouteurs (`$("id").addEventListener`) : bibliothèque, thèmes, menus, sélecteur de modèle, composer, pièces jointes, dictée. Il ajoute aussi des écouteurs globaux sur `document` (`click`, `keydown` Échap) et `window` (`resize`) qui ferment tous les menus via `closeMenus()`. Équivalent Svelte : une pile de couches ouvertes (`stores/ui.svelte.ts`) + `<svelte:window>`.
- Navigation clavier des listes (flèches, Début, Fin, Échap) codée à la main pour 4 menus : à conserver (accessibilité) dans un composant `Menu.svelte` réutilisable.
- `core.js` : un unique objet `store` mutable (≈ 20 champs : session, deviceId, agentId, thème, modes web/image/étude, profil, avatar, conversations…) persisté dans `localStorage` (`fs-chat-state`), les **conversations dans IndexedDB** (`francestudent-conversations`, magasin `state`, écritures sérialisées avec capture d'instantané). Ces deux formats de stockage doivent rester **compatibles** (données utilisateur existantes) → `stores/` doit relire exactement ces clés.
- `core.js` contient encore de l'authentification et du transport propres à Capacitor (`window.Capacitor`, `CapacitorHttp`, `nativeStreamingFetch`, `getAccessToken` avec en-têtes client). Sous Tauri, le pont (`legacy-bridge.js`, non lu) les remplace : à lire avant d'écrire `services/auth.ts` et `services/api.ts`.
- Fonctions par fichier (relevé, non audité en détail) : `composer.js` ≈ 45 fonctions (PDF via pdf.js, conversion d'images, dictée native/web, envoi, régénération) ; `conversations.js` ≈ 45 (actions, votes, synchronisation serveur, historique groupé par date, profil, thème) ; `assistant.js` (sources web, machine à écrire, génération d'images, **`runAssistant`** = cœur du streaming, gestes de barre latérale) ; `account-activity.js`, `general-settings.js`.
- Les listes ne sont pas virtualisées : `renderMessages()` reconstruit le DOM (à mesurer avant d'optimiser).

## 2. Écrans et composants (d'après `mobile/www/index.html`)

| Élément | Ancienne implémentation | Nouvelle implémentation | État |
|---|---|---|---|
| Écran de démarrage `#startup-screen` | HTML + `app.js` | `components/Startup.svelte` | Lu, Migré, Testé (SSR : balisage identique à `index.html`) ; rendu visuel iPhone non vérifié |
| Connexion e-mail / mot de passe, cookie de session `#login-screen` | `js/login.js` + `tauri-login.js` + `tauri-session.js` | `components/Login.svelte`, `stores/session.svelte.ts`, `services/{login,login-actions,session-flow,auth}.ts` | Lu, Migré, Testé (Node : 21 + 25 + 9 tests ; SSR : 4). **Non vérifié sur appareil** : `page-reader.ts` (DOMParser), Keychain réel, flux OAuth réel |
| Cycle de vie de session (Keychain, migration d'une session localStorage, conflit, déconnexion) | `core.js`, `login.js`, `legacy-session.js` | `services/session-flow.ts` | Lu, Migré, Testé (Node, 3 mutations vérifiées) ; la déconnexion Svelte n'est pas encore reliée à une UI |
| Barre latérale `#sidebar` (marque, repli, nouvelle discussion, recherche, Projets, Bibliothèque, historique, compte) | `index.html`, `conversations.js`, `app.js` | `components/Sidebar.svelte` (+ `types/sidebar.ts`) | Lu, Migré (**coque seule**), Testé (Node/SSR : balisage comparé à la tranche `<aside id="sidebar">` du vrai `index.html`, états repos/tiroir ouvert/projet/projet partagé/compte/historique intégré ; 3 mutations de contrôle détectées). **France IDE exclu** (retiré sous Tauri) ; le contenu de `#settings-modal` n'est pas porté (reste dans l'iframe). **Non monté** : aucun comportement relié (clics, tiroir, repli) tant que le pont vers le moteur n'existe pas. Rendu visuel non vérifié |
| Liste d'historique `#history` (groupes par date, épinglées, recherche, pastille du modèle, menu « ⋯ ») | `renderHistory()` de `conversations.js`, `models.js`, `logos.js` | `components/HistoryList.svelte`, `utils/{history,agents,icons}.ts`, `data/provider-logos.ts`, `stores/conversations.svelte.ts` | Lu, Migré, Testé (Node/SSR : 23 + 15 vérifications, balisage et ordre comparés au vrai `renderHistory` exécuté dans vm ; 4 mutations de contrôle détectées). **Non monté** dans la coque : rien n'est affiché par Svelte. Clic/clavier et menu non testés (pas de DOM). Rendu visuel non vérifié |
| Stockage des conversations (IndexedDB `francestudent-conversations`, migration depuis `localStorage`, repli, écritures sérialisées) | `core.js` | `services/conversation-storage.ts` | Lu, Migré, Testé (Node, faux IndexedDB, 15 vérifications, 4 mutations détectées ; relu par l'ancien `core.js`). **IndexedDB réel (WebView iOS) non testé**. Le store Svelte est en **lecture seule** : l'iframe reste seule à écrire |
| Contexte projet dans la barre (paramètres, retour) | `projects.js` | `components/Sidebar.svelte` (bloc `#project-context`) | Migré (balisage seulement : nom, statut, « Paramètres du projet » masqué si partagé, comparé au legacy), Testé SSR. Logique projet (`renderProjectContext`, ouverture/sortie) **non migrée** : elle reste dans l'iframe |
| Menu de conversation (épingler, renommer, supprimer) `#conv-menu` | `conversations.js` | `components/ConversationMenu.svelte`, `utils/menu.ts` | Migré (balisage, libellé Épingler/Désépingler, positionnement), Testé (Node : balisage + 126 positions comparées au VRAI `openConversationMenu` exécuté dans vm, 1 mutation détectée). Actions (`togglePin`, `renameConversation`, `deleteConversation`, sync serveur) **non migrées**. **Non monté**. Clic/clavier non testés |
| Barre du haut + sélecteur de modèle `#model-button`, `#model-menu` | `models.js` | `components/chat/ModelPicker.svelte` + `stores/models.svelte.ts` | À auditer |
| Zone de messages, état vide, bouton « aller en bas » | `conversations.js`, `render.js` | `components/chat/MessageList.svelte`, `EmptyState.svelte`, `ScrollToBottom.svelte` | À auditer |
| Rendu Markdown, KaTeX, blocs de code, fichiers générés | `render.js`, `fileconvert.js`, `tauri-save.js` | `utils/markdown.ts`, `components/chat/Markdown.svelte`, `CodeBlock.svelte` | À auditer |
| Streaming des réponses | `stream.js` | `services/chat-stream.ts` + `stores/stream.svelte.ts` | À auditer |
| Zone de saisie, pièces jointes, menu « + » (caméra, photos, fichiers, web, image, mode étudiant), dictée | `composer.js`, `tauri-files.js`, `tauri-speech.js`, `tauri-skill-commands.js` | `components/chat/Composer.svelte`, `AttachMenu.svelte`, `Attachments.svelte` | À auditer |
| Actions sur les messages, messages enregistrés | `conversations.js`, `saved-messages.js` | `components/chat/MessageActions.svelte` | À auditer |
| Recherche de conversations (locale + serveur) | `conversations.js`, `tauri-chat-search.js` | `components/chat/Search.svelte` | À auditer |
| Conversations archivées / verrouillées | `tauri-archived-chats.js`, `tauri-locked-chats.js` | `components/chat/Archived.svelte`, `Locked.svelte` | À auditer |
| Import de conversations ChatGPT | `conversation-import.js` | `components/settings/ConversationImport.svelte` | À auditer |
| Quiz / fiches / cartes mémoire | `quiz.js`, `quiz.css` | `components/chat/study/*` | À auditer |
| PowerPoint | `powerpoint.js`, `powerpoint-visuals.js`, `pptxgen` | `components/chat/PowerPoint.svelte` | À auditer |
| Aperçus de fichiers | `preview.js`, plugin `file-preview` (iOS) | `components/files/Preview.svelte` + `services/native.ts` | À auditer |
| Bibliothèque unifiée (miniatures, filtres, 1 à 4 colonnes) | `library.js` + patches + `tauri-file-thumbnails.js` | `components/library/*` | À auditer |
| Stockage / quota Files V2 | `tauri-storage.js`, `tauri-files-store.js` | `components/storage/*` + `stores/files.svelte.ts` | À auditer |
| Fenêtre Paramètres (onglets Compte, Général, Skills, MCP) `#settings-modal` | `settings.js`, `general-settings.js`, `account-activity.js`, `tauri-storage-settings.js` | `components/settings/*` | Lu (HTML), Non commencé |
| Assistant MCP (3 étapes) `<dialog id="mcp-wizard">` | `settings.js` | `components/settings/McpWizard.svelte` | À auditer |
| Recherche web (`<dialog>`) | `general-settings.js` | `components/settings/WebSettings.svelte` | À auditer |
| Clé d'API | `tauri-api-key-settings.js` | `components/settings/ApiKey.svelte` | À auditer |
| Projets (liste, tri, recherche, éditeur, partage) | `projects.js`, `tauri-project-shares.js`, `projects-activity.css` | `components/projects/*` | Lu (HTML), Non commencé |
| Compatibilité iOS (clavier, safe areas) | `ios-compat.js`/`.css` (dépend de `window.Capacitor`) | `utils/viewport.ts` + CSS | Lu (cf. `docs/audit-migration.md`) |
| Reprise au premier plan | `tauri-resume-on-foreground.js` | `services/lifecycle.ts` | À auditer |
| Import `.fsbackup` | `tauri-data-import.js`, `migration/*` | **Hors périmètre** : page `migration.html` séparée | Lu (arborescence) |
| France IDE | `ide-link*.js` | **Exclu** de la préversion Tauri (cf. constat 2) | Lu |

## 3. Communications avec Rust

Commandes `#[tauri::command]` relevées dans `src-tauri/src/lib.rs` :

| Commande | Utilisée par (constat) | Service TS prévu |
|---|---|---|
| `legacy_request`, `legacy_cancel` | `legacy-transport.ts` (lu) : transport HTTP en flux | `services/api.ts` |
| `upload_begin`, `upload_chunk`, `upload_finish`, `upload_cancel` | `legacy-transport.ts` (lu) | `services/upload.ts` |
| `legacy_login`, `legacy_exchange` | `legacy-transport.ts` (lu) | `services/auth.ts` |
| `session_read`, `session_write`, `session_delete` | `legacy-transport.ts` (lu) | `services/session.ts` |
| `speech_supported`, plugin `stt` | `main.ts` (lu) | `services/speech.ts` |
| `plugin:file-preview\|open` | `legacy-transport.ts` (lu) | `services/native.ts` |
| `migration_schedule` + 5 commandes de `migration_host.rs` | `legacy-transport.ts` / page migration | hors périmètre |
| `connect`, `list_chats`, `get_chat`, `list_projects`, `generate`, `cancel_generation` | **Pas d'appel trouvé dans `legacy-transport.ts`** ; usage réel à vérifier | à décider : candidats pour la couche chat typée |

Point à trancher avant d'écrire les services : le chat historique passe par `legacy_request` (HTTP générique), alors que Rust expose aussi des commandes typées (`generate`, `list_chats`…). Il faut vérifier laquelle est effectivement utilisée pour ne pas dupliquer les appels API.

## 4. Stratégie retenue

Contrainte : le DOM historique est un bloc indissociable (identifiants partagés, globales, ordre de chargement). On ne peut pas remplacer un seul écran dans l'iframe sans pont durable.

1. **Fondations** (`lib/types`, `lib/services`, `lib/stores`) : typées, testées sans DOM. Aucun impact visuel.
2. **Nouvelle app Svelte derrière un drapeau** (par exemple `?ui=svelte`), l'iframe restant le défaut jusqu'à parité. Deux implémentations coexistent donc **temporairement**, et c'est signalé comme tel.
3. **Ordre** : connexion → coque + navigation → paramètres → projets → bibliothèque/stockage → conversations (la plus risquée : `stream.js`, `render.js`, `composer.js`).
4. **CSS** : réutiliser les 20 feuilles historiques dans l'ordre actuel (import global) plutôt que les réécrire ; le sélecteur par identifiant devient des classes seulement si besoin.
5. **Retrait de l'iframe et de `prepare-legacy.cjs`** uniquement quand la parité est validée.

## 5. Limites actuelles

- Les fichiers `www/js/*.js` hors `app.js`, `core.js`, `login.js` n'ont **pas encore été lus en entier** (`stream.js`, `render.js`, `composer.js`, `conversations.js`, `settings.js`, `projects.js`, `library.js`, `models.js`) : événements, états et dépendances DOM de ces écrans restent à inventorier avant de les porter.
- Mesures disponibles : taille du build uniquement (JS `main` 61,8 kB / 23,4 kB gzip ; feuilles historiques en un chunk CSS paresseux de 109,5 kB / 20,8 kB gzip, chargé seulement par `?ui=svelte`). Aucune mesure de fluidité, de mémoire ni de temps de démarrage sur appareil : aucune affirmation d'amélioration n'est faite.
- Écart connu non repris : la limite de 50 Mo des pièces jointes (introduite dans b736855) n'existe que côté historique.
- Le tracé de l'icône `pin` de `conversations.js` contient apparemment une coquille (`l-1 63 3v2`) ; il est **conservé tel quel** dans `utils/icons.ts` pour un design identique. À faire confirmer avant de corriger.
- Tant que l'historique Svelte n'est pas monté et que les actions (ouvrir, renommer, épingler, supprimer) ne sont pas portées, le store des conversations reste en lecture seule pour ne pas faire s'écraser deux copies dans IndexedDB.
- Rien n'a été exécuté sur iPhone ni compilé pour iOS ici.
