# Suivi des opérations OpenAPI

Inventaire généré : 160 opérations, 111 chemins, 198 schémas.

Le statut « À adapter » indique un travail ou une validation restant à faire, sans présumer que la fonction est absente. « Implémentée » indique un portage partiel ; les tests simulés ne prouvent pas la compatibilité sur appareil ou serveur. Aucune fonction n'est déclarée entièrement testée tant que ces validations manquent. Les permissions fines sont à vérifier avec un compte de test autorisé.

| Domaine | Méthode et chemin | Fonction documentée | Statut | Validation |
| --- | --- | --- | --- | --- |
| ads-controller | `POST /ads/challenges/{challengeId}/complete` |  | À adapter | Non testée |
| API Key | `DELETE /user/@me/api-key` | Revoquer ma cle API | À adapter | Non testée |
| API Key | `GET /user/@me/api-key` | Consulter ma cle API | À adapter | Non testée |
| API Key | `POST /user/@me/api-key` | Generer ma cle API | À adapter | Non testée |
| api-landing-controller | `GET /` |  | À adapter | Non testée |
| api-landing-controller | `DELETE /error` |  | À adapter | Non testée |
| api-landing-controller | `GET /error` |  | À adapter | Non testée |
| api-landing-controller | `HEAD /error` |  | À adapter | Non testée |
| api-landing-controller | `OPTIONS /error` |  | À adapter | Non testée |
| api-landing-controller | `PATCH /error` |  | À adapter | Non testée |
| api-landing-controller | `POST /error` |  | À adapter | Non testée |
| api-landing-controller | `PUT /error` |  | À adapter | Non testée |
| Chat Message Images | `GET /chats/{chatId}/messages/{messageId}/images/{imageId}` | Recuperer une image generee dans un message | À adapter | Non testée |
| Chat Shares | `DELETE /chats/{chatId}/shares` | Supprimer un partage par cible dans le body | Implémentée | Permissions et serveur à vérifier |
| Chat Shares | `GET /chats/{chatId}/shares` | Lister les partages d'un chat | Implémentée | Permissions et serveur à vérifier |
| Chat Shares | `PATCH /chats/{chatId}/shares` | Modifier un partage par cible dans le body | Implémentée | Permissions et serveur à vérifier |
| Chat Shares | `POST /chats/{chatId}/shares` | Ajouter un partage de chat | Implémentée | Permissions et serveur à vérifier |
| Chats | `DELETE /chats` | Supprimer tous les chats | À adapter | Non testée |
| Chats | `GET /chats` | Lister les chats de l'utilisateur | À adapter | Non testée |
| Chats | `DELETE /chats/{chatId}` | Supprimer un chat | À adapter | Non testée |
| Chats | `GET /chats/{chatId}` | Recuperer un chat | À adapter | Non testée |
| Chats | `PATCH /chats/{chatId}` | Mettre a jour un chat | À adapter | Non testée |
| Chats | `POST /chats/{chatId}` | Envoyer un message en streaming | À adapter | Non testée |
| Chats | `PUT /chats/{chatId}/archive` | Archiver un chat | Implémentée | Archivage simulé ; appareil et serveur à vérifier |
| Chats | `GET /chats/{chatId}/archive/download` | Telecharger les messages d'un chat archive | À adapter | Non testée |
| Chats | `GET /chats/{chatId}/context` | Recuperer l'occupation du contexte d'un chat | À adapter | Non testée |
| Chats | `POST /chats/{chatId}/context` | Compacter le contexte d'un chat | À adapter | Non testée |
| Chats | `PATCH /chats/{chatId}/messages/{messageId}` | Editer un message en forkan le chat | À adapter | Non testée |
| Chats | `DELETE /chats/{chatId}/pins` | Desepingler un chat | À adapter | Non testée |
| Chats | `PUT /chats/{chatId}/pins` | Epingler un chat | À adapter | Non testée |
| Chats | `PUT /chats/{chatId}/restore` | Restaurer un chat archive | Implémentée | Restauration simulée ; appareil et serveur à vérifier |
| Chats | `GET /chats/{chatId}/stream` | Se rattacher au stream d'un chat | Implémentée | Reprise SSE simulée ; appareil à vérifier |
| Chats | `POST /chats/{chatId}/stream/cancel` | Arreter la generation d'un chat | À adapter | Non testée |
| Chats | `GET /chats/{chatId}/usage` | Recuperer l'usage d'un chat | À adapter | Non testée |
| Chats | `GET /chats/agents` | Lister les agents disponibles | À adapter | Non testée |
| Chats | `GET /chats/archived` | Lister les chats archives | Implémentée | Liste simulée ; appareil et serveur à vérifier |
| Chats | `GET /chats/search` | Rechercher dans les chats de l'utilisateur | Implémentée | Tests simulés ; appareil et serveur à vérifier |
| Chats | `POST /chats/stream` | Creer un chat et streamer la reponse | À adapter | Non testée |
| Conversation imports | `POST /conversation-imports/openai` | Importer une conversation OpenAI partage | À adapter | Non testée |
| Data export | `GET /public/data-export/download` | Download a data export (ZIP) with a one-time link token | À adapter | Non testée |
| DeskDock | `DELETE /deskdock` | Supprimer le PC virtuel, ses fichiers et son serveur MCP | À adapter | Non testée |
| DeskDock | `GET /deskdock` | Recuperer le PC virtuel de l'utilisateur authentifie | À adapter | Non testée |
| DeskDock | `POST /deskdock` | Creer le PC virtuel et son serveur MCP | À adapter | Non testée |
| DeskDock | `POST /deskdock/start` | Demarrer le PC virtuel | À adapter | Non testée |
| DeskDock | `POST /deskdock/stop` | Arreter le PC virtuel (les fichiers sont conserves) | À adapter | Non testée |
| Feedback Experiences | `GET /user/@me/feedback-experiences/{experienceId}` | Recuperer l'etat d'une feedback experience | À adapter | Non testée |
| Feedback Experiences | `POST /user/@me/feedback-experiences/{experienceId}/responses` | Sauvegarder une feedback experience | À adapter | Non testée |
| Files | `GET /files` | Lister mes fichiers | À adapter | Non testée |
| Files | `DELETE /files/{fileId}` | Supprimer un fichier | À adapter | Non testée |
| Files | `GET /files/{fileId}` | Recuperer un fichier | À adapter | Non testée |
| Files | `POST /files/upload` | Uploader un fichier | À adapter | Non testée |
| Files v2 | `GET /filesv2` | List files | Implémentée | Pagination simulée ; serveur à vérifier |
| Files v2 | `POST /filesv2` | Upload file | Implémentée | Multipart simulé ; appareil et serveur à vérifier |
| Files v2 | `DELETE /filesv2/{file_id}` | Delete file | Implémentée | Suppression simulée ; serveur à vérifier |
| Files v2 | `GET /filesv2/{file_id}` | Retrieve file | À adapter | Non testée |
| Files v2 | `GET /filesv2/{file_id}/content` | Retrieve file content | À adapter | Non testée |
| Files v2 | `GET /filesv2/legacy-migration` | Legacy files migration status | À adapter | Non testée |
| Files v2 | `POST /filesv2/legacy-migration` | Migrate legacy files | À adapter | Non testée |
| Files v2 | `GET /filesv2/supported-mime-types` | List supported file MIME types | Implémentée | Filtrage simulé ; serveur à vérifier |
| Files v2 | `GET /filesv2/usage` | Retrieve file storage usage | Implémentée | Affichage simulé ; serveur à vérifier |
| Locked Chats | `GET /locked-chats` | Lister les chats verrouilles | À adapter | Non testée |
| Locked Chats | `DELETE /locked-chats/access` | Verrouiller maintenant | À adapter | Non testée |
| Locked Chats | `POST /locked-chats/access` | Ouvrir les chats verrouilles | À adapter | Non testée |
| Locked Chats | `DELETE /locked-chats/chats/{chatId}` | Deverrouiller definitivement un chat | À adapter | Non testée |
| Locked Chats | `PUT /locked-chats/chats/{chatId}` | Verrouiller un chat | À adapter | Non testée |
| Locked Chats | `DELETE /locked-chats/pin` | Reinitialiser le code PIN | À adapter | Non testée |
| Locked Chats | `POST /locked-chats/pin` | Creer le code PIN | À adapter | Non testée |
| Locked Chats | `PUT /locked-chats/pin` | Changer le code PIN | À adapter | Non testée |
| Locked Chats | `GET /locked-chats/status` | Etat des chats verrouilles | À adapter | Non testée |
| MCP Servers | `GET /mcp/servers` | Lister les serveurs MCP de l'utilisateur authentifie | À adapter | Non testée |
| MCP Servers | `POST /mcp/servers` | Ajouter un serveur MCP a l'utilisateur authentifie | À adapter | Non testée |
| MCP Servers | `DELETE /mcp/servers/{serverId}` | Supprimer un serveur MCP de l'utilisateur authentifie | À adapter | Non testée |
| MCP Servers | `POST /mcp/servers/{serverId}` | Modifier un serveur MCP de l'utilisateur authentifie | À adapter | Non testée |
| MCP Servers | `POST /mcp/servers/{serverId}/oauth/start` | Demarrer l'autorisation OAuth d'un serveur MCP | À adapter | Non testée |
| MCP Servers | `POST /mcp/servers/oauth/complete` | Terminer l'autorisation OAuth d'un serveur MCP | À adapter | Non testée |
| Messages | `PATCH /messages/{messageId}` | Mettre a jour le vote d'un message | À adapter | Non testée |
| Metrics | `GET /metrics` | Exporter les metriques Prometheus | À adapter | Non testée |
| Metrics | `GET /metrics/chat-streams` | Consulter l'impact de la limite de streams | À adapter | Non testée |
| Models | `GET /models` | Lister les modeles disponibles | À adapter | Non testée |
| OpenAI compatible API | `GET /v1/models` | Lister les modeles (format OpenAI) | À adapter | Non testée |
| OpenAI compatible API | `POST /v1/responses` | Creer une reponse (format OpenAI Responses) | À adapter | Non testée |
| Passkeys | `GET /user/passkeys` | Lister mes passkeys | À adapter | Non testée |
| Passkeys | `DELETE /user/passkeys/{id}` | Supprimer une de mes passkeys | À adapter | Non testée |
| Passkeys | `PATCH /user/passkeys/{id}` | Renommer une de mes passkeys | À adapter | Non testée |
| Passkeys | `GET /user/passkeys/admin-verification` | Lire l'etat de la preuve passkey admin de ma session | À adapter | Non testée |
| Passkeys | `POST /user/passkeys/admin-verification/activity` | Signaler une activite staff et prolonger la preuve passkey admin | À adapter | Non testée |
| Passkeys | `POST /user/passkeys/registration/finish` | Terminer l'enregistrement d'une passkey | À adapter | Non testée |
| Passkeys | `POST /user/passkeys/registration/options` | Commencer l'enregistrement d'une passkey | À adapter | Non testée |
| Passkeys | `GET /user/passkeys/verification` | Lire la date d'expiration de ma verification passkey | À adapter | Non testée |
| Passkeys | `POST /user/passkeys/verification/finish` | Verifier la passkey et accorder une preuve de 5 minutes a la session | À adapter | Non testée |
| Passkeys | `POST /user/passkeys/verification/options` | Commencer une verification passkey | À adapter | Non testée |
| Patch Notes | `GET /patch-notes` | Lister les patch notes | À adapter | Non testée |
| Patch Notes | `GET /patch-notes/{year}/{month}/{name}` | Recuperer une patch note | À adapter | Non testée |
| project-share-controller | `GET /projects/{projectId}/shares` |  | Implémentée | Partages simulés ; permissions et serveur à vérifier |
| project-share-controller | `POST /projects/{projectId}/shares` |  | Implémentée | Partage simulé ; permissions et serveur à vérifier |
| project-share-controller | `DELETE /projects/{projectId}/shares/{targetUserId}` |  | Implémentée | Retrait simulé ; permissions et serveur à vérifier |
| Projects | `GET /projects` | Lister mes projets | À adapter | Non testée |
| Projects | `POST /projects` | Creer un projet | À adapter | Non testée |
| Projects | `DELETE /projects/{projectId}` | Supprimer un projet | À adapter | Non testée |
| Projects | `GET /projects/{projectId}` | Recuperer un projet | À adapter | Non testée |
| Projects | `PATCH /projects/{projectId}` | Modifier un projet | À adapter | Non testée |
| Projects | `GET /projects/{projectId}/chats` | Lister les chats d'un projet | À adapter | Non testée |
| Projects | `DELETE /projects/{projectId}/chats/{chatId}` | Retirer un chat d'un projet | À adapter | Non testée |
| Projects | `PUT /projects/{projectId}/chats/{chatId}` | Rattacher un chat a un projet | À adapter | Non testée |
| Projects | `GET /projects/shared` |  | Implémentée | Permissions et serveur à vérifier |
| Public | `GET /public/alerts` | Recuperer les alertes publiques | À adapter | Non testée |
| Public | `GET /public/health` | Verifier l'etat de sante de l'application | À adapter | Non testée |
| Safety Hub | `GET /safety-hub/@me` | Get the current user's Safety Hub | À adapter | Non testée |
| Safety Hub | `PUT /safety-hub/request-review/{classificationId}` | Appeal a safety classification | À adapter | Non testée |
| Saved Messages | `GET /user/@me/saved-messages` | Lister mes messages sauvegardes | À adapter | Non testée |
| Saved Messages | `DELETE /user/@me/saved-messages/{chatId}/{messageId}` | Retirer un message sauvegarde | À adapter | Non testée |
| Saved Messages | `PUT /user/@me/saved-messages/{chatId}/{messageId}` | Sauvegarder un message | À adapter | Non testée |
| Skills | `GET /skills` | Lister les skills locaux | À adapter | Non testée |
| Skills | `POST /skills` | Creer un skill local | Implémentée | Multipart simulé ; appareil et serveur à vérifier |
| Skills | `DELETE /skills/{skillId}` | Supprimer un skill local | À adapter | Non testée |
| Skills | `GET /skills/{skillId}` | Recuperer un skill local (possede ou partage avec l'utilisateur) | À adapter | Non testée |
| Skills | `POST /skills/{skillId}` | Modifier la version par defaut, les flags ou l'activation d'un skill local | À adapter | Non testée |
| Skills | `GET /skills/{skillId}/content` | Telecharger le ZIP d'un skill local | À adapter | Non testée |
| Skills | `GET /skills/{skillId}/shares` | Lister les utilisateurs avec qui un skill est partage | À adapter | Non testée |
| Skills | `POST /skills/{skillId}/shares` | Partager un skill avec un utilisateur (10 maximum) | À adapter | Non testée |
| Skills | `DELETE /skills/{skillId}/shares/{targetUserId}` | Retirer le partage d'un skill avec un utilisateur | À adapter | Non testée |
| Skills | `GET /skills/{skillId}/versions` | Lister les versions d'un skill local | À adapter | Non testée |
| Skills | `POST /skills/{skillId}/versions` | Creer une version immutable d'un skill local | À adapter | Non testée |
| Skills | `DELETE /skills/{skillId}/versions/{version}` | Supprimer une version de skill local | À adapter | Non testée |
| Skills | `GET /skills/{skillId}/versions/{version}/content` | Telecharger le ZIP d'une version de skill local | À adapter | Non testée |
| Skills | `GET /skills/shared` | Lister les skills partages avec l'utilisateur | À adapter | Non testée |
| Skills | `DELETE /skills/shared/{skillId}` | Retirer un skill partage de la liste de l'utilisateur | À adapter | Non testée |
| Skills | `POST /skills/shared/{skillId}` | Activer ou desactiver dans le chat un skill partage avec l'utilisateur | À adapter | Non testée |
| staff-access-controller | `GET /auth/staff` |  | À adapter | Non testée |
| Surveys | `GET /user/@me/survey` | Recuperer mon survey actif | À adapter | Non testée |
| Surveys | `POST /user/@me/survey/{surveyId}/seen` | Marquer mon survey comme vu | À adapter | Non testée |
| user-web-search-controller | `GET /user/web-search-domains` | Consulter mon filtre de recherche web | À adapter | Non testée |
| user-web-search-controller | `PUT /user/web-search-domains` | Remplacer mes listes de domaines et choisir la liste active | À adapter | Non testée |
| user-web-search-controller | `GET /user/web-search-domains/audit-log` | Consulter mon historique de recherche web | À adapter | Non testée |
| Users | `PATCH /user/@me` | Mettre a jour mon profil | À adapter | Non testée |
| Users | `DELETE /user/@me/memories` | Supprimer toutes mes memoires | À adapter | Non testée |
| Users | `GET /user/@me/memories` | Lister mes memoires | À adapter | Non testée |
| Users | `DELETE /user/@me/memories/{memoryId}` | Supprimer une memoire | À adapter | Non testée |
| Users | `GET /user/@me/memories/{memoryId}` | Lire une memoire | À adapter | Non testée |
| Users | `GET /user/flags` | Lister les user flags | À adapter | Non testée |
| Users | `GET /user/instructions` | Recuperer mes instructions personnalisees | À adapter | Non testée |
| Users | `PATCH /user/instructions` | Mettre a jour mes instructions personnalisees | À adapter | Non testée |
| Users | `POST /user/invite` | Inviter une personne | À adapter | Non testée |
| Users | `GET /user/notification-preferences` | Recuperer mes preferences notifications | À adapter | Non testée |
| Users | `PATCH /user/notification-preferences` | Mettre a jour mes preferences notifications | À adapter | Non testée |
| Users | `GET /user/pets` | Lister les pets disponibles | À adapter | Non testée |
| Users | `DELETE /user/push/subscriptions` | Supprimer une subscription push | À adapter | Non testée |
| Users | `POST /user/push/subscriptions` | Enregistrer une subscription push | À adapter | Non testée |
| Users | `GET /user/push/vapid-public-key` | Recuperer la cle publique VAPID | À adapter | Non testée |
| Users | `GET /user/rate-limit-credits` | Consulter mes credits de rate limit | À adapter | Non testée |
| Users | `POST /user/rate-limit-credits/activate` | Activer un power-up de rate limit | À adapter | Non testée |
| Users | `POST /user/register-active-developer` | S'inscrire en tant que developpeur actif | À adapter | Non testée |
| Users | `POST /user/register-beta` | S'inscrire a la beta | À adapter | Non testée |
| Users | `DELETE /user/sessions` | Terminer toutes mes sessions | À adapter | Non testée |
| Users | `GET /user/sessions` | Lister mes sessions | À adapter | Non testée |
| Users | `DELETE /user/sessions/{sessionId}` | Terminer une session | À adapter | Non testée |
| Users | `GET /user/tokenusage` | Consulter mon usage de tokens | À adapter | Non testée |
| Users | `POST /user/unregister-active-developer` | Se desinscrire en tant que developpeur actif | À adapter | Non testée |
| Users | `POST /user/unregister-beta` | Se desinscrire de la beta | À adapter | Non testée |
| Users | `GET /user/usage` | Consulter mon usage rate limit | À adapter | Non testée |
