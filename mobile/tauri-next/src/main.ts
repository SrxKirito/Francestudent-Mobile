import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
import { installLegacyTransport } from "./legacy-transport";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { createSpeechAdapter } from "../speech-bridge.mjs";

installLegacyTransport();
async function start() {
  const supported = await invoke<boolean>("speech_supported").catch(() => false);
  if (supported) Object.defineProperty(window, "__franceStudentSpeech", { value: createSpeechAdapter(invoke, addPluginListener), writable: false });
  mount(App, { target: document.getElementById("app")! });
}
void start();
