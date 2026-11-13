# FranceStudent en Rust

## IDE ordinateur

L’exécutable Rust ouvre l’interface existante de `desktop/renderer` dans une fenêtre Tao/Wry (WebView2 sur Windows, WKWebView sur macOS). Le HTML, le CSS et les composants JavaScript sont partagés avec Electron. Le processus Node.js `desktop/main.js --rust-host` fournit les services de l’IDE via des tubes privés.

Depuis la racine du projet, avec Node.js 22.19+ (ou 24.6+) et npm :

```sh
npm ci --ignore-scripts
npm run build:renderer
npm run vendor:effectcraft
```

La dernière commande reconstruit le moteur Rust/WASM d’EffectCraft avec le correctif du projet. Elle requiert la cible Rust `wasm32-unknown-unknown`. Les assets générés et les crédits restent à leur emplacement habituel.

Ensuite, depuis `rust/`, avec Rust et la chaîne de compilation de la plateforme (MSVC et WebView2 sur Windows) :

```sh
cargo run --locked -p francestudent-ide
```

Ajouter `-- "<dossier>"` pour ouvrir directement un projet. Sur cette machine, l’exécutable de développement se trouve dans `target/debug/` avec son chargeur WebView2.

### Atelier Rust

Depuis `rust/`, `cargo run --locked -p francestudent-ide -- --workbench-rust` ouvre l’interface Dioxus sans démarrer Node.js. Elle regroupe l’explorateur, l’éditeur texte, le terminal de commandes simple, les sauvegardes avec aperçu et restauration, et les onglets Chat et Agent Code. `--simple` ouvre aussi cet atelier. Une seule fenêtre de l’IDE Rust peut utiliser le profil à la fois.

Dans l’atelier, la connexion se fait avec un cookie de session FranceStudent dans l’onglet Chat. L’agent Code partage cette session, utilise les outils natifs de fichiers et de skills, propose un mode Plan, demande confirmation avant les écritures et peut sauvegarder le projet avant d’agir. Il conserve ses échanges à l’écran pendant la session. Le terminal de l’atelier exécute les commandes saisies par l’utilisateur. Le terminal interactif, l’intégration des commandes de l’agent, la gestion graphique des skills, les extensions et Motion restent accessibles dans la fenêtre principale.

Vérification Windows sur un projet isolé : ouverture et enregistrement d’un fichier, sauvegarde, aperçu, confirmation et restauration, création d’une version de sécurité, exécution et arrêt d’une commande. Le parcours de l’agent dans cette interface reste à valider avec une session FranceStudent.

L’interface principale, le navigateur local Windows et le cadre EffectCraft utilisent des origines distinctes. Seul le document principal reçoit le pont natif. Le profil d’aperçu `FranceStudentIDE-Rust` est séparé du profil Electron.

### Terminal, agent Code et versions

- Le terminal utilise ConPTY sur Windows et le pseudo-terminal du système sur macOS. Rust gère la saisie, la sortie, le redimensionnement, l’arrêt et le terminal simple. Le choix du profil et la résolution des distributions WSL utilisent les réglages existants.
- Avec un dossier ouvert dans l’espace Code, Rust pilote la demande, sélectionne les outils et exécute les opérations de base sur les fichiers. Les confirmations et questions s’affichent dans l’interface habituelle. Un refus arrête la demande. Le mode Plan retire les outils de modification et d’exécution.
- Dans Personnaliser → Skills, le sélecteur donne accès aux collections et à Mes skills. L’agent Code reçoit le catalogue des skills actifs de l’utilisateur et du projet lorsque l’outil Skills est sélectionné. Il charge les instructions d’un skill à la demande et les garde dans le contexte de la tâche. L’import et l’activation utilisent les fichiers existants du profil.
- Rust enregistre la version avant la demande quand l’option est activée. Les fichiers sensibles, liens et dossiers exclus restent hors de la version. L’aperçu de restauration est lié à l’état du projet et une version de sécurité est créée avant la restauration. L’onglet Sauvegardes lit aussi les versions existantes du profil. Une demande avec sauvegarde activée s’arrête si la capture échoue. La taille cumulée est limitée à 512 Mio et la restauration à 100 fichiers.
- Dans la fenêtre principale, le transport HTTPS Rust utilise le magasin de certificats du système pour renouveler le jeton, consulter le compte, les modèles et les discussions, et ouvrir, reprendre ou arrêter les flux du modèle. Le formulaire e-mail/mot de passe, le coffre de session, le traitement des événements du flux, le journal local et certaines autres requêtes restent dans le service Node.
- La découverte et la lecture des skills Code sont en Rust. Le centre d’édition, l’import, les profils et le marketplace sont encore fournis par Node. Les règles de commande et les intégrations avancées restent aussi dans ce service. Les commandes directes autorisées sont exécutées par Rust. Les pipelines, redirections et certains lanceurs utilisent l’exécuteur historique. Motion et le chat classique utilisent leurs moteurs existants. Le changement de consigne pendant une demande et le mode éphémère restent à porter dans le moteur Code de la fenêtre principale.

Le service Node de l’IDE Rust ajoute les autorités de certification approuvées par le système à sa configuration TLS. Ce réglage s’applique au lancement du processus.

L’export PDF texte et l’auto-mise à jour de l’installeur restent à adapter. Sur macOS, le navigateur intégré et le pilotage d’EffectCraft restent à porter. IDE Link, les intégrations distantes et le lancement sur macOS restent à vérifier.

Vérifications Windows effectuées dans l’aperçu : ouverture des écrans d’accueil, de connexion, de paramètres, de plugins et de bibliothèque, puis connexion à FranceStudent confirmée. La lecture et l’enregistrement d’un fichier ainsi que le pseudo-terminal ont été vérifiés via le service local. Le moteur EffectCraft reconstruit a répondu à `host.info` dans son cadre isolé lors d’une vérification Chromium locale.

Vérifications Windows du port natif : saisie, sortie, redimensionnement et fermeture du terminal interactif, puis refus et approbation d’une modification, blocage en mode Plan, restauration et rejet d’un aperçu périmé. Les vérifications de l’agent Code ont utilisé des réponses de modèle simulées.

## Android et iPhone

Android et iPhone partagent l’interface Dioxus et le client HTTP Rust. Le chat texte propose la connexion par cookie de session, le choix du modèle, l’historique et la lecture en direct. L’écran **Projets** ouvre les projets du compte et leurs discussions, crée et modifie les projets, et demande confirmation avant leur suppression. Les nouvelles discussions sont associées au projet ouvert. L’écran **Réglages** enregistre sur le compte les instructions personnalisées, le niveau de réflexion GPT et les filtres de recherche web.

Le composeur propose **Fichiers** et **Photos**. Le sélecteur système de la WebView contrôle la limite de 50 Mio par fichier avant de fournir ses données par tranches au client Rust. Les fichiers texte UTF-8 rejoignent le message s’ils tiennent dans la limite de l’API. Rust extrait aussi le texte des PDF, DOCX, PPTX, ODT et ODP. Le message indique que les images, la mise en page et les contenus intégrés sont omis dans cette extraction. Les fichiers non pris en charge, les PDF sans texte sur une page et les documents dépassant le budget d’extraction sont envoyés entiers à la route fichiers du compte. La conversion JPEG reprend les formats d’image que la WebView peut décoder.

La rasterisation locale des PDF scannés, l’extraction d’autres formats bureautiques, la dictée et IDE Link restent à porter.

Depuis `apps/mobile/`, utiliser la CLI Dioxus 0.7 correspondant à la version du fichier `Cargo.lock` :

```sh
dx build --android --target aarch64-linux-android
dx serve --ios
```

Android requiert le JDK, le SDK et le NDK Android ainsi que la cible Rust `aarch64-linux-android`. La commande iPhone vise le simulateur et requiert macOS, Xcode et la cible `aarch64-apple-ios-sim`. La cible d’un iPhone physique est `aarch64-apple-ios` et l’installation sur l’appareil requiert une signature. Voir le [guide mobile Dioxus](https://dioxuslabs.com/learn/0.7/guides/platforms/mobile/).

Le workflow manuel `.github/workflows/build-rust-iphone.yml` prépare sur macOS un IPA ARM64 à signer, avec la CLI Dioxus 0.7.10. Il doit être ajouté à un dépôt GitHub et exécuté. Le workflow et l’installation sur iPhone restent à vérifier.

L’APK ARM64 de développement `target/artifacts/FranceStudent-Chat-Android-arm64-debug.apk` a été compilé et installé sur un émulateur, où l’écran de connexion a été vérifié. Les appels authentifiés de Projets et Réglages, le chat mobile avec un compte réel et la compilation iPhone restent à vérifier.

Le projet original est de **EsteG7** et des contributeurs d’origine. Le fork d’amélioration est maintenu par **extraopaa**. Les crédits et l’attribution des composants figurent dans [CREDITS.md](../CREDITS.md).
