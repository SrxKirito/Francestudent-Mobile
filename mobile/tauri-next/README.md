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
domaines observés ; elle reste à valider avec un compte de test autorisé. La
migration des données, la gestion complète du stockage et les
autres ponts natifs ne sont pas terminés. Les transferts mobiles n'ont pas
encore été validés sur appareil. Cette base n'est pas une preuve de parité
fonctionnelle.

La bibliothèque propose une liste paginée des fichiers du compte et affiche le
quota. La suppression côté serveur nécessite une action explicite ; le classement
par projet de l'ancienne bibliothèque reste local, car aucun rattachement direct
de fichiers aux projets n'est documenté dans l'OpenAPI.

Vérifications locales : `npm ci`, `npm run check`, `npm run build`, puis
`cargo check --locked` dans `src-tauri`. Pour les tests du client, exécuter
`cargo test --locked` dans `../tauri-api`. La compilation et les tests iOS
nécessitent macOS, Xcode et les cibles Rust iOS ; un build Windows ne valide pas
Android ou iOS. Le workflow SideStore actuel construit encore Capacitor et ne
doit pas être utilisé pour publier cette migration avant son adaptation et sa
validation sur iOS.
