# Local changes

Vendored from `tauri-plugin-stt` 0.2.2 (MIT), retaining its original license.
Removed logging of recognized speech text from the iOS and Android sources.
France Student links this plugin only on iOS. The iOS implementation also exposes
`AVSpeechSynthesizer` through the app's read-aloud commands. Speech text stays on
the device, and playback can be cancelled by the frontend or by starting dictation.
Review privacy and platform behavior again when upgrading the plugin.
