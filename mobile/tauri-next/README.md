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

Limites actuelles : l'**export** n'est pas encore branché dans l'ancienne app
Capacitor publiée, donc aucun `.fsbackup` ne peut encore en être tiré ; et rien
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

La bibliothèque propose une liste paginée des fichiers du compte et affiche le
quota. La suppression côté serveur nécessite une action explicite ; le classement
par projet de l'ancienne bibliothèque reste local, car aucun rattachement direct
de fichiers aux projets n'est documenté dans l'OpenAPI.

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
