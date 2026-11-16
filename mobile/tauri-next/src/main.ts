import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
import { installLegacyTransport } from "./legacy-transport";

installLegacyTransport();
mount(App, { target: document.getElementById("app")! });
