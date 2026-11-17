# Dictée mobile : intégration à valider

Les fichiers `speech-bridge.mjs` et `legacy-speech.js` adaptent le composeur
existant au plugin `tauri-plugin-stt` 0.2.2, dont le moteur iOS est
`SFSpeechRecognizer`. Test local : `node test-speech-bridge.mjs`. Aucun accès
réel au microphone n'a été effectué.

Pour intégrer : déclarer la dépendance Rust pour iOS et Android, enregistrer
`tauri_plugin_stt::init()` uniquement sur mobile, autoriser les commandes
`is_available`, `check_permission`, `request_permission`, `start_listening`,
`stop_listening` et l'enregistrement des listeners dans une capability mobile.
Dans `src/main.ts`, exposer avant le montage Svelte un objet
`__franceStudentSpeech = createSpeechAdapter(invoke, addPluginListener)` sur
mobile uniquement. Copier `legacy-speech.js` dans la copie générée et le charger
après `composer.js` et avant `app.js`. Les descriptions microphone et
reconnaissance vocale figurent déjà dans `Info.ios.plist`.

Vérifier d'abord le fonctionnement des permissions et des listeners sur un
véritable appareil iOS, notamment mise en arrière-plan, arrêt, erreurs réseau,
et l'absence de double résultat. La dépendance mobile et les capacités n'ont
pas été raccordées ici ; l'adaptateur seul n'active pas la dictée. Le plugin peut
utiliser le service de reconnaissance du système selon sa configuration.
