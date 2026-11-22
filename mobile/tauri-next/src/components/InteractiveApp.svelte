<script lang="ts">
  import { onMount } from "svelte";
  import type { AppElement, AppEvent, AppResponse, InteractiveApp } from "../lib/services/interactive-app.ts";

  import type { AppSession } from "../lib/services/interactive-app-session.ts";

  let { data, session }: { data: InteractiveApp; session?: AppSession } = $props();
  const revision = $derived(JSON.stringify(data));
  let view = $state<AppElement[]>([]);
  let failed = $state(false);
  let pending = $state(false);
  let snapshot = "";
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const events: AppEvent[] = [];

  onMount(() => {
    start(session?.read(revision) ?? data.initial);
    return stop;
  });

  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
    events.length = 0;
  }

  function fail() {
    stop();
    pending = false;
    failed = true;
  }

  function reset() {
    session?.forget();
    start(data.initial);
  }

  function start(initial: string) {
    stop();
    view = [];
    snapshot = initial;
    failed = false;
    try {
      worker = new Worker(new URL("../lib/services/interactive-app.worker.ts", import.meta.url), { type: "module" });
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = ({ data: response }: MessageEvent<AppResponse>) => {
        clearTimeout(timer);
        if ("error" in response) return fail();
        snapshot = response.state;
        if (snapshot === data.initial) session?.forget();
        else session?.save(revision, snapshot);
        view = response.view;
        const next = events.shift();
        if (next) run(next);
        else pending = false;
      };
      run(null);
    } catch {
      fail();
    }
  }

  function run(event: AppEvent | null) {
    if (!worker) return;
    pending = true;
    timer = setTimeout(fail, 4_000);
    worker.postMessage({ code: data.code, state: snapshot, event });
  }

  function change(id: string, value: AppEvent["value"]) {
    if (failed) return;
    const event = { id, value };
    if (!pending) run(event);
    else if (events.length < 24) events.push(event);
  }
</script>

<section aria-label={data.title} class="interactive-app">
  <header>
    <strong>{data.title}</strong>
    <button type="button" onclick={reset}>Réinitialiser</button>
  </header>
  {#if failed}
    <p role="status">Cette application interactive n’a pas pu s’exécuter.</p>
  {:else if !view.length}
    <p role="status">Préparation de l’application…</p>
  {:else}
    <div class="app-view">
      {#each view as item, index ("id" in item ? item.kind + ":" + item.id : index)}
        {#if item.kind === "heading"}
          <p class="app-heading">{item.text}</p>
        {:else if item.kind === "text"}
          <p>{item.text}</p>
        {:else if item.kind === "metric"}
          <p class="app-metric"><span>{item.label}</span><strong>{item.value}</strong></p>
        {:else if item.kind === "list"}
          <ul>{#each item.items as entry}<li>{entry}</li>{/each}</ul>
        {:else if item.kind === "button"}
          <button type="button" disabled={item.disabled} onclick={() => change(item.id, null)}>{item.label}</button>
        {:else if item.kind === "text-input"}
          <label>{item.label}<input type="text" value={item.value} maxlength={500} disabled={item.disabled}
            onchange={event => change(item.id, event.currentTarget.value)}></label>
        {:else if item.kind === "checkbox"}
          <label class="app-check"><input type="checkbox" checked={item.value} disabled={item.disabled}
            onchange={event => change(item.id, event.currentTarget.checked)}>{item.label}</label>
        {:else if item.kind === "select"}
          <label>{item.label}
            <select value={item.value} disabled={item.disabled} onchange={event => change(item.id, event.currentTarget.value)}>
              {#each item.choices as choice}<option value={choice}>{choice}</option>{/each}
            </select>
          </label>
        {:else if item.kind === "range"}
          <label>{item.label} <span class="app-value">{item.value}</span>
            <input type="range" min={item.min} max={item.max} step={item.step} value={item.value} disabled={item.disabled}
              onchange={event => change(item.id, event.currentTarget.valueAsNumber)}>
          </label>
        {/if}
      {/each}
    </div>
    {#if session?.followUp}
      <footer><button type="button" disabled={pending} onclick={() => session?.followUp?.({ kind: "app", title: data.title, state: snapshot })}>Joindre les réglages à ma question</button></footer>
    {/if}
  {/if}
</section>

<style>
  .interactive-app { margin: .8rem 0; padding: .85rem; border: 1px solid var(--border); border-radius: .75rem; overflow-wrap: anywhere; }
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .55rem; }
  footer { margin-top: .7rem; }
  p, ul { margin: 0; white-space: pre-wrap; }
  .app-view { display: grid; gap: .7rem; margin-top: .65rem; }
  .app-heading { font-weight: 650; }
  .app-metric { display: grid; gap: .2rem; background: var(--surface); border: 1px solid var(--border); border-radius: .65rem; padding: .6rem; }
  .app-metric strong { font-size: 1.2em; }
  label { display: grid; gap: .35rem; min-width: 0; }
  .app-check { display: flex; align-items: center; gap: .5rem; min-height: 2.7rem; }
  .app-value { font-variant-numeric: tabular-nums; }
  button, select, input[type="text"] { min-height: 2.7rem; padding: .4rem .7rem; border: 1px solid var(--border);
    border-radius: .6rem; color: inherit; background: var(--surface); font: inherit; }
  button { cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  select, input[type="range"] { max-width: 100%; }
  input[type="text"], select { font-size: max(16px, 1em); }
</style>
