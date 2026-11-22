
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { advanceSimulationPlayback, calculate, sampleSimulationPlot, simulationPlotProbe, snapSimulationField,
    type InteractiveWidget } from "../lib/services/interactive-widgets.ts";
  import type { AppSession, SimulatorFollowUp } from "../lib/services/interactive-app-session.ts";
  import { validInteractiveFollowUp } from "../lib/services/interactive-prompts.ts";
  import { renderMarkdownText } from "../lib/services/markdown.ts";
  import InteractiveChart from "./InteractiveChart.svelte";
  import SimulationDrawing from "./SimulationDrawing.svelte";
  import SimulationScene from "./SimulationScene.svelte";
  let { data, session }: {
    data: Extract<InteractiveWidget, { kind: "form" | "simulator" }>;
    session?: AppSession;
  } = $props();
  const uid = $props.id();
  const revision = $derived(JSON.stringify(data));
  let values = $state<(string | number | boolean | undefined)[]>([]);
  let submitted = $state(false);
  let settingsError = $state(false);
  let playing = $state(false);
  let loop = $state(false);
  let speed = $state(1);
  let frame = 0;
  let previousTime: number | undefined;
  let progress = 0;
  const format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 });
  const curves = $derived(data.plot ? sampleSimulationPlot(data.plot, values) : []);
  const cursor = $derived(data.plot ? simulationPlotProbe(data.plot, values) : undefined);

  function reset() {
    pause();
    session?.forget();
    values = data.fields.map(field => field.value);
    submitted = false;
    settingsError = false;
  }

  $effect(() => {
    const source = revision;
    const defaults = data.fields.map(field => field.value);
    const saved = untrack(() => session?.read(source));
    pause();
    values = saved ? (JSON.parse(saved) as (string | number | boolean | null)[]).map(value => value ?? undefined) : defaults;
    submitted = false;
    settingsError = false;
  });

  function saveSettings() {
    if (data.kind === "simulator") session?.save(revision, JSON.stringify(values));
  }

  onMount(() => {
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      pause();
    };
  });

  function change(index: number, value: typeof values[number]) {
    if (data.playback?.field === index) pause();
    values[index] = value;
    saveSettings();
    submitted = false;
    settingsError = false;
  }

  function shareSettings() {
    pause();
    const context: SimulatorFollowUp = {
      kind: "simulator", title: data.title,
      fields: data.fields.map(({ id, label }, index) => {
        const value = values[index];
        return { id, label, value: value === undefined || (typeof value === "number" && !Number.isFinite(value)) ? null : value };
      })
    };
    settingsError = !validInteractiveFollowUp(context);
    if (!settingsError) session?.followUp?.(context);
  }

  function seek(x: number) {
    const index = data.plot?.cursorField;
    if (index === undefined) return;
    change(index, snapSimulationField(data.fields[index], x));
  }

  function pause() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previousTime = undefined;
    playing = false;
  }

  function tick(time: number) {
    frame = 0;
    const playback = data.playback;
    if (!playing || !playback || document.hidden) { pause(); return; }
    if (previousTime === undefined) previousTime = time;
    const elapsed = time - previousTime;
    if (elapsed >= 1000 / 30) {
      previousTime = time;
      const field = data.fields[playback.field];
      const position = advanceSimulationPlayback(progress, Math.min(elapsed, 250) * speed, playback.durationMs, loop);
      progress = position.progress;
      const next = snapSimulationField(field, field.min + progress * (field.max - field.min));
      if (values[playback.field] !== next) {
        values[playback.field] = next;
        saveSettings();
      }
      if (position.ended) { pause(); return; }
    }
    frame = requestAnimationFrame(tick);
  }

  function togglePlayback() {
    if (playing) { pause(); return; }
    const playback = data.playback;
    if (!playback || document.hidden) return;
    const field = data.fields[playback.field];
    const end = snapSimulationField(field, field.max);
    const stored = values[playback.field];
    const value = typeof stored === "number" && Number.isFinite(stored) ? stored : field.min;
    progress = value >= end ? 0 : (Math.max(field.min, value) - field.min) / (field.max - field.min);
    if (progress === 0) {
      values[playback.field] = field.min;
      saveSettings();
    }
    playing = true;
    frame = requestAnimationFrame(tick);
  }
</script>

<section class="interactive-form" aria-label={data.title}>
  <strong>{data.title}</strong>
  {#if data.explanation}<p class="explanation">{data.explanation}</p>{/if}
  {#if data.equation}<div class="equation">{@html renderMarkdownText(data.equation)}</div>{/if}
  {#if data.fields.length}
  <form onsubmit={event => { event.preventDefault(); submitted = data.kind === "form"; }}>
    {#each data.fields as field, index (field.id)}
      {@const id = uid + "-" + field.id}
      {#if field.type === "radio"}
        <fieldset>
          <legend>{field.label}</legend>
          {#each field.choices as choice (choice)}
            <label class="choice"><input type="radio" name={id} value={choice} required={field.required} checked={values[index] === choice} onchange={() => change(index, choice)}> {choice}</label>
          {/each}
        </fieldset>
      {:else if field.type === "checkbox"}
        <label class="choice"><input type="checkbox" required={field.required} checked={values[index] === true}
          onchange={event => change(index, event.currentTarget.checked)}> {field.label}</label>
      {:else}
        <label for={id}>{field.label}{#if field.type === "range"} <output>{values[index]}</output>{/if}</label>
        {#if field.type === "select"}
          <select {id} class="settings-input" value={values[index]} required={field.required} onchange={event => change(index, event.currentTarget.value)}>
            {#each field.choices as choice (choice)}<option value={choice}>{choice}</option>{/each}
          </select>
        {:else if field.type === "textarea"}
          <textarea {id} class="settings-input" maxlength="2000" required={field.required} value={String(values[index] ?? "")} oninput={event => change(index, event.currentTarget.value)}></textarea>
        {:else if field.type === "range" || field.type === "number"}
          <input {id} class="settings-input" type={field.type} min={field.min} max={field.max} step={field.step}
            value={values[index]} required={field.required} oninput={event => change(index, event.currentTarget.valueAsNumber)}>
        {:else}
          <input {id} class="settings-input" type={field.type} maxlength="2000" value={values[index]} required={field.required}
            oninput={event => change(index, event.currentTarget.value)}>
        {/if}
      {/if}
    {/each}
    {#if data.kind === "form"}
      <button type="submit" class="settings-btn">Valider localement</button>
      {#if submitted}<p role="status">Formulaire validé sur cet appareil.</p>{/if}
    {:else}
      <div class="simulation-controls">
        {#if data.playback}
          <button type="button" class="settings-btn" onclick={togglePlayback}>{playing ? "Mettre en pause" : "Lancer la lecture"}</button>
          <label class="speed">Vitesse
            <select class="settings-input" bind:value={speed}>
              <option value={0.5}>0,5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </label>
          <label class="choice"><input type="checkbox" bind:checked={loop}> En boucle</label>
        {/if}
        <button type="button" class="settings-btn" onclick={reset}>Réinitialiser</button>
        {#if session?.followUp}
          <button type="button" class="settings-btn" onclick={shareSettings}>Joindre les réglages à ma question</button>
          {#if settingsError}<p role="status">Ces réglages dépassent la taille autorisée.</p>{/if}
        {/if}
      </div>
    {/if}
  </form>
  {/if}
  {#if data.results.length}
    <dl aria-live={playing ? "off" : "polite"}>
      {#each data.results as result, index (index)}
        {@const value = calculate(result.formula, values)}
        <div><dt>{result.label}</dt><dd>{Number.isFinite(value) ? format.format(value) + (result.unit ? " " + result.unit : "") : "Calcul indéfini"}</dd></div>
      {/each}
    </dl>
  {/if}
  {#if data.plot}
    {#if curves.length}
      <InteractiveChart {cursor} onseek={data.plot.cursorField === undefined ? undefined : seek}
        data={{ kind: "chart", chart: "line", title: data.plot.title, numericX: true,
        xLabel: data.plot.xLabel, yLabel: data.plot.yLabel, xDomain: [data.plot.min, data.plot.max], series: curves }} />
    {:else}
      <p class="settings-hint">Aucune valeur définie sur cet intervalle.</p>
    {/if}
  {/if}
  {#if data.drawing}<SimulationDrawing drawing={data.drawing} fields={data.fields} {values} onchange={change} />{/if}
  {#if data.scene}<SimulationScene scene={data.scene} {values} />{/if}
</section>

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; min-width: 0; }
  form { display: grid; gap: .45rem; margin-top: .6rem; }
  fieldset { min-width: 0; margin: 0; padding: .35rem; border: 1px solid var(--border); border-radius: .6rem; }
  .choice { display: flex; align-items: center; gap: .5rem; min-height: 44px; }
  input, textarea, select { min-width: 0; max-width: 100%; }
  input:not([type=radio]):not([type=checkbox]), textarea, select { font-size: 16px; }
  output { color: var(--muted); margin-inline-start: .4rem; }
  dl { margin-bottom: 0; }
  dl div { display: flex; justify-content: space-between; gap: .5rem; padding-block: .35rem; border-top: 1px solid var(--border); }
  dd { margin: 0; font-weight: 600; }
  .explanation, .equation { margin-block: .45rem; }
  .equation { overflow-x: auto; }
  .simulation-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .65rem; }
  .simulation-controls button, .speed select { min-height: 44px; }
  .speed { display: flex; align-items: center; gap: .35rem; }
</style>
