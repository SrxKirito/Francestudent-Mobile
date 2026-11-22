
<script lang="ts">
  import InteractiveChart from "./InteractiveChart.svelte";
  import type { InteractiveContent } from "../lib/services/interactive-content.ts";
  import type { TableFollowUp } from "../lib/services/interactive-app-session.ts";
  import { validInteractiveFollowUp } from "../lib/services/interactive-prompts.ts";
  import type { Cell } from "../lib/services/interactive-widgets.ts";
  let { title, columns, rows, embedded = false, onAnalyze }: {
    title: string; columns: string[]; rows: Cell[][]; embedded?: boolean; onAnalyze?: (selection: TableFollowUp) => void;
  } = $props();
  let selected = $state.raw(new Set<Cell[]>());
  const positions = $derived(new Map(rows.map((row, index) => [row, index + 1])));
  const selection = $derived.by((): TableFollowUp => ({
    kind: "table", title: title.slice(0, 120), columns,
    rows: selected.size ? rows.filter(row => selected.has(row)) : []
  }));
  const canAnalyze = $derived(Boolean(onAnalyze) && validInteractiveFollowUp(selection));

  function toggleRow(row: Cell[], checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(row);
    else next.delete(row);
    selected = next;
  }
  let query = $state("");
  let plotted = $state(-1);
  let sorting = $state<{ column: number; descending: boolean } | null>(null);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  function numeric(value: Cell) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^[+-]?\d+(?:[.,]\d+)?$/.test(value.trim())) return Number(value.trim().replace(",", "."));
    return NaN;
  }
  const format = (cell: Cell) => cell === null ? "" : typeof cell === "boolean" ? cell ? "Oui" : "Non" : String(cell);
  const visible = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase();
    const matching = rows.filter(row => !term || row.some(cell => format(cell).toLocaleLowerCase().includes(term)));
    const order = sorting;
    if (!order) return matching;
    return matching.sort((a, b) => {
      const left = a[order.column], right = b[order.column];
      const aNumber = numeric(left), bNumber = numeric(right);
      const result = Number.isFinite(aNumber) && Number.isFinite(bNumber) ? aNumber - bNumber : collator.compare(format(left), format(right));
      return order.descending ? -result : result;
    });
  });
  const metrics = $derived(columns.map((name, index) => ({ name, index })).filter(({ index }) =>
    rows.some(row => Number.isFinite(numeric(row[index])))));
  const chart = $derived.by((): Extract<InteractiveContent, { kind: "chart" }> | null => {
    if (plotted < 0) return null;
    const points = visible.slice(0, 60).flatMap((row, index) => {
      const y = numeric(row[plotted]);
      const label = plotted === 0 ? String(index + 1) : format(row[0]).slice(0, 80) || String(index + 1);
      return Number.isFinite(y) ? [{ x: index, y, label }] : [];
    });
    return points.length ? { kind: "chart", chart: "bar", title: columns[plotted], series: [{ name: columns[plotted], points }] } : null;
  });
  function sort(column: number) {
    sorting = { column, descending: sorting?.column === column && !sorting.descending };
  }
</script>

<section class="interactive-table" aria-label={title}>
  <strong>{title}</strong>
  {#if !embedded}<input class="settings-input" type="search" aria-label="Filtrer le tableau" placeholder="Filtrer le tableau" bind:value={query}>{/if}
  {#if onAnalyze}
    <div class="selection-actions">
      <button type="button" class="settings-btn" disabled={!canAnalyze} onclick={() => onAnalyze?.(selection)}>Joindre les lignes sélectionnées</button>
      {#if selection.rows.length}
        <span role="status">{selection.rows.length} sur 30 maximum</span>
        <button type="button" class="settings-btn" onclick={() => { selected = new Set(); }}>Effacer la sélection</button>
        {#if !canAnalyze}<p role="status">La sélection dépasse la taille autorisée. Sélectionne moins de lignes.</p>{/if}
      {/if}
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Le clavier doit pouvoir faire défiler les colonnes.) -->
  <div class="table-scroll" role="region" aria-label="Données du tableau" tabindex="0">
    <table>
      <thead><tr>
        {#if onAnalyze}<th scope="col">Sélection</th>{/if}
        {#each columns as column, index (index)}
          <th scope="col" aria-sort={sorting?.column === index ? sorting.descending ? "descending" : "ascending" : "none"}>
            <button type="button" class="settings-btn" onclick={() => sort(index)}>{column}</button>
          </th>
        {/each}
      </tr></thead>
      <tbody>
        {#each visible as row (row)}
          <tr>
            {#if onAnalyze}
              <td class="row-select"><label>
                <input type="checkbox" aria-label={"Sélectionner la ligne " + positions.get(row)} checked={selected.has(row)}
                  disabled={!selected.has(row) && selection.rows.length >= 30} onchange={event => toggleRow(row, event.currentTarget.checked)}>
              </label></td>
            {/if}
            {#each row as cell, column (column)}<td>{format(cell)}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !visible.length}<p role="status">Aucun résultat.</p>{/if}
  {#if !embedded && metrics.length}
    <label>Visualiser une colonne
      <select class="settings-input" bind:value={plotted}>
        <option value={-1}>Choisir une colonne numérique</option>
        {#each metrics as column (column.index)}<option value={column.index}>{column.name}</option>{/each}
      </select>
    </label>
  {/if}
  {#if chart}<InteractiveChart data={chart} />{/if}
</section>

<style>
  section { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; min-width: 0; }
  .selection-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .selection-actions button, .row-select label { min-height: 44px; }
  .row-select label { display: grid; place-items: center; cursor: pointer; }
  .row-select input { margin: 0; }
  input[type="search"] { display: block; width: 100%; margin: .5rem 0; }
  .table-scroll { overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .35rem .5rem; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; text-align: left; }
  th button { min-height: 44px; }
  th[aria-sort=ascending] button::after { content: " ↑"; }
  th[aria-sort=descending] button::after { content: " ↓"; }
</style>
