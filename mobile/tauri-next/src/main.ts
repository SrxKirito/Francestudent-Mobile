import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
import { interfaceState } from "./lib/utils/interface-choice.ts";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { createSpeechAdapter } from "../speech-bridge.mjs";

async function start() {
  const mode = interfaceState(window.location.search, window.localStorage);
  if (mode.ui === "legacy" || !mode.chat) {
    const { installLegacyTransport } = await import("./legacy-transport");
    installLegacyTransport();
  }
  const supported = await invoke<boolean>("speech_supported").catch(() => false);
  if (supported) Object.defineProperty(window, "__franceStudentSpeech", { value: createSpeechAdapter(invoke, addPluginListener), writable: false });
  mount(App, { target: document.getElementById("app")! });
}
void start();
