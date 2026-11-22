# Migration Tauri (travail en cours)

Ce projet est une base expérimentale : il ne remplace pas encore l'application
Capacitor et ne doit pas être publié sur SideStore. `npm run dev` et `npm run
build` copient l'interface actuelle depuis `mobile/www` dans `public/legacy`
pour conserver le design existant. L'entrée France IDE et ses scripts sont
retirés de cette copie pour la version en cours ; la source et les données de
France IDE restent intactes pour une réintégration ultérieure. La copie est
générée et non versionnée ; la source existante reste intacte.

Un adaptateur expérimental transmet l'échange de cookie et les requêtes API
JSON au client Rust, avec streaming et annulation. Les fichiers choisis sont
transférés à Files v2 en blocs limités, après consultation des types MIME ; les
identifiants retournés sont conservés avec les messages. La connexion par mot
de passe utilise le parcours existant avec un transport Rust limité aux deux
domaines observés ; elle reste à valider avec un compte de test autorisé. Les
transferts mobiles n'ont pas encore été validés sur appareil. Cette base n'est
pas une preuve de parité fonctionnelle.

## Reprise des données de l'ancienne application

Le côté **import** est en place. Dans **Compte → Données de l'ancienne
application**, le bouton d'import programme une migration. Il faut ensuite
**fermer complètement l'application puis la rouvrir** (iOS ne la relance pas
seule) : elle s'ouvre alors sur une page d'import isolée, où l'on choisit un
fichier `.fsbackup`, saisit sa phrase de passe, examine les conflits puis
importe. Les données déjà présentes ne sont jamais écrasées. Après un import,
fermer et rouvrir l'application une dernière fois. « Revenir à l'application »
n'est possible que si rien n'a été écrit. Détails techniques et limites :
`migration/README.md`.

Limites actuelles : l'**export** n'est pas branché dans l'ancienne app Capacitor
publiée, donc aucun `.fsbackup` ne peut encore en être tiré. Une build de
transition générée sur copie existe (`migration/prepare-transition.mjs`, workflow
manuel `ios-transition-build.yml`, artefact seul) mais n'a jamais été compilée ;
sa publication est une décision humaine. Rien
de ce flux n'a été essayé sur iPhone (verrou natif, sélecteur de fichier dans la
WKWebView, installation via SideStore).

## Import de conversations ChatGPT

Le panneau d'import accepte les conversations ChatGPT partagées (liens de
partage) et les ajoute localement, sans écraser les conversations existantes.

La session de l'enveloppe Tauri est enregistrée dans le stockage sécurisé du
système. Une session déjà présente dans son propre stockage Web est copiée et
relue avant d'être retirée de ce stockage ; en cas de conflit ou d'erreur, la
copie existante est conservée. Cela ne récupère pas automatiquement les
données d'origine Capacitor, dont l'origine Web et le conteneur peuvent différer.

La bibliothèque et les catégories Fichiers et Images de Stockage chargent les
pages suivantes au défilement. Les aperçus d’images FRST de 4 Mio maximum sont
réutilisés depuis un cache local cloisonné par compte, plafonné à 24 Mio et
48 entrées, avec une durée de réutilisation de sept jours. Les valeurs du budget,
de l’activité et du quota de stockage sont préchargées après la connexion.
Le chat garde la génération associée à sa discussion pendant la navigation.
En cas de coupure lors d’un passage en arrière-plan, il reprend le flux par
son curseur ou relit la réponse enregistrée côté serveur. Un échec d’écriture
local peut être retenté au premier plan. En cas de quota local confirmé,
l’application libère le cache des aperçus FRST avant de retenter l’écriture.
La suppression côté serveur nécessite une action explicite ; le classement
par projet de l'ancienne bibliothèque reste local, car aucun rattachement direct
de fichiers aux projets n'est documenté dans l'OpenAPI.

## Démarrage

Le chat charge les styles et restaure la session en parallèle. La détection du
microphone continue après le montage. Pour une session déjà associée à ce
compte, l’historique local s’affiche dès que le périmètre de session est
confirmé et que le stockage est lu. Le profil et la synchronisation serveur
se mettent à jour séparément. Si le compte n’a pas encore d’association locale,
l’app attend son identification avant d’afficher l’historique.

## Conversation vocale

Le bouton de conversation vocale apparaît lorsque la reconnaissance et la
lecture vocales sont disponibles. Après une pause dans la dictée, le chat
envoie la question. Il lit la réponse textuelle puis reprend l’écoute.
Un changement de discussion, l’ouverture d’un panneau ou le passage en
arrière-plan coupe l’écoute. Le bouton « Terminer le mode vocal » arrête
le microphone et la lecture. La génération du chat peut continuer.

## Variantes de réponse

« Régénérer » génère une nouvelle version. Les flèches sous la réponse
permettent de revenir aux versions précédentes. Les autres échanges restent
visibles. Le prochain envoi prend en compte la version sélectionnée.

## Branches de discussion

« Créer une branche », sous une réponse, ouvre une nouvelle discussion dans le
même projet avec les échanges jusqu’à cette réponse. Les messages copiés restent
dans l’historique local de la branche. Au premier envoi, le chat transmet au modèle
jusqu’à 20 000 caractères des échanges les plus récents. Le serveur crée alors
une discussion distincte. Les pièces jointes des anciens messages restent
consultables dans la branche. Pour les analyser de nouveau, joins-les au message.

## Mémoire des discussions

Dans **Paramètres → Général → Mémoire**, l’utilisateur peut ajouter, modifier
ou oublier des souvenirs, puis autoriser leur utilisation. Dans le chat,
« Mémorise que… », « Souviens-toi que… » ou « Mémoriser » sous un message
affiche une confirmation avec le texte proposé. Une demande dictée ouvre la
même confirmation. Le stockage reste
local à l’appareil et cloisonné par compte. Le chat ajoute les souvenirs
actifs à l’envoi dans un contexte masqué dans l’historique visible. Désactiver
la mémoire ou oublier un souvenir agit sur les prochains envois. Le contexte
des conversations déjà envoyées reste géré par le serveur.

Vérifications locales : `npm ci`, `npm run check`, `npm run build`, puis
`cargo check --locked` dans `src-tauri`. Pour les tests du client, exécuter
`cargo test --locked` dans `../tauri-api`. La compilation et les tests iOS
nécessitent macOS, Xcode et les cibles Rust iOS ; un build Windows ne valide pas
Android ou iOS. Le workflow `build-iphone.yml` construit encore Capacitor et ne
doit pas être utilisé pour publier cette migration. Pour Tauri, utiliser
`tauri-iphone-publish.yml` (manuel, dry-run par défaut, pré-release sous
l'identité `org.francestudent.mobile.next`) ; voir `docs/plan-migration-ios.md`.
Tests : `npm test` (JavaScript, y compris le moteur de migration) et
`cargo test --lib` dans `src-tauri`.
