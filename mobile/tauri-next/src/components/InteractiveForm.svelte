
<script lang="ts">
  import { calculate, type InteractiveWidget } from "../lib/services/interactive-widgets.ts";
  let { data }: { data: Extract<InteractiveWidget, { kind: "form" | "simulator" }> } = $props();
  const uid = $props.id();
  let values = $state<(string | number | boolean | undefined)[]>([]);
  let submitted = $state(false);
  const format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 });

  $effect(() => {
    values = data.fields.map(field => field.value);
    submitted = false;
  });

  function change(index: number, value: typeof values[number]) {
    values[index] = value;
    submitted = false;
  }
</script>

<section class="interactive-form" aria-label={data.title}>
  <strong>{data.title}</strong>
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
    {/if}
  </form>
  {#if data.results.length}
    <dl aria-live="polite">
      {#each data.results as result, index (index)}
        {@const value = calculate(result.formula, values)}
        <div><dt>{result.label}</dt><dd>{Number.isFinite(value) ? format.format(value) + (result.unit ? " " + result.unit : "") : "Calcul indéfini"}</dd></div>
      {/each}
    </dl>
  {/if}
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
</style>
