<script lang="ts">
  import type { ChartPoint, ChartSeries, InteractiveContent } from "../lib/services/interactive-content.ts";

  let { data }: { data: Extract<InteractiveContent, { kind: "chart" }> } = $props();
  let detailed = $state(false);
  let magnified = $state(false);
  let focusPoint = $state("");
  const palette = ["#6d83ff", "#27b997", "#d97e27", "#c472e6", "#df587d", "#268cca"];
  const width = 420, height = 190, gap = 20;
  const colors = (index: number) => palette[index % palette.length];
  const points = $derived(data.series.flatMap(series => series.points));
  const minY = $derived(Math.min(0, ...points.map(point => point.y)));
  const maxY = $derived(Math.max(0, ...points.map(point => point.y)));
  const minX = $derived(Math.min(...points.map(point => point.x)));
  const maxX = $derived(Math.max(...points.map(point => point.x)));
  const slots = $derived(Math.max(1, maxX - minX + 1));
  const plot = width - 2 * gap;
  const slot = $derived(plot / slots);
  const bar = $derived(slot * .8 / data.series.length);
  const cy = (y: number) => height - gap - (y - minY) / (maxY - minY || 1) * (height - 2 * gap);
  const cx = (x: number) => data.chart === "bar" ? gap + (x - minX) * slot : gap + (x - minX) / (maxX - minX || 1) * plot;
  const value = new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 8 });
  const caption = (series: ChartSeries, point: ChartPoint) => series.name + " · " + point.label + " · " + value.format(point.y);

  function pickPoint(event: MouseEvent) {
    const mark = event.target instanceof Element ? event.target.closest("[data-point]")?.getAttribute("data-point") : null;
    if (mark) focusPoint = mark;
  }

  const pie = $derived.by(() => {
    if (data.chart !== "pie") return [];
    const total = points.reduce((sum, point) => sum + point.y, 0);
    let offset = 0;
    return points.map(point => {
      const part = point.y / total * 100;
      const segment = { point, part, offset };
      offset += part;
      return segment;
    });
  });
</script>

<figure>
  <figcaption>{data.title}</figcaption>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Le zoom rend le graphique défilable au clavier.) -->
  <div class="plot" class:magnified tabindex={magnified ? 0 : undefined} role="region" aria-label={data.title}>
  {#if data.chart === "pie"}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events (Le sélecteur sous le graphique donne accès aux mêmes points au clavier.) -->
    <svg viewBox="0 0 180 180" role="img" aria-label={data.title} onclick={pickPoint}>
      {#each pie as segment, index (index)}
        <circle data-point={"0:" + index} cx="90" cy="90" r="57" pathLength="100" fill="none" stroke={colors(index)} stroke-width="34"
          opacity={!focusPoint || focusPoint === "0:" + index ? 1 : .38}
          stroke-dasharray={segment.part + " " + (100 - segment.part)} stroke-dashoffset={-segment.offset} transform="rotate(-90 90 90)">
          <title>{segment.point.label} · {value.format(segment.point.y)} ({value.format(segment.part)} %)</title>
        </circle>
      {/each}
    </svg>
    <ul class="legend">
      {#each pie as segment, index (index)}
        <li><span style:background={colors(index)}></span>{segment.point.label}</li>
      {/each}
    </ul>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events (Le sélecteur sous le graphique donne accès aux mêmes points au clavier.) -->
    <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={data.title} onclick={pickPoint}>
      <path d={"M" + gap + "," + gap + "V" + (height-gap) + "M" + gap + "," + cy(0) + "H" + (width-gap)}
        fill="none" stroke="currentColor" opacity=".45" />
      {#each data.series as series, seriesIndex (seriesIndex)}
        {#if data.chart === "line"}
          <polyline fill="none" stroke={colors(seriesIndex)} stroke-width="2.5"
            points={series.points.map(point => cx(point.x) + "," + cy(point.y)).join(" ")} />
        {/if}
        {#each series.points as point, index (index)}
          {#if data.chart === "bar"}
            <rect data-point={seriesIndex + ":" + index} x={cx(point.x) + slot * .1 + seriesIndex * bar} y={Math.min(cy(0), cy(point.y))}
              width={bar} height={Math.abs(cy(point.y) - cy(0))} fill={colors(seriesIndex)} stroke={focusPoint === seriesIndex + ":" + index ? "currentColor" : "none"}>
              <title>{caption(series, point)}</title>
            </rect>
          {:else}
            <circle data-point={seriesIndex + ":" + index} cx={cx(point.x)} cy={cy(point.y)} r={focusPoint === seriesIndex + ":" + index ? 8 : 4} fill={colors(seriesIndex)}><title>{caption(series, point)}</title></circle>
          {/if}
        {/each}
      {/each}
    </svg>
    <ul class="legend">
      {#each data.series as series, index (index)}
        <li><span style:background={colors(index)}></span>{series.name}</li>
      {/each}
    </ul>
  {/if}
  </div>
  {#if points.length}
    <label>Point du graphique
      <select class="settings-input" bind:value={focusPoint}>
        <option value="">Choisir un point</option>
        {#each data.series as series, i (i)}
          {#each series.points as point, j (j)}
            <option value={i + ":" + j}>{caption(series, point)}</option>
          {/each}
        {/each}
      </select>
    </label>
  {/if}
  <button type="button" class="settings-btn" aria-pressed={magnified} onclick={() => magnified = !magnified}>Agrandir le graphique</button>
  <button type="button" class="settings-btn" aria-expanded={detailed} onclick={() => detailed = !detailed}>
    {detailed ? "Masquer les données" : "Voir les données"}
  </button>
  {#if detailed}
    <div class="chart-data">
      <table aria-label={data.title}>
        <thead><tr><th scope="col">Série</th><th scope="col">Point</th>{#if data.numericX}<th scope="col">X</th>{/if}<th scope="col">Valeur</th></tr></thead>
        <tbody>
          {#each data.series as series, index (index)}
            {#each series.points as point, pointIndex (pointIndex)}
              <tr><td>{series.name}</td><td>{point.label}</td>{#if data.numericX}<td>{value.format(point.x)}</td>{/if}<td>{value.format(point.y)}</td></tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</figure>

<style>
  figure { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; min-width: 0; }
  figcaption { font-weight: 600; }
  .plot { overflow: auto; }
  [data-point] { cursor: pointer; }
  .plot.magnified svg { width: 175%; max-height: none; }
  svg { display: block; margin-inline: auto; width: 100%; max-height: 16rem; }
  .legend { display: flex; flex-wrap: wrap; gap: .25rem .85rem; padding: 0; list-style: none; }
  .legend span { display: inline-block; width: .65em; height: .65em; border-radius: 50%; margin-inline-end: .35em; }
  .chart-data { overflow: auto; max-height: 15rem; margin-top: .6rem; }
</style>
