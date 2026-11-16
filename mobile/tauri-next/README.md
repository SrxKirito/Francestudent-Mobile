# Migration Tauri (travail en cours)

Ce projet est une base expérimentale : il ne remplace pas encore l'application
Capacitor et ne doit pas être publié sur SideStore. `npm run dev` et `npm run
build` copient l'interface actuelle depuis `mobile/www` dans `public/legacy`
pour conserver une référence visuelle identique. La copie est générée et non
versionnée ; la source existante reste intacte.

L'interface historique dépend encore des ponts Capacitor et de ses appels
réseau JavaScript. Leur portage vers les commandes Tauri et le client Rust,
l'authentification existante, le stockage, les pièces jointes et les fonctions
mobiles ne sont pas terminés. Le module `../tauri-api` et les commandes Rust sont
des fondations indépendantes, pas une preuve de parité fonctionnelle.

Vérifications locales : `npm ci`, `npm run check`, `npm run build`, puis
`cargo check --locked` dans `src-tauri`. Pour les tests du client, exécuter
`cargo test --locked` dans `../tauri-api`. La compilation et les tests iOS
nécessitent macOS, Xcode et les cibles Rust iOS ; un build Windows ne valide pas
Android ou iOS. Le workflow SideStore actuel construit encore Capacitor et ne
doit pas être utilisé pour publier cette migration avant son adaptation et sa
validation sur iOS.
