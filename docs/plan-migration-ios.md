# Plan de migration iOS et SideStore

Ce document décrit les vérifications nécessaires avant de remplacer la version
Capacitor. Il ne certifie pas la parité fonctionnelle et ne déclenche aucune
publication.

## État observé

| Élément | Valeur et portée |
| --- | --- |
| Application Capacitor publiée | `org.francestudent.chat` dans `mobile/capacitor.config.json` et dans la source SideStore `source.json`. |
| Préversion Tauri | `org.francestudent.mobile.next` dans `mobile/tauri-next/src-tauri/tauri.conf.json` ; identifiant distinct destiné aux essais. |
| Version minimale | iOS 16.4 dans la configuration Tauri ; le vérificateur d'IPA contrôle `MinimumOSVersion`. |
| Compilation de préversion | Le workflow `.github/workflows/tauri-iphone-preview.yml` construit un IPA non signé, vérifie sa structure, son identifiant, les autorisations déclarées, le manifeste de confidentialité et l'architecture ARM64 ; il conserve un artefact temporaire sans publier de Release. |
| Résultat observé | Le run GitHub Actions `43966892694` pour le commit `fa8dbaa` a réussi. Ce résultat porte sur cet instantané précis ; il ne valide ni installation, ni connexion, ni mise à jour, ni le code ajouté depuis. |
| Pipeline de production actuel | `.github/workflows/build-iphone.yml` construit encore Capacitor, publie une Release et met à jour `source.json`. Il ne doit pas être assimilé à un pipeline de publication Tauri. |

## Identité et continuité

Le bundle de préversion n'est pas celui du catalogue SideStore. Ne pas le
présenter comme une mise à jour de `org.francestudent.chat`. À l'inverse,
reprendre ultérieurement cet identifiant seul ne prouve pas que SideStore
reconnaîtra une mise à jour, que la signature effective restera compatible, ni
que toutes les données seront accessibles après changement de moteur Web. Les
identifiants et signatures effectivement installés doivent être constatés sur
un appareil de test avant toute décision de distribution.

Capacitor et Tauri utilisent des origines Web différentes ; le partage de
`localStorage` et d'IndexedDB ne doit pas être supposé. Les conteneurs et
éléments du trousseau peuvent également différer selon l'identité et la signature
effectives. Le coffre de session Tauri et sa migration interne ne lisent pas à
eux seuls le stockage Web Capacitor. Une mise à jour risquerait donc de rendre
inaccessibles des données locales même si l'historique serveur réapparaît.

Les données à inventorier avant migration comprennent `fs-chat-state`, les
conversations hors ligne dans `francestudent-conversations`, les aperçus et
l'index de bibliothèque dans `francestudent-previews`, les transferts ou
réponses en attente, les préférences et la session. Les ressources serveur
restent régies par l'API ; un fichier classé localement dans un projet n'est pas
pour autant associé au projet côté serveur. Les données France IDE conservées
localement ne doivent pas être effacées malgré le retrait de son interface.

Les modules de `mobile/tauri-next/migration/` proposent un transfert chiffré,
mais leur documentation précise que l'intégration aux deux interfaces, le
verrouillage effectif des écritures et les sélecteurs natifs restent nécessaires.
Ne pas considérer ce mécanisme comme une migration disponible tant que le
parcours complet n'a pas été validé sur appareil. Préserver l'ancienne copie et
la sauvegarde pendant les essais ; une restauration partielle doit être
reprenable sans écrasement silencieux.

## Séquence de validation proposée

1. Produire une version Capacitor de test capable d'exporter toutes les données
   locales pertinentes et une préversion Tauri capable de les inspecter puis de
   les importer. Vérifier la sauvegarde chiffrée, les conflits, l'arrêt pendant
   écriture et la reprise ; ne pas supprimer la source ni la sauvegarde.
2. Sur un iPhone de test et avec un compte de test autorisé, créer des données
   représentatives : brouillon hors ligne, conversations, préférences, aperçus,
   bibliothèque et pièces jointes. Tester absence de réseau, espace insuffisant,
   import interrompu, secret erroné et doublons. Comparer contenu et nombre des
   éléments avant/après ; vérifier la connexion et les fichiers serveur sans
   supprimer de données de production.
3. Tester séparément l'installation côte à côte de la préversion et un scénario
   de mise à jour réaliste avec les signatures et identifiants réellement
   utilisés par SideStore. Relever le comportement observé pour le conteneur,
   le trousseau, l'origine Web et les documents. Ne pas conclure à une
   conservation automatique avant ces essais.
4. Sur le commit candidat exact, relancer tous les tests communs et iOS, construire
   l'IPA Tauri ARM64, contrôler son identifiant cible, sa version, ses permissions,
   son manifeste et son intégrité, puis tester l'installation, le renouvellement
   de signature SideStore, la connexion, la dictée, les fichiers, la reprise SSE
   et le cycle arrière-plan/premier plan sur appareil. Un IPA construit n'est pas
   une preuve de fonctionnement sur iPhone.
5. Adapter explicitement le pipeline de publication pour qu'il utilise l'IPA
   Tauri validé et non le script Capacitor, génère les métadonnées SideStore à
   partir de cet IPA, conserve les versions précédentes et vérifie le résultat
   accessible. Vérifier les droits de publication GitHub et le comportement en
   cas d'échec de mise à jour de `source.json` avant publication.

La publication n'est prête qu'une fois ces étapes et la parité demandée validées.
Prévoir un retour à la version précédente avec une sauvegarde vérifiée ; ne pas
supposer qu'une rétrogradation iOS préservera automatiquement les données ni
qu'un numéro de version inférieur sera accepté par SideStore.
