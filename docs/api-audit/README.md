# Audit préalable de l'API France Student

Instantané OpenAPI 3.1.0 récupéré le 16 novembre 2026 depuis
`https://api.francestudent.ai/v3/api-docs` : [openapi.json](openapi.json).
Le Swagger indiqué par le projet charge `/v3/api-docs/swagger-config`.
La spécification équivalente sur `api.francestudent.org` expose les mêmes
chemins ; son URL de serveur déclarée diffère. Les deux spécifications déclarent
un serveur HTTP : le client doit employer l'URL HTTPS réellement utilisée.

L'[inventaire des opérations](operations.md) est généré à partir de cet
instantané. « À adapter » signifie qu'une validation reste nécessaire ; ce n'est
pas une preuve que l'opération est absente de l'application. Aucune opération
n'a été déclarée testée sur un compte de test dans cet audit.

## Comparaison avec l'application actuelle

| Domaine | Application actuelle | Contrat et travail restant |
| --- | --- | --- |
| Plateformes | Capacitor 7, JavaScript, Android et iOS | Migration progressive vers Tauri 2, Rust et Svelte 5 ; préserver les ponts natifs et l'interface. |
| Authentification | Cookie de session conservé dans `fs-chat-state`, échangé sur le site pour un jeton, puis `Authorization: Bearer …` ; renouvellement après 401 | OpenAPI décrit `authorization` comme clé API ; l'échange de cookie sur le site n'est pas dans cette spécification. Ne pas supposer son remplacement ou sa suppression. Migrer les secrets vers un stockage natif protégé. |
| Conversations | Historique, détail, suppression, projets et SSE déjà présents ; `/chats/stream` est utilisé avec un `chatId` pour les échanges | Le contrat sépare la création (`POST /chats/stream`) de l'envoi (`POST /chats/{chatId}`). Vérifier les métadonnées, la pagination et les fonctionnalités d'archive, de partage, de verrouillage, d'édition et de contexte. |
| SSE | Parseur, annulation et reprise par `last_event_id` existants ; pont iOS natif | Conserver les identifiants d'événements, ignorer les keepalives et types inconnus, traiter `completed`, `error`, `cancelled` comme terminaux et tester la reprise. |
| Fichiers | Sélection multiple ; images envoyées à `/files/upload`, autres fichiers à `/filesv2` ; données converties en mémoire, parfois conservées localement | Files v2 fournit liste paginée, upload, métadonnées, contenu, suppression, quota, types MIME et migration des images historiques. Valider le format réel de `FileObject` et du contenu avec des mocks puis un environnement de test autorisé. |
| Projets | Création, modification et liste de conversations déjà présentes | Les conversations peuvent être déplacées vers un projet ; aucun endpoint de rattachement ou de liste directe de fichiers par projet n'est documenté. Ne pas simuler une persistance serveur inexistante. |
| Stockage local | `localStorage` contient notamment session, préférences et conversations ; IndexedDB sert aux aperçus | Conserver les données locales existantes pendant la transition. Le serveur reste la source de vérité des ressources distantes ; cache et données hors ligne doivent être distingués, bornés et migrés sans effacement prématuré. |
| Autres fonctions | Modèles, réglages, skills et MCP partiellement présents | Évaluer chaque opération de l'inventaire ; notamment partages, mémoires, clés API, passkeys, messages sauvegardés, import, DeskDock et Safety Hub. |

`GET /user/me` et `POST /mcp/servers/{serverId}/discover` apparaissent dans
l'application mais pas dans cet OpenAPI. Les champs `enableCanvas`,
`isIncognito` et `isPrivate` envoyés à la création d'un chat ne figurent pas
dans `ChatCreateDto`. Une absence dans la spécification ne démontre pas qu'un
comportement est supprimé : aucun remplacement ne doit être inventé.

## Contraintes du contrat et validation

- La sécurité globale déclare l'en-tête `authorization`. Les exceptions publiques,
  permissions de partage, propriétaire, staff et accès aux chats verrouillés
  sont à vérifier opération par opération ; la spécification ne documente pas
  complètement tous les codes d'erreur.
- Les identifiants de fichiers v2 sont des chaînes ; les anciens fichiers et
  images de message utilisent des UUID. Les messages exposent `usedFileIds` et
  `usedFilesV2Ids`. Les associations aux messages s'effectuent via `images` et
  `files` des requêtes de chat ; aucun modèle de fichier de projet n'est spécifié.
- `POST /filesv2/legacy-migration` ferme l'ancienne API de fichiers pour le
  compte. Ne pas l'exécuter automatiquement : vérifier le statut, le quota,
  les échecs et la compatibilité avec les anciens clients avant toute migration.
- Le contrat ne précise pas de taille maximale de fichier, de reprise d'upload,
  ni une politique complète de cache ou d'expiration. Interroger les types MIME
  et le quota, gérer les erreurs réelles, et ne pas promettre la reprise d'un
  transfert. Le contenu est décrit comme `string` au format `byte` sous `*/*` :
  son encodage effectif doit être vérifié avant d'implémenter le téléchargement.
- Aucun appel authentifié ni suppression de données de production n'a été
  effectué pour cet audit. Les tests mobiles réels exigent les SDK et appareils
  ou simulateurs correspondants, et les tests réseau un compte de test autorisé.

Régénérer l'inventaire : `node docs/api-audit/inventory.cjs` depuis la racine du dépôt.
