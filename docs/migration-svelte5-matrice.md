# Matrice de migration — interface historique → Svelte 5 + TypeScript

Branche : `migration/tauri-mobile` (ne pas toucher `main`). Créé le 2026-11-18.

Légende de la colonne « État » :
- **Lu** : le fichier a été lu dans cette session, les constats sont vérifiés.
- **À auditer** : présent d'après l'arborescence ou `index.html`, **pas encore lu**. Aucun constat n'est affirmé.
- **Non commencé** : aucune ligne de Svelte écrite.

État au 2026-11-18 (commit `41da78c`) : **2 écrans sur la liste ci-dessous sont portés (démarrage, connexion)**, plus les fondations (types, état persistant, jeton, session/Keychain, transport). Ils ne s'affichent qu'avec `?ui=svelte` (ou `localStorage["fs-ui"]="svelte"`) ; **par défaut, `App.svelte` affiche toujours l'iframe historique**. Une fois connecté, la nouvelle coque affiche l'iframe : la conversation, la barre latérale, les paramètres, les projets et la bibliothèque sont encore 100 % historiques.

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
| Barre latérale `#sidebar` (marque, repli, nouvelle discussion, recherche, Projets, Bibliothèque, historique, compte) | `index.html`, `conversations.js`, `app.js` | `components/navigation/Sidebar.svelte` | Lu (HTML), Non commencé |
| Contexte projet dans la barre (paramètres, retour) | `projects.js` | `components/projects/ProjectContext.svelte` | À auditer |
| Menu de conversation (épingler, renommer, supprimer) `#conv-menu` | `conversations.js` | `components/chat/ConversationMenu.svelte` | À auditer |
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
- Rien n'a été exécuté sur iPhone ni compilé pour iOS ici.
