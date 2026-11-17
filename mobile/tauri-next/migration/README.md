# Transfert des données locales

Ces modules constituent le moteur de transfert ; **ils ne sont pas encore
branchés à l'interface** ni aux sélecteurs de fichiers natifs. L'ancienne app
Capacitor et la nouvelle app Tauri ont des origines Web distinctes et peuvent
avoir des conteneurs différents : leur `localStorage` et leur IndexedDB ne sont
pas automatiquement partagés. Les données côté serveur continuent d'être
chargées depuis l'API ; le transfert porte uniquement sur les données locales.

## Contenu et protection

`source.mjs` lit l'état brut `fs-chat-state`, les conversations présentes en
mémoire après initialisation de `francestudent-conversations`, puis les magasins
`files` et `library` de `francestudent-previews`. Il vérifie les doublons de
conversations entre l'ancienne copie et la copie active. Les deux sources de
session ne doivent pas diverger. En cas d'erreur, aucune donnée locale n'est
supprimée ou écrasée.

`backup.mjs` écrit une archive chiffrée par blocs avec AES-256-GCM et une clé
dérivée par PBKDF2-SHA-256 (310 000 itérations, sel aléatoire). La phrase de
sauvegarde reste locale et contient au moins 12 caractères. La session est
chiffrée dans l'archive ; elle n'est jamais écrite en clair dans l'état importé.
Les blocs sont numérotés et authentifiés, et une fin obligatoire permet de
détecter une archive tronquée. Cette protection dépend de la robustesse de la
phrase choisie et ne remplace pas la protection de l'appareil.

L'archive doit être écrite dans un fichier temporaire puis finalisée seulement
après retour réussi d'`exportBackup`. Les écritures se font par blocs de 48 Kio ;
l'encodage JSON d'un seul enregistrement peut néanmoins occuper sa taille en
mémoire, et l'import rassemble les blocs d'un aperçu en un `Blob` avant son
insertion IndexedDB. Limites techniques explicites : 128 Mio par objet JSON et
512 Mio par aperçu. Une limite dépassée interrompt l'opération sans supprimer
les originaux ; ne pas présenter l'archive partielle comme valide. Un adaptateur
de fichier natif à écriture incrémentale reste nécessaire pour réduire davantage
la mémoire sur les plus gros aperçus.

## Contrat d'intégration

`orchestrate.mjs` fournit `exportLegacy` et `importLegacy` : ils gardent le
verrou fourni par l'hôte pendant l'opération et annulent le fichier temporaire
si l'export échoue. L'hôte doit réellement empêcher les écritures de toutes les
fenêtres ; ces fonctions ne créent pas elles-mêmes ce verrou et ne rendent pas
les sélecteurs natifs disponibles.

`host.mjs` relie les adaptateurs et refuse l'initialisation si aucun fournisseur
de verrou n'est fourni. `ui.mjs` fournit un panneau autonome pour exporter,
vérifier puis importer ; il efface la phrase saisie après chaque opération et
signale les conflits sans écraser. Ces deux modules ne branchent pas encore
l'interface dans l'application : le verrou doit couvrir les écritures en cours
et les événements en arrière-plan, et le fichier temporaire doit être finalisé
par un pont natif sur chaque plateforme. Ne pas connecter ces modules à un
verrou factice ou publier cette migration comme terminée avant les essais.

### Pont iPhone expérimental

`MigrationExportPlugin.swift` expose un fichier temporaire privé, des écritures
limitées à 64 Kio, une finalisation par déplacement vers Documents sous un nom
UUID et un abandon. `ios-sink.mjs` découpe chaque bloc à 48 Kio pour ce pont.
Pour l'intégrer à une **version de transition Capacitor**, ajouter le fichier
Swift aux sources du projet Xcode, enregistrer `MigrationExportPlugin()` dans
`FranceStudentViewController.capacitorDidLoad`, puis fournir
`createIosTemporaryFactory(Capacitor.Plugins.MigrationExport)` à l'hôte.
Le fichier final se trouve dans Fichiers / Sur mon iPhone / FranceStudent Chat.
Le pont ne supprime jamais les données d'origine. Une interruption peut laisser
un fichier `.partial` dans le répertoire temporaire ; il ne doit pas être
présenté comme une sauvegarde valide. Le code Swift n'a pas été compilé ni
testé sur iPhone dans cet environnement Windows.

`capacitor-host.mjs` relie concrètement ce pont au moteur d'export. Il exige
un contrôle natif de WebView unique, un arrêt réversible des tâches et
interactions, le drainage des opérations en cours, un garde installé tôt et les
accesseurs d'état. Il refuse de démarrer si une fonction manque, vérifie la
WebView de nouveau avant la finalisation et reprend les tâches après échec.
Ces fonctions ne sont pas encore fournies par l'application Capacitor : un
simple callback retournant `true` ne doit pas être utilisé. Les transactions et
les mutations en mémoire ne doivent pas être supposées suspendues tant que le
cycle de vie et les travaux asynchrones n'ont pas été réellement instrumentés.

`install-ios-bridge.mjs` prépare le plugin dans une **copie distincte** du
répertoire `mobile` Capacitor : il l'ajoute aux sources Xcode et place son
enregistrement derrière `FS_MIGRATION_EXPORT`, indicateur qu'il ne définit pas.
Depuis `mobile/tauri-next`, utiliser par exemple :

```js
const { installIosBridge } = await import('./migration/install-ios-bridge.mjs');
await installIosBridge('/chemin/vers/copie/mobile');
```

L'installation vérifie les points de branchement avant écriture et refuse la
copie source et une installation déjà présente. En cas d'échec pendant les
écritures, recréer la copie. L'indicateur ne doit pas être activé avant la
mise en place et la validation du verrou global. Cette préparation ne remplace
pas une compilation Xcode avec CocoaPods ni des essais sur iPhone ; aucun de
ces essais n'a été possible sur Windows.

`export-guard.mjs` fournit un garde-fou côté WebView pour les transactions
IndexedDB `readwrite` des deux bases et les appels Storage sur `fs-chat-state`.
Il doit être installé **synchronement avant tout autre script** et son
`acquireExclusive` passé à l'hôte d'export. Il attend les transactions déjà
ouvertes et invalide l'export si une nouvelle écriture est tentée avant la
finalisation. Il ne contrôle ni les autres WebViews/processus, ni les accès
directs par propriété à Storage, ni les mutations mémoire non suivies d'une
écriture. L'intégration doit garantir une WebView unique, arrêter les travaux
en arrière-plan, bloquer les interactions et attendre les files existantes ;
tant que ces conditions ne sont pas vérifiées, ce garde-fou ne constitue pas
un verrou complet et l'export ne doit pas être activé. Il ne convient pas au
verrou d'import, qui doit autoriser les écritures de restauration uniquement.
Le constructeur impose aussi `capture()`, fonction synchrone retournant une
représentation stable de l'état mémoire **et** de `fs-chat-state` ; la capture
est comparée avant finalisation, ce qui détecte les mutations persistantes et
les écritures directes par propriété. Il impose un `acquireGlobal()` ;
`acquireWebLock(navigator.locks)` est fourni comme verrou interfenêtres
coopératif. Tous les écrivains doivent utiliser ce même verrou : il ne bloque
pas les autres WebViews non participantes et ne remplace pas une garantie native
de WebView unique. Les modifications transitoires revenues exactement à leur
état initial ne sont pas détectées. En l'absence de Web Locks ou d'une autre
coordination fiable, l'export doit rester désactivé.

1. Dans l'ancienne app, arrêter temporairement toute écriture de conversations,
   attendre `conversationWrite` si présent, récupérer le texte brut de
   `localStorage.getItem("fs-chat-state")`, le tableau `store.conversations`
   après `initializeConversationStorage`, et la base ouverte par
   `openPreviewDatabase()`. Appeler `capacitorRecords` puis `exportBackup` avec
   un `sink.write(Uint8Array)` à capacité bornée. Rendre l'app à nouveau utilisable
   même si l'export échoue. Le sélecteur et le stockage de destination doivent
   être fournis par un pont natif ; l'ancien `FileSaver.save` reçoit du base64
   complet et ne satisfait pas ce contrat pour de gros fichiers.
2. Dans Tauri, garder les écritures de l'app suspendues pendant l'inspection et
   l'import. Ouvrir les mêmes magasins locaux, fournir les méthodes
   `vault.read()` et `vault.write(session)`, et créer `createTauriDestination`.
   `inspectBackup` valide intégralement l'archive avant de comparer les données.
   Il renvoie les conflits sans rien écrire. Une UI doit les présenter et
   permettre une résolution explicite avant de continuer : les préférences déjà
   différentes, y compris un `deviceId` différent, ne sont jamais remplacées
   automatiquement.
3. `restoreBackup` refait l'inspection avant l'écriture. Les insertions IndexedDB
   sont conditionnelles et atomiques par enregistrement ; une modification
   concurrente est traitée comme conflit. Une interruption peut laisser un
   import partiel **sans écrasement** ; l'archive et la source restent intactes
   et une nouvelle tentative est idempotente. Ne supprimer aucune sauvegarde ou
   donnée Capacitor après l'import sans vérification explicite de l'utilisateur.

Les adaptateurs supposent les schémas actuels : conversations dans le magasin
`state`, clé `conversations`, et aperçus / bibliothèque indexés par `id`. Toute
évolution de ces schémas exige une nouvelle validation. La restauration d'un
objet JSON ou d'un fichier de taille supérieure aux limites n'est pas encore
prise en charge. Les tests sont simulés et ne remplacent pas une validation sur
iOS ou Android et sur des données de test autorisées.

Depuis `mobile/tauri-next` :

```sh
node migration/test-backup.mjs
node migration/test-adapters.mjs
node migration/test-orchestrate.mjs
node migration/test-ui.mjs
node migration/test-ios-guard.mjs
node migration/test-capacitor-host.mjs
node migration/test-install-ios-bridge.mjs
```
