<script lang="ts">
  import InteractiveChart from "./InteractiveChart.svelte";
  import InteractiveTable from "./InteractiveTable.svelte";
  import { dashboardCellLabel, dashboardCsv, dashboardRows, dashboardSeries, dashboardValue,
    type InteractiveDashboard } from "../lib/services/interactive-dashboard.ts";
  import type { Cell } from "../lib/services/interactive-widgets.ts";
  import { safeFileName } from "../lib/services/file-preview.ts";
  import { saveBytes } from "../lib/services/file-saver.ts";

  let { data }: { data: InteractiveDashboard } = $props();
  const format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
  let selected = $state.raw(new Map<number, Cell>());
  let search = $state("");
  let activeChart = $state(0);
  let saving = $state(false);
  let saveStatus = $state("");
  const choices = $derived(data.filters.map(column => ({
    column,
    values: [...new Set(data.rows.map(row => row[column]))]
  })));
  const visible = $derived(dashboardRows(data, selected, search));
  const chart = $derived(data.charts[activeChart]);
  const result = $derived(chart ? dashboardSeries(visible, chart) : null);
  const filtered = $derived(selected.size > 0 || Boolean(search.trim()));

  function reset() {
    selected = new Map();
    search = "";
  }

  $effect(() => {
    void data;
    reset();
    activeChart = 0;
    saveStatus = "";
  });

  function choose(column: number, value: Cell | undefined) {
    const next = new Map(selected);
    if (value === undefined) next.delete(column);
    else next.set(column, value);
    selected = next;
  }

  async function download() {
    if (saving || !visible.length) return;
    saving = true;
    saveStatus = "";
    try {
      const bytes = new TextEncoder().encode("\ufeff" + dashboardCsv(data.columns, visible));
      await saveBytes(safeFileName(data.title + ".csv"), bytes);
      saveStatus = "Données filtrées enregistrées.";
    } catch (error) {
      if (!/annul/i.test(error instanceof Error ? error.message : String(error))) {
        saveStatus = "Impossible d’enregistrer les données.";
      }
    } finally {
      saving = false;
    }
  }
</script>

<section class="interactive-dashboard" aria-label={data.title}>
  <h3>{data.title}</h3>
  {#if data.description}<p class="summary">{data.description}</p>{/if}
  <div class="filters">
    {#each choices as { column, values } (column)}
      <label><span>{data.columns[column]}</span>
        <select class="settings-input" value={selected.has(column) ? String(values.indexOf(selected.get(column) as Cell)) : ""}
          onchange={event => choose(column, event.currentTarget.value === "" ? undefined : values[Number(event.currentTarget.value)])}>
          <option value="">Tout afficher</option>
          {#each values as value, index (index)}
            <option value={String(index)}>{dashboardCellLabel(value)}</option>
          {/each}
        </select>
      </label>
    {/each}
    <label><span>Rechercher</span>
      <input type="search" class="settings-input" placeholder="Rechercher dans les données" bind:value={search}>
    </label>
  </div>
  <div class="actions">
    <p class="summary" role="status">{visible.length} sur {data.rows.length} {data.rows.length === 1 ? "ligne" : "lignes"}</p>
    {#if filtered}<button type="button" class="settings-btn" onclick={reset}>Effacer les filtres</button>{/if}
  </div>
  {#if data.metrics.length}
    <dl class="metrics">
      {#each data.metrics as metric, index (index)}
        {@const value = dashboardValue(visible, metric.aggregate)}
        <div><dt>{metric.label}</dt><dd>{value === null ? "—" : format.format(value) + (metric.unit ? " " + metric.unit : "")}</dd></div>
      {/each}
    </dl>
  {/if}
  {#if data.charts.length > 1}
    <label class="chart-choice"><span>Graphique</span>
      <select class="settings-input" bind:value={activeChart}>
        {#each data.charts as view, index (index)}<option value={index}>{view.label}</option>{/each}
      </select>
    </label>
  {/if}
  {#if chart && result?.series.length}
    {#key activeChart}
      <InteractiveChart data={{ kind: "chart", title: chart.label, chart: chart.chart, series: result.series }} />
    {/key}
    {#if result.omitted}<p class="summary">Certaines catégories ne figurent pas sur ce graphique. Le tableau conserve toutes les lignes filtrées.</p>{/if}
  {:else if chart && visible.length}
    <p class="summary">Aucune valeur à tracer pour ces filtres.</p>
  {/if}
  <InteractiveTable title="Données du tableau de bord" columns={data.columns} rows={visible} embedded />
  <button type="button" class="settings-btn" disabled={saving || !visible.length} onclick={() => void download()}>Enregistrer les données en CSV</button>
  {#if saveStatus}<p class="summary" role="status">{saveStatus}</p>{/if}
</section>

<style>
  section { margin-block: .85rem; padding: clamp(.65rem, 3vw, 1.1rem); border: 1px solid var(--border); border-radius: .75rem; min-width: 0; }
  h3 { margin: 0 0 .4rem; overflow-wrap: anywhere; }
  .summary { color: var(--muted); font-size: .88rem; margin: .25rem 0; }
  .filters, .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); gap: .55rem; margin: .75rem 0; }
  label { display: grid; gap: .2rem; font-size: .9rem; min-width: 0; }
  label span, dt, dd { overflow-wrap: anywhere; }
  input, select { font-size: 16px; width: 100%; min-width: 0; min-height: 44px; }
  .actions { display: flex; align-items: center; flex-wrap: wrap; gap: .35rem .65rem; }
  .metrics div { padding: .55rem .7rem; background: var(--surface); border: 1px solid var(--border); border-radius: .55rem; min-width: 0; }
  dt { color: var(--muted); font-size: .86rem; }
  dd { margin: .19rem 0 0; font-weight: 650; font-size: 1.12rem; }
  .chart-choice { margin-block-start: .6rem; }
</style>
