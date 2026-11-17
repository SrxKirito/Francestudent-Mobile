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
```
