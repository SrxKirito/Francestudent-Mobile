# Dictée mobile iOS

Le composeur utilise `speech-bridge.mjs` et `legacy-speech.js` avec le plugin
`tauri-plugin-stt` 0.2.2, intégré localement pour iOS et fondé sur
`SFSpeechRecognizer`. La capability iOS limite les commandes autorisées ; le
plugin est arrêté lors du passage en arrière-plan. Le moteur peut utiliser le
service de reconnaissance du système selon sa configuration. Android conserve
son comportement existant et ne charge pas ce plugin.

La copie locale supprime les journaux contenant les transcriptions : voir
`vendor/tauri-plugin-stt/LOCAL-CHANGES.md`. Les descriptions microphone et
reconnaissance vocale figurent dans `Info.ios.plist`.

Les tests automatisés couvrent le pont et les autorisations déclarées. La
compilation iOS et un test sur appareil réel restent indispensables : accès au
microphone, permissions refusées, interruptions et arrière-plan, erreurs réseau,
arrêt et absence de résultats dupliqués. Aucun accès réel au microphone n'a été
effectué ; la dictée ne doit pas être considérée validée avant ces vérifications.
