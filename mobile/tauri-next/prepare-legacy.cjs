"use strict";
// Keep the existing visual baseline without modifying the Capacitor source.
require("./prepare-document-assets.cjs");
const fs = require("node:fs");
const path = require("node:path");
const source = path.resolve(__dirname, "../www");
const destination = path.resolve(__dirname, "public/legacy");
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
const indexPath = path.join(destination, "index.html");
let index = fs.readFileSync(indexPath, "utf8");
function removeOnce(text, expression, label) {
  if (!expression.test(text)) throw new Error(`${label} introuvable dans l'interface historique`);
  return text.replace(expression, "");
}
index = removeOnce(index, /^\s*<button id="france-ide-open"[^\r\n]*<\/button>\s*$/m, "Entrée France IDE");
index = removeOnce(index, /^\s*<link rel="stylesheet" href="ide-link\.css">\s*$/m, "Style France IDE");
index = removeOnce(index, /^\s*<script src="js\/ide-link\.js"><\/script>\s*$/m, "Script France IDE");
index = removeOnce(index, /^\s*<script src="js\/ide-link-remembered\.js"><\/script>\s*$/m, "Script de mémorisation France IDE");
index = removeOnce(index, /^\s*<script src="js\/chat-shares\.js"><\/script>\s*$/m, "Script « Gérer les accès » du menu des conversations");
const core = '<script src="js/core.js"></script>';
if (!index.includes(core)) throw new Error("Point d'entrée de l'interface historique introuvable");
index = index.replace(core, core + '\n  <script src="js/tauri-bridge.js"></script>\n  <script src="js/tauri-files-store.js"></script>\n  <script src="js/tauri-file-thumbnails.js"></script>');
const conversationsScript = '<script src="js/conversations.js"></script>';
if (!index.includes(conversationsScript)) throw new Error("Historique des conversations introuvable");
index = index.replace(conversationsScript, conversationsScript + '\n  <script src="js/tauri-chat-search.js"></script>');
const composer = '<script src="js/composer.js"></script>';
if (!index.includes(composer)) throw new Error("Éditeur historique introuvable");
index = index.replace(composer, composer + '\n  <script src="js/tauri-files.js"></script>\n  <script src="js/tauri-storage.js"></script>\n  <script src="js/tauri-archived-chats.js"></script>\n  <script src="js/tauri-locked-chats.js"></script>\n  <script src="js/tauri-chat-context.js"></script>\n  <script src="js/tauri-speech.js"></script>');
const render = '<script src="js/render.js"></script>';
if (!index.includes(render)) throw new Error("Génération de fichiers introuvable");
index = index.replace(render, render + '\n  <script src="js/tauri-save.js"></script>');
const login = '<script src="js/login.js"></script>';
if (!index.includes(login)) throw new Error("Connexion historique introuvable");
index = index.replace(login, login + '\n  <script src="js/tauri-login.js"></script>');
const settingsScript = '<script src="js/settings.js"></script>';
if (!index.includes(settingsScript)) throw new Error("Paramètres historiques introuvables");
index = index.replace(settingsScript, settingsScript + '\n  <script src="js/tauri-storage-settings.js"></script>\n  <script src="js/tauri-skill-commands.js"></script>');
const projects = '<script src="js/projects.js"></script>';
if (!index.includes(projects)) throw new Error("Gestion des projets introuvable");
index = index.replace(projects, projects + '\n  <script src="js/tauri-project-shares.js"></script>');
index = index.replace('</head>', '  <link rel="stylesheet" href="tauri-files.css">\n  <link rel="stylesheet" href="tauri-chat-search.css">\n  <link rel="stylesheet" href="tauri-archived-chats.css">\n  <link rel="stylesheet" href="tauri-chat-context.css">\n  <link rel="stylesheet" href="tauri-project-shares.css">\n  <link rel="stylesheet" href="tauri-storage-settings.css">\n  <link rel="stylesheet" href="tauri-skill-commands.css">\n</head>');
const appScript = '<script src="app.js"></script>';
if (!index.includes(appScript)) throw new Error("Démarrage de l'interface historique introuvable");
index = index.replace(appScript, appScript + '\n  <script src="js/tauri-session.js"></script>');
index = index.replace(appScript, appScript + '\n  <script src="js/tauri-resume-on-foreground.js"></script>');
index = index.replace(appScript, appScript + '\n  <script src="js/tauri-api-key-settings.js"></script>');
index = index.replace(appScript, appScript + '\n  <script src="js/tauri-data-import.js"></script>');
// Choix de l'interface (classique / Svelte 5 bêta) dans Paramètres > Général.
index = index.replace(appScript, appScript + '\n  <script src="js/tauri-interface-settings.js"></script>');
// Pont inerte vers la coque Svelte (?ui=svelte) : il ne fait rien tant que la page parente ne l'a pas activé.
index = index.replace(appScript, appScript + '\n  <script src="js/tauri-svelte-engine.js"></script>');
// Pont du chat Svelte (?ui=svelte&chat=svelte) : inerte lui aussi tant que le parent ne l'a pas attaché.
index = index.replace('<script src="js/tauri-svelte-engine.js"></script>', '<script src="js/tauri-svelte-engine.js"></script>\n  <script src="js/tauri-svelte-chat-engine.js"></script>');
// Pont des réglages locaux (Paramètres Svelte) : sans état, il n'expose que `window.__fsSettings`.
index = index.replace('<script src="js/tauri-svelte-chat-engine.js"></script>', '<script src="js/tauri-svelte-chat-engine.js"></script>\n  <script src="js/tauri-svelte-settings-engine.js"></script>');
index = index.replace('<script src="js/tauri-svelte-settings-engine.js"></script>', '<script src="js/tauri-svelte-settings-engine.js"></script>\n  <script src="js/tauri-svelte-workspace-engine.js"></script>');
fs.copyFileSync(path.join(__dirname, "svelte-workspace-engine.js"), path.join(destination, "js/tauri-svelte-workspace-engine.js"));
fs.writeFileSync(indexPath, index);
fs.copyFileSync(path.join(__dirname, "legacy-bridge.js"), path.join(destination, "js/tauri-bridge.js"));
fs.copyFileSync(path.join(__dirname, "files-store.js"), path.join(destination, "js/tauri-files-store.js"));
fs.copyFileSync(path.join(__dirname, "file-thumbnails.js"), path.join(destination, "js/tauri-file-thumbnails.js"));
fs.copyFileSync(path.join(__dirname, "legacy-files.js"), path.join(destination, "js/tauri-files.js"));
fs.copyFileSync(path.join(__dirname, "legacy-storage.js"), path.join(destination, "js/tauri-storage.js"));
fs.copyFileSync(path.join(__dirname, "storage-settings.js"), path.join(destination, "js/tauri-storage-settings.js"));
fs.copyFileSync(path.join(__dirname, "storage-settings.css"), path.join(destination, "tauri-storage-settings.css"));
fs.copyFileSync(path.join(__dirname, "legacy-login.js"), path.join(destination, "js/tauri-login.js"));
fs.copyFileSync(path.join(__dirname, "legacy-session.js"), path.join(destination, "js/tauri-session.js"));
fs.copyFileSync(path.join(__dirname, "resume-on-foreground.js"), path.join(destination, "js/tauri-resume-on-foreground.js"));
fs.copyFileSync(path.join(__dirname, "api-key-settings.js"), path.join(destination, "js/tauri-api-key-settings.js"));
fs.copyFileSync(path.join(__dirname, "legacy-speech.js"), path.join(destination, "js/tauri-speech.js"));
fs.copyFileSync(path.join(__dirname, "legacy-data-import.js"), path.join(destination, "js/tauri-data-import.js"));
fs.copyFileSync(path.join(__dirname, "interface-settings.js"), path.join(destination, "js/tauri-interface-settings.js"));
fs.copyFileSync(path.join(__dirname, "svelte-engine.js"), path.join(destination, "js/tauri-svelte-engine.js"));
fs.copyFileSync(path.join(__dirname, "svelte-chat-engine.js"), path.join(destination, "js/tauri-svelte-chat-engine.js"));
fs.copyFileSync(path.join(__dirname, "svelte-settings-engine.js"), path.join(destination, "js/tauri-svelte-settings-engine.js"));
fs.copyFileSync(path.join(__dirname, "legacy-save.js"), path.join(destination, "js/tauri-save.js"));
fs.copyFileSync(path.join(__dirname, "project-shares.js"), path.join(destination, "js/tauri-project-shares.js"));
fs.copyFileSync(path.join(__dirname, "project-shares.css"), path.join(destination, "tauri-project-shares.css"));
fs.copyFileSync(path.join(__dirname, "remote-chat-search.js"), path.join(destination, "js/tauri-chat-search.js"));
fs.copyFileSync(path.join(__dirname, "remote-chat-search.css"), path.join(destination, "tauri-chat-search.css"));
fs.copyFileSync(path.join(__dirname, "archived-chats.js"), path.join(destination, "js/tauri-archived-chats.js"));
fs.copyFileSync(path.join(__dirname, "locked-chats.js"), path.join(destination, "js/tauri-locked-chats.js"));
fs.copyFileSync(path.join(__dirname, "archived-chats.css"), path.join(destination, "tauri-archived-chats.css"));
fs.copyFileSync(path.join(__dirname, "chat-context.js"), path.join(destination, "js/tauri-chat-context.js"));
fs.copyFileSync(path.join(__dirname, "chat-context.css"), path.join(destination, "tauri-chat-context.css"));
fs.copyFileSync(path.join(__dirname, "skill-commands.js"), path.join(destination, "js/tauri-skill-commands.js"));
fs.copyFileSync(path.join(__dirname, "skill-commands.css"), path.join(destination, "tauri-skill-commands.css"));
const corePath = path.join(destination, "js/core.js");
let coreSource = fs.readFileSync(corePath, "utf8");
const initialSnapshot = 'JSON.stringify({ ...store, conversations: [] })';
const normalSnapshot = 'JSON.stringify(conversationDatabase ? { ...store, conversations: [] } : store)';
if (!coreSource.includes(initialSnapshot) || !coreSource.includes(normalSnapshot)) throw new Error("Stockage historique des conversations introuvable");
coreSource = coreSource.replace(initialSnapshot, 'JSON.stringify({ ...store, session: undefined, conversations: [] })');
coreSource = coreSource.replace(normalSnapshot, 'JSON.stringify(conversationDatabase ? { ...store, session: undefined, conversations: [] } : { ...store, session: undefined })');
// Modèles d'images GPT Image 2.6 : ids acceptés par l'API (énumération imageGenerationModel de l'OpenAPI).
const imageModelList = '["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"].includes(saved.imageModel)';
if (!coreSource.includes(imageModelList)) throw new Error("Liste des modèles d'images (core.js) introuvable");
coreSource = coreSource.replace(imageModelList, '["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"].includes(saved.imageModel)');
fs.writeFileSync(corePath, coreSource);
fs.copyFileSync(path.join(__dirname, "legacy-files.css"), path.join(destination, "tauri-files.css"));
const composerPath = path.join(destination, "js/composer.js");
let composerSource = fs.readFileSync(composerPath, "utf8");
const attachmentFields = "data: file.data, previewId: file.previewId || null";
if (!composerSource.includes(attachmentFields)) throw new Error("Contrat des pièces jointes introuvable");
const imageModelsStart = '"gpt-image-2.5-sunburst": { short: "Sunburst", name: "GPT Image 2.5 Sunburst" },';
if (!composerSource.includes(imageModelsStart)) throw new Error("Liste des modèles d'images (composer.js) introuvable");
composerSource = composerSource.replace(imageModelsStart, '"gpt-image-2.6-sunburst": { short: "Sunburst", name: "GPT Image 2.6 Sunburst" },\n  "gpt-image-2.6-flare": { short: "Flare", name: "GPT Image 2.6 Flare" },\n  ' + imageModelsStart);
// Skill imposé par « /nom » : la consigne est ajoutée au message envoyé, le texte affiché reste inchangé.
const fallbackText = 'if (!sentText && uploads.length) sentText = uploads.some(file => file.kind === "image") ? "Décris cette image." : "Analyse ce fichier.";';
if (!composerSource.includes(fallbackText)) throw new Error("Construction du message envoyé introuvable");
const sendMessageSignature = "async function sendMessage()";
if (!composerSource.includes(sendMessageSignature)) throw new Error("Envoi historique introuvable");
composerSource = composerSource.replace(sendMessageSignature, "async function sendMessage(skillPrefix)");
composerSource = composerSource.replace(fallbackText, fallbackText + '\n  if (typeof skillPrefix === "string") sentText = skillPrefix + sentText; else if (typeof tauriSkillPrefix === "function") sentText = tauriSkillPrefix(text) + sentText;');
const powerpointCondition = "  const powerpoint = (typeof detectsPowerPointRequest";
if (!composerSource.includes(powerpointCondition)) throw new Error("Commande PowerPoint introuvable.");
composerSource = composerSource.replace(powerpointCondition,
  "  const powerpoint = store.powerpointMode === true || (typeof detectsPowerPointRequest");
fs.writeFileSync(composerPath, composerSource.replace(attachmentFields, "data: String(file.data || '').startsWith('blob:') ? '' : file.data, remoteId: file.remoteId, remoteKind: file.remoteKind, previewId: file.previewId || null"));
const conversationsPath = path.join(destination, "js/conversations.js");
let conversations = fs.readFileSync(conversationsPath, "utf8");
const entryLine = 'const entry = { role, content: typeof item.content === "string" ? item.content : "" };';
if (!conversations.includes(entryLine)) throw new Error("Contrat d'historique introuvable");
conversations = conversations.replace(entryLine, entryLine + '\n      entry.serverMessageId = typeof item.id === "string" ? item.id : null;\n      entry.attachments = tauriMessageFiles(item);');
const localMerge = 'if (local && local.attachments) message.attachments = local.attachments;';
if (!conversations.includes(localMerge)) throw new Error("Fusion des pièces jointes introuvable");
conversations = conversations.replace(localMerge, 'if (local && local.attachments) message.attachments = tauriMergeMessageFiles(message.attachments, local.attachments);');
const localUser = 'const local = localUsers[userIndex++];';
const localAssistant = 'const localAnswer = localAssistants[assistantIndex++];';
if (!conversations.includes(localUser) || !conversations.includes(localAssistant)) throw new Error("Correspondance locale des messages introuvable");
conversations = conversations.replace(localUser, 'const local = tauriFindLocalMessage(message, localUsers, userIndex++);');
conversations = conversations.replace(localAssistant, 'const localAnswer = tauriFindLocalMessage(message, localAssistants, assistantIndex++);');
const renderFiles = 'if (message.role === "user" && message.attachments) renderMessageAttachments(bubble, message.attachments);';
if (!conversations.includes(renderFiles)) throw new Error("Affichage des pièces jointes introuvable");
conversations = conversations.replace(renderFiles, 'if (message.attachments && message.attachments.length) renderMessageAttachments(bubble, message.attachments);');
fs.writeFileSync(conversationsPath, conversations);
const streamPath = path.join(destination, "js/stream.js");
let stream = fs.readFileSync(streamPath, "utf8");
const imageUpload = 'postAttachment("/files/upload", { data: src, mime: info[1], name: "image-precedente." + ext })';
if (!stream.includes(imageUpload) || !stream.includes('images.push(remoteId);')) throw new Error("Réutilisation d'image générée introuvable");
stream = stream.replace(imageUpload, 'postAttachment("/filesv2", { data: src, mime: info[1], name: "image-precedente." + ext })');
stream = stream.replace('images.push(remoteId);', 'files.push(remoteId);');
// Chat Svelte (?ui=svelte&chat=svelte) : la lecture du flux SSE peut être déléguée à la page parente. Le crochet n'est
// défini QUE si le pont du chat reçoit un `readStream` ; sinon (mode par défaut) la lecture historique s'exécute inchangée.
const streamCheckPattern = /^  if \(!response\.ok\) \{\r?\n    const detail = await response\.text\(\)\.catch\(\(\) => ""\);/gm;
const streamCheckMatches = stream.match(streamCheckPattern) || [];
if (streamCheckMatches.length !== 1) throw new Error("Contrôle de la réponse du flux (stream.js) introuvable ou ambigu (" + streamCheckMatches.length + ")");
const streamEol = stream.includes("\r\n") ? "\r\n" : "\n";
const streamHook = [
  '  if (typeof window.__fsStreamReader === "function") {',
  '    const fsLog = [];',
  '    try { window.__lastStreamLog = fsLog; } catch {}',
  '    return await window.__fsStreamReader({',
  '      response, conversation, resume, imageMode: store.imageMode === true, onDelta,',
  '      onEvent: typeof onEvent === "function" ? (event => onEvent(event.name, event.data)) : undefined,',
  '      shouldStop: () => stopRequested === true,',
  '      fetchChatDetail: id => apiFetch("/chats/" + encodeURIComponent(id)),',
  '      resolveImage: resolveGeneratedImage, save: saveStore, log: fsLog',
  '    });',
  '  }',
  ''
].join(streamEol);
stream = stream.replace(streamCheckPattern, match => streamHook + match);
fs.writeFileSync(streamPath, stream);
const libraryPath = path.join(destination, "js/library.js");
let library = fs.readFileSync(libraryPath, "utf8");
const projectLabel = "'Classer '+record.name+' dans un projet'";
if (!library.includes(projectLabel)) throw new Error("Classement local de la bibliothèque introuvable");
library = library.replace(projectLabel, "'Classer localement '+record.name+' dans un projet'");
library = library.replace("project.setAttribute('aria-label',", "project.title='Classement local uniquement';project.setAttribute('aria-label',");
fs.writeFileSync(libraryPath, library);
const appPath = path.join(destination, "app.js");
const app = fs.readFileSync(appPath, "utf8");
fs.writeFileSync(appPath, removeOnce(app, /^\s*\$\("france-ide-open"\)\.addEventListener\("click", openFranceIDE\);\s*$/m, "Initialisation France IDE"));
