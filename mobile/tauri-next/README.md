# Migration Tauri (travail en cours)

Ce projet est une base expérimentale : il ne remplace pas encore l'application
Capacitor et ne doit pas être publié sur SideStore. `npm run dev` et `npm run
build` copient l'interface actuelle depuis `mobile/www` dans `public/legacy`
pour conserver le design existant. L'entrée France IDE et ses scripts sont
retirés de cette copie pour la version en cours ; la source et les données de
France IDE restent intactes pour une réintégration ultérieure. La copie est
générée et non versionnée ; la source existante reste intacte.

Un adaptateur expérimental transmet l'échange de cookie et les requêtes API
JSON au client Rust, avec streaming et annulation. La connexion par mot de
passe, le stockage, les pièces jointes et les autres ponts natifs ne sont pas
terminés. Cette base n'est pas une preuve de parité fonctionnelle.

Vérifications locales : `npm ci`, `npm run check`, `npm run build`, puis
`cargo check --locked` dans `src-tauri`. Pour les tests du client, exécuter
`cargo test --locked` dans `../tauri-api`. La compilation et les tests iOS
nécessitent macOS, Xcode et les cibles Rust iOS ; un build Windows ne valide pas
Android ou iOS. Le workflow SideStore actuel construit encore Capacitor et ne
doit pas être utilisé pour publier cette migration avant son adaptation et sa
validation sur iOS.
