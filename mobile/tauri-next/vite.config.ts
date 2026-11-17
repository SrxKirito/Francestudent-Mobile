import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // Two entries: the normal app and the import-only page opened by the native
  // side when a data import was requested.
  build: { rollupOptions: { input: { main: page("index.html"), migration: page("migration.html") } } },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } }
});
