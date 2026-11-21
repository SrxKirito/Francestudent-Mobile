# Cartographie du moteur de chat legacy (préparation de la migration Svelte 5)

Statut : **préparation**. Rien n'est remplacé. Le moteur legacy (`mobile/www/js/*`, chargé dans l'iframe) reste le seul
moteur de chat actif. Le service de streaming TypeScript décrit plus bas **n'est branché nulle part**.

Vocabulaire des statuts (jamais « vérifié sur appareil » sans test réel sur appareil) :
- **Lu** : code lu en entier, comportement décrit d'après le code.
- **Testé Node** : comparé au code d'origine sous Node (`vm`), pas sur un appareil.
- **Navigateur headless** : vérifié dans Chrome headless avec un faux backend Tauri (`npm run verify:browser`).
- **Non vérifié** : aucun test ; à valider sur appareil iOS/Android.

## 1. Fichiers lus

| Fichier | Lignes | Rôle |
|---|---|---|
| `mobile/www/js/stream.js` | 985 | Flux SSE, erreurs, pièces jointes, images générées, reprise iOS |
| `mobile/www/js/render.js` | 417 | Markdown, code, fichiers générés (PDF/PowerPoint), toast, enregistrement |
| `mobile/www/js/composer.js` | 789 | Zone de saisie, modes, pièces jointes, dictée, envoi, régénération |
| `mobile/www/js/assistant.js` | (l. 206-369 lues) | `runAssistant` : seul consommateur de `streamChat` |
| `mobile/www/js/core.js` | (globales) | `busy`, `stopRequested`, `activeConversation` |

## 2. `stream.js` : fonctions et dépendances

| Fonction | Rôle | Dépendances globales | Migration |
|---|---|---|---|
| `createSseParser` | Découpe SSE (`\n`/`\r\n`, `id`, `event`, `data`) | aucune | **Porté** (TS, testé Node) |
| `describeStreamError` | Texte d'une erreur de flux | aucune | **Porté** |
| `friendlyError` | Message utilisateur par type d'erreur | `navigator.onLine` | **Porté** (`online` en paramètre) |
| `updateNetworkBanner` | Bandeau `#network-banner`, écouteurs online/offline | DOM, `window` | À migrer (composant) |
| `attachmentBlob`, `uploadErrorDetail`, `postAttachment`, `uploadAttachment` | Envoi des pièces jointes (`/files/upload` images, `/filesv2` autres) | `apiFetch`, `store` | À migrer |
| `syncImageTool`, `syncFileInstructions`, `imagePromptPrefix` | Instructions utilisateur côté serveur (`/user/instructions`) | `apiFetch`, `store` | À migrer |
| `collectSourceUrls` | Sources (plafond 40, profondeur 10) | `URL` | **Porté** |
| `collectGeneratedImages` (+ `Core`), `generatedImageKey`, `describeShape`, `collectUuidCandidates` | Détection d'images générées | aucune | **Portés** (`collectGeneratedImagesLegacy` : code mort, non porté) |
| `fetchGeneratedImage`, `resolveGeneratedImage`, `downloadGeneratedImage` | Téléchargement/cache des images | Capacitor `CapacitorHttp`, `apiFetch`, `FileReader`, `saveFile` | À migrer (le service reçoit `resolveImage`) |
| `renderGeneratedImages` | DOM `.generated-images`, aperçu, défilement | DOM, `previewAttachment`, `scrollToBottom` | À migrer (composant) |
| `streamChat` | Récupération iOS/arrière-plan : `visibilitychange`, baseline, polling 30×2 s de `/chats/{id}`, erreur « app suspendue » | DOM, `apiFetch`, `store` | **À migrer, non porté** (le plus risqué) |
| `streamChatRequest` | Requête + lecture du flux | `apiFetch`, `store`, `saveStore`, `stopRequested` | **Lecture du flux portée** (`processChatStream`) ; payload/uploads/image source restent legacy |
| `cancelStream` | `POST /chats/{id}/stream/cancel` | `apiFetch` | À migrer (trivial) |

Payload de `POST /chats/stream` : `{agentId, chatId, enableCanvas:false, enableWebSearch, images, initialContent,
isIncognito:false, isPrivate:false, files?, projectId?}`. Reprise : `GET /chats/{id}/stream?last_event_id=`
(`resumeStreamPath`, porté).

Événements émis vers l'interface : `image_start`, `image`, `sources`, `message_saved`, `web_search`.

## 3. `render.js` et `composer.js` (lus, rien de porté)

- **render.js** : `escapeHtml`, `highlightCode`, cartes de fichiers, `showToast` (`#app-toast`), blocs de code,
  `makePdf` (PDF Courier WinAnsi), `saveFile` (FileSaver Capacitor ou lien `a[download]`), `makePowerPoint`,
  Markdown (`renderMarkdown(source, streaming)`), formules via `window.katex`.
- **composer.js** : état d'envoi, redimensionnement, bascules (web, image, PowerPoint), modes d'étude
  (fiches/quiz/cartes), choix du modèle d'image, pièces jointes (PDF via `pdfjsLib`, images → JPEG, `FileConvert`,
  limite 50 Mo, `AttachmentPicker` iOS), dictée (plugin natif `SpeechRecognition` ou Web Speech), `stopGeneration`,
  `sendMessage`, `regenerate`.
- Dépendances communes : variables globales (`store`, `busy`, `activeConversation`), DOM, Capacitor.

## 4. Patches de `prepare-legacy.cjs` à ne pas perdre

- `stream.js` : `/files/upload` → `/filesv2` et `images.push(remoteId)` → `files.push(remoteId)` pour l'image source.
- `composer.js` : champs `remoteId`/`remoteKind`, `tauriSkillPrefix(text)`, modèles d'image 2.6.
- `core.js` : liste des modèles d'image. `conversations.js` : `serverMessageId`, `tauriMessageFiles`,
  `tauriMergeMessageFiles`, `tauriFindLocalMessage`. `library.js`, `app.js` (France IDE).
- Côté Rust : `src-tauri/src/lib.rs` (`generate`, `cancel_generation`), `mobile/tauri-api/src/sse.rs`.

## 5. Service de streaming TypeScript (nouveau, non branché)

- `src/lib/types/chat-stream.ts` : types (`StreamSource`, `GeneratedImage`, `StreamEvent`, `ProcessChatStreamOptions`…).
- `src/lib/services/chat-stream.ts` : `createSseParser`, `describeStreamError`, `friendlyError`, `collectSourceUrls`,
  `collectGeneratedImages`, `generatedImageKey`, `describeShape`, `collectUuidCandidates`, `resumeStreamPath`,
  `processChatStream`. Aucune globale : `online`, `shouldStop`, `fetchChatDetail`, `resolveImage`, `save`, `now` sont injectés.
- Test : `test-svelte-chat-stream.mjs` (dans `npm test`). Il charge le **vrai** `stream.js` dans un contexte `vm` et
  compare : 16 échantillons SSE × 5 découpages, ≈41 erreurs × 3 états réseau, 12 cas de sources, ≈24 cas d'images,
  ≈43 scénarios de flux complet × 3 découpages (0/1/7 octets), `resumeStreamPath`.
- Écart assumé : sur réponse HTTP non OK, l'original n'a pas encore créé son journal (`undefined`) ; le service reçoit un
  tableau vide fourni par l'appelant.
- Syntaxe TypeScript « effaçable » (pas d'enum ni de paramètres-propriétés) pour être exécutée telle quelle par Node.

## 6. Ce qui reste à migrer avant de remplacer le chat

1. Construction du payload, envoi des pièces jointes, image source précédente, synchronisation des instructions.
2. `streamChat` (récupération iOS/arrière-plan) : à tester sur appareil.
3. Téléchargement des images (`fetchGeneratedImage`, Capacitor).
4. Rendu Markdown/code/fichiers (`render.js`) et formules.
5. Zone de saisie (`composer.js`) : pièces jointes, dictée, modes.
6. `runAssistant` (`assistant.js`) : bulles, machine à écrire, états.
7. **Décision à prendre** : `locked-chats-ui`, `conversation-import` (+ `chat-shares`, France IDE) ont été retirés
   volontairement de l'injection (commit `b736855`). Ne pas les réactiver sans arbitrage.

## 7. Limites

- Aucun test sur iOS/Android/WKWebView. Les tests Node et le Chrome headless ne les remplacent pas.
- Le faux backend du test navigateur n'est ni le vrai serveur ni le Rust.
- `svelte-check` ne couvre que `src/**` (le service est couvert ; `test-*.mjs` non).

## 8. Chat Svelte 5 branché (architecture hybride, mise à jour)

Cette section remplace l'état « non branché » de la section 5 : le service de streaming est désormais utilisé par le chat Svelte.

### Activation
- **Depuis le 20/11/2026, Svelte 5 et son chat sont l'interface par défaut.** L'ancien écran reste accessible : `?ui=legacy` ou `localStorage["fs-ui"] = "legacy"` ; le chat historique dans la nouvelle coque : `?chat=legacy` ou `localStorage["fs-chat"] = "legacy"`. L'URL l'emporte sur la clé ; toute autre valeur est ignorée.
- L'iframe legacy et `prepare-legacy.cjs` sont conservés. `mobile/www` n'est jamais modifié.

### Architecture
- L'iframe legacy reste vivante comme moteur : authentification, 401, transport Rust, persistance, construction de la requête, téléversements, conversions. Elle n'est jamais en `display:none`.
- Une surcouche opaque `ChatPane` (Svelte) recouvre l'iframe. Pont : `svelte-chat-engine.js` (exposé via `window.__fsChat`), adaptateur TypeScript `src/lib/services/chat-engine.ts`.
- Quand l'iframe ouvre un `dialog[open]` ou les Paramètres (`body.settings-open`), ou quand l'app n'est pas prête, la surcouche est masquée et l'iframe redevient interactive. Sinon l'iframe est `inert`.
- Les notifications du moteur sont redirigées vers `ToastHost`.

### Découvertes utiles
- Les entrées « chats verrouillés » (barre latérale, menu « Verrouiller ») ne sont plus montées par le legacy actuel : elles n'ont pas été recréées. Service, store et `PinDialog` existent mais ne sont pas joignables par l'UI aujourd'hui.
- L'arrêt d'une génération passe par `POST /chats/{id}/stream/cancel`, comme dans le legacy.
- `tauri-files.js` téléverse tous les fichiers (texte compris) dès la sélection (`upload_begin/chunk/finish`). L'envoi est refusé tant qu'un fichier n'est pas terminé ; le composer Svelte désactive Envoyer et affiche l'état (`En attente d’envoi`, `Envoi NN %`, `Échec` + `Réessayer`).
- Les changements d'état de la zone legacy (Paramètres, dialogues) ne passent pas par les fonctions patchées : le pont observe le DOM avec un `MutationObserver` pour republier `legacyOverlay`.

### Vérification
- `npm test`, `npm run check` (0 erreur, 0 avertissement), `npm run build` et `npm run verify:browser` (34 vérifications au 20/11/2026) : exit 0.
- Le test navigateur utilise Chrome headless et un faux backend (y compris un faux `upload_*`). Il ne vaut pas test iOS/Android ni test sur le vrai serveur.

### Reste legacy / non porté
Construction de requête, téléversements et conversions (via le moteur) ; récupération en arrière-plan iOS de `streamChat` ; bascule PowerPoint ; sélecteur de modèle d'image ; indisponibilité des modèles ; rendus interactifs (quiz, cartes, PPTX/PDF, fichiers générés, aperçu d'image générée) ; réinitialisation du PIN.

### Choix de l'interface dans les Paramètres (classique / Svelte 5 bêta)
- Paramètres > Général > « Interface » : deux boutons radio (« Interface classique », « Interface Svelte 5 (bêta) ») et, avec Svelte, un interrupteur « Utiliser aussi le nouveau chat (bêta) ». Un clic écrit `fs-ui` / `fs-chat` dans le `localStorage` de la page parente, puis recharge la page sans `?ui` ni `?chat`.
- Mécanisme : `interface-settings.js` est copié par `prepare-legacy.cjs` vers `mobile/www/js/tauri-interface-settings.js` (fichier généré) et injecté après `app.js`. Aucun fichier de `mobile/www` n'est modifié à la main. Le choix est également disponible dans Général côté Svelte. L’interface classique reste accessible pendant la transition.
- Garde-fous : refus pendant une réponse en cours ; si le stockage est refusé, les anciennes valeurs sont restaurées et un message l'indique ; une URL invalide ne modifie rien.
- Limites : le rechargement perd un brouillon non envoyé ; les règles de lecture/écriture des drapeaux sont dupliquées de `src/lib/utils/ui-flag.ts` (à aligner si les défauts changent) ; vérifié seulement par `test-interface-settings.cjs` (12 tests) et un scénario Chrome headless avec clics programmatiques dans l'iframe, pas sur iOS/Android.

### Commandes et dictée depuis le composeur Svelte

Le menu `/` utilise le catalogue de l’onglet Skills. La consigne de sélection est transmise au moteur de chat et le message affiché conserve le texte saisi. Le composeur Svelte utilise directement l’adaptateur de dictée iOS exposé par Tauri. Il arrête la session de dictée à l’envoi, en arrière-plan et lors d’un changement de discussion. Le parcours du composeur est simulé dans Chrome; les permissions, l’interruption, la reprise et la reconnaissance restent à vérifier sur iPhone. L’adaptateur natif est activé uniquement sur iOS.


## 9. Chat Svelte autonome

Le mode Svelte démarre une session Tauri et crée son moteur de chat, sa navigation et son stockage sans monter l’iframe. Le lecteur SSE utilise le transport Rust. La réponse partielle et le curseur restent dans IndexedDB afin de reprendre un flux interrompu sans envoyer à nouveau la demande. Le composeur utilise les options PowerPoint et modèle d’image. Les quiz, cartes et aperçus de fichiers sont rendus par Svelte. Les PDF utilisent un canvas et la génération des fichiers réutilise les convertisseurs existants.

L’interface Svelte ne propose ni discussions verrouillées ni code PIN. Les marques de verrouillage existantes sont conservées avec les données locales et les éléments verrouillés sont écartés de l’affichage. L’option Interface classique reste accessible comme repli explicite en attendant les validations sur appareil.

Les résultats de vérification mentionnés dans les sections précédentes concernent l’architecture hybride. Cette étape n’a pas été testée ni compilée à la demande du contributeur. À contrôler notamment sur iPhone et Android : suspension et reconnexion pendant un flux, restauration des données existantes, ouverture des fichiers, téléchargement et cycle de session.
