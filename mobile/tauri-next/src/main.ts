import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
import { interfaceState } from "./lib/utils/interface-choice.ts";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { initializeAppSpeech } from "./lib/services/dictation.ts";
import { createSpeechAdapter } from "../speech-bridge.mjs";

async function start() {
  const mode = interfaceState(window.location.search, window.localStorage);
  if (mode.ui === "legacy" || !mode.chat) {
    const { installLegacyTransport } = await import("./legacy-transport");
    installLegacyTransport();
  }
  initializeAppSpeech(invoke<boolean>("speech_supported").then(supported =>
    supported ? createSpeechAdapter(invoke, addPluginListener) : null
  ).catch(() => null));
  mount(App, { target: document.getElementById("app")! });
}
void start();
