<script lang="ts">
  import type { ChartPoint, ChartSeries, InteractiveContent } from "../lib/services/interactive-content.ts";
  import { saveBytes } from "../lib/services/file-saver.ts";
  import { safeFileName } from "../lib/services/file-preview.ts";

  let { data, cursor, onseek }: {
    data: Extract<InteractiveContent, { kind: "chart" }>;
    cursor?: { x: number; points: { series: string; y: number }[] };
    onseek?: (x: number) => void;
  } = $props();
  let detailed = $state(false);
  let magnified = $state(false);
  let focusPoint = $state("");
  let hoverPoint = $state("");
  let svg: SVGSVGElement | undefined = $state();
  let appearanceOpen = $state(false);
  let chosenColors = $state<Record<number, string>>({});
  let saving = $state(false);
  let saveStatus = $state("");
  const palette = ["#6d83ff", "#27b997", "#d97e27", "#c472e6", "#df587d", "#268cca"];
  const width = 420, height = 190, right = 20, top = 14, bottom = 28;
  const left = 47;
  const colors = (index: number) => chosenColors[index] || palette[index % palette.length];
  const points = $derived(data.series.flatMap(series => series.points));
  const minY = $derived(Math.min(0, ...points.map(point => point.y)));
  const maxY = $derived(Math.max(0, ...points.map(point => point.y)));
  const minX = $derived(data.xDomain?.[0] ?? Math.min(...points.map(point => point.x)));
  const maxX = $derived(data.xDomain?.[1] ?? Math.max(...points.map(point => point.x)));
  const slots = $derived(Math.max(1, maxX - minX + 1));
  const plot = width - left - right;
  const slot = $derived(plot / slots);
  const bar = $derived(slot * .8 / data.series.length);
  const cy = (y: number) => minY === maxY ? height - bottom : height - bottom - (y - minY) / (maxY - minY) * (height - top - bottom);
  const cx = (x: number) => data.chart === "bar" ? left + (x - minX) * slot :
    minX === maxX ? left + plot / 2 : left + (x - minX) / (maxX - minX) * plot;
  const value = new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 8 });
  const axisValue = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumSignificantDigits: 3 });
  const axisLabels = (min: number, max: number) => min === max ? [min] : Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
  const yLabels = $derived(axisLabels(minY, maxY));
  const xLabels = $derived(data.numericX ? axisLabels(minX, maxX) : []);
  const activePoint = $derived(hoverPoint || focusPoint);
  const selected = $derived.by(() => {
    if (!activePoint) return null;
    const [seriesIndex, pointIndex] = activePoint.split(":").map(Number);
    const series = data.series[seriesIndex];
    const point = series?.points[pointIndex];
    return point ? { point, series, color: colors(data.chart === "pie" ? pointIndex : seriesIndex) } : null;
  });
  const caption = (series: ChartSeries, point: ChartPoint) => series.name + " · " +
    (data.numericX ? (data.xLabel || "X") + " " + value.format(point.x) : point.label) + " · " + value.format(point.y);

  function curvePath(series: ChartSeries) {
    return series.points.map((point, index) =>
      (index === 0 || point.breakBefore ? "M" : "L") + cx(point.x) + " " + cy(point.y)).join(" ");
  }

  function findPoint(event: MouseEvent): string {
    const mark = event.target instanceof Element ? event.target.closest("[data-point]")?.getAttribute("data-point") : null;
    if (mark) return mark;
    if (data.chart !== "line" && data.chart !== "scatter") return "";
    const position = screenPosition(event);
    if (!position) return "";
    let nearest = "", distance = 18 ** 2;
    for (const [seriesIndex, series] of data.series.entries()) {
      for (const [pointIndex, point] of series.points.entries()) {
        const squared = (cx(point.x) - position.x) ** 2 + (cy(point.y) - position.y) ** 2;
        if (squared < distance) { distance = squared; nearest = seriesIndex + ":" + pointIndex; }
      }
    }
    return nearest;
  }

  function screenPosition(event: MouseEvent): DOMPoint | undefined {
    const transform = svg?.getScreenCTM();
    if (!svg || !transform) return undefined;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(transform.inverse());
  }

  function selectPoint(key: string) {
    focusPoint = key;
    if (!onseek || !key) return;
    const [seriesIndex, pointIndex] = key.split(":").map(Number);
    const point = data.series[seriesIndex]?.points[pointIndex];
    if (point) onseek(point.x);
  }

  function pickPoint(event: MouseEvent) {
    if (onseek) {
      const position = screenPosition(event);
      if (position && position.x >= left && position.x <= width - right && position.y >= top && position.y <= height - bottom) {
        focusPoint = "";
        onseek(minX + (position.x - left) / plot * (maxX - minX));
      }
      return;
    }
    const point = findPoint(event);
    if (point) selectPoint(point);
  }

  function probe(event: PointerEvent) {
    if (event.pointerType === "mouse") hoverPoint = findPoint(event);
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
  const legend = $derived(data.chart === "pie" ? points.map(point => point.label) : data.series.map(series => series.name));

  async function exportPng() {
    if (!svg || saving) return;
    saving = true;
    saveStatus = "";
    const source = svg.cloneNode(true) as SVGSVGElement;
    const { width: sourceWidth, height: sourceHeight } = svg.viewBox.baseVal;
    source.setAttribute("width", String(sourceWidth));
    source.setAttribute("height", String(sourceHeight));
    source.setAttribute("color", "#20222b");
    const filename = safeFileName(data.title.replace(/[.]+$/g, "") + ".png");
    const title = data.title;
    const entries = legend.map((label, index) => ({ label, color: colors(index) }));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      const outputWidth = 600;
      const plotHeight = Math.round((outputWidth - 32) * sourceHeight / sourceWidth);
      const rows = Math.ceil(entries.length / 2);
      const outputHeight = 58 + plotHeight + rows * 23 + 20;
      canvas.width = outputWidth * 2;
      canvas.height = outputHeight * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Graphique indisponible.");
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outputWidth, outputHeight);
      ctx.fillStyle = "#20222b";
      ctx.font = "600 22px system-ui, sans-serif";
      ctx.fillText(title, 20, 34, outputWidth - 40);
      ctx.drawImage(image, 16, 48, outputWidth - 32, plotHeight);
      ctx.font = "14px system-ui, sans-serif";
      for (const [index, entry] of entries.entries()) {
        const x = 22 + index % 2 * 290, y = 62 + plotHeight + Math.floor(index / 2) * 23;
        ctx.fillStyle = entry.color;
        ctx.fillRect(x, y - 10, 10, 10);
        ctx.fillStyle = "#20222b";
        ctx.fillText(entry.label, x + 17, y, 245);
      }
      const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("Image PNG indisponible.");
      await saveBytes(filename, new Uint8Array(await png.arrayBuffer()));
      saveStatus = "Graphique PNG enregistré.";
    } catch (error) {
      if (!(error instanceof Error && /annul/i.test(error.message))) saveStatus = "Impossible d’enregistrer le graphique.";
    } finally {
      URL.revokeObjectURL(url);
      saving = false;
    }
  }
</script>

<figure>
  <figcaption>{data.title}</figcaption>
  {#if data.xLabel && data.yLabel}<p class="axes-label">{data.yLabel} en fonction de {data.xLabel}</p>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Le zoom rend le graphique défilable au clavier.) -->
  <div class="plot" class:magnified tabindex={magnified ? 0 : undefined} role="region" aria-label={data.title}>
  {#if data.chart === "pie"}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events (Le sélecteur sous le graphique donne accès aux mêmes points au clavier.) -->
    <svg viewBox="0 0 180 180" role="img" aria-label={data.title} bind:this={svg} onclick={pickPoint}
      onpointermove={probe} onpointerleave={() => hoverPoint = ""}>
      {#each pie as segment, index (index)}
        <circle data-point={"0:" + index} cx="90" cy="90" r="57" pathLength="100" fill="none" stroke={colors(index)} stroke-width="34"
          opacity={!activePoint || activePoint === "0:" + index ? 1 : .38}
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
    <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={data.title} bind:this={svg} onclick={pickPoint}
      onpointermove={probe} onpointerleave={() => hoverPoint = ""}>
      {#each yLabels as tick, i (i)}
        <path d={"M" + left + " " + cy(tick) + "H" + (width - right)} fill="none" stroke="currentColor" opacity=".18" />
        <text x={left - 6} y={cy(tick)} dominant-baseline="middle" text-anchor="end" fill="currentColor" font-size="10">{axisValue.format(tick)}</text>
      {/each}
      {#each xLabels as tick, i (i)}
        <text x={cx(tick)} y={height - bottom + 15} text-anchor="middle" fill="currentColor" font-size="10">{axisValue.format(tick)}</text>
      {/each}
      <path d={"M" + left + "," + top + "V" + (height-bottom) + "M" + left + "," + cy(0) + "H" + (width-right)}
        fill="none" stroke="currentColor" opacity=".45" />
      {#if selected && data.chart !== "bar"}
        <path d={"M" + cx(selected.point.x) + " " + top + "V" + (height - bottom)} fill="none"
          stroke={selected.color} opacity=".6" stroke-dasharray="4 3" pointer-events="none" />
      {/if}
      {#each data.series as series, seriesIndex (seriesIndex)}
        {#if data.chart === "line"}
          <path fill="none" stroke={colors(seriesIndex)} stroke-width="2.5" d={curvePath(series)} />
        {/if}
        {#each series.points as point, index (index)}
          {#if data.chart === "bar"}
            <rect data-point={seriesIndex + ":" + index} x={cx(point.x) + slot * .1 + seriesIndex * bar} y={Math.min(cy(0), cy(point.y))}
              width={bar} height={Math.abs(cy(point.y) - cy(0))} fill={colors(seriesIndex)} stroke={activePoint === seriesIndex + ":" + index ? "currentColor" : "none"}>
              <title>{caption(series, point)}</title>
            </rect>
          {:else}
            <circle data-point={seriesIndex + ":" + index} cx={cx(point.x)} cy={cy(point.y)} r={activePoint === seriesIndex + ":" + index ? 7 : data.xDomain ? 2 : 4} fill={colors(seriesIndex)}><title>{caption(series, point)}</title></circle>
          {/if}
        {/each}
      {/each}
      {#if cursor}
        <path d={"M" + cx(cursor.x) + " " + top + "V" + (height - bottom)} fill="none" stroke="currentColor"
          stroke-dasharray="3 3" stroke-width="1.4" opacity=".75" pointer-events="none" />
        {#each cursor.points as point, index (index)}
          {@const seriesIndex = data.series.findIndex(series => series.name === point.series)}
          {#if seriesIndex >= 0 && point.y >= minY && point.y <= maxY}
            <circle cx={cx(cursor.x)} cy={cy(point.y)} r="5" fill={colors(seriesIndex)}
              stroke="currentColor" stroke-width="1.5" pointer-events="none" />
          {/if}
        {/each}
      {/if}
    </svg>
    <ul class="legend">
      {#each data.series as series, index (index)}
        <li><span style:background={colors(index)}></span>{series.name}</li>
      {/each}
    </ul>
  {/if}
  </div>
  {#if cursor}
    <p class="point-detail">{data.xLabel || "X"} {value.format(cursor.x)}{#each cursor.points as point, index (index)}{" · "}{point.series} {value.format(point.y)}{/each}</p>
  {/if}
  {#if selected}<p class="point-detail">{caption(selected.series, selected.point)}</p>{/if}
  {#if points.length}
    <label>Point du graphique
      <select class="settings-input" value={focusPoint} onchange={event => selectPoint(event.currentTarget.value)}>
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
  <button type="button" class="settings-btn" aria-expanded={appearanceOpen} onclick={() => appearanceOpen = !appearanceOpen}>
    Couleurs
  </button>
  <button type="button" class="settings-btn" disabled={saving} onclick={() => void exportPng()}>Enregistrer en PNG</button>
  {#if saveStatus}<p class="settings-hint" role="status">{saveStatus}</p>{/if}
  {#if appearanceOpen}
    <div class="palette">
      {#each legend as label, index (index)}
        <label><input type="color" aria-label={"Couleur de " + label} value={colors(index)}
          oninput={event => { chosenColors[index] = event.currentTarget.value; }}> <span>{label}</span></label>
      {/each}
      <button type="button" class="settings-btn" onclick={() => chosenColors = {}}>Couleurs par défaut</button>
    </div>
  {/if}
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
  .axes-label { color: var(--muted); font-size: .85rem; margin: .3rem 0 0; }
  .point-detail { font-size: .9rem; margin: .25rem 0 .5rem; }
  .plot { overflow: auto; }
  [data-point] { cursor: pointer; }
  .plot.magnified svg { width: 175%; max-height: none; }
  svg { display: block; margin-inline: auto; width: 100%; max-height: 16rem; }
  .legend { display: flex; flex-wrap: wrap; gap: .25rem .85rem; padding: 0; list-style: none; }
  .legend span { display: inline-block; width: .65em; height: .65em; border-radius: 50%; margin-inline-end: .35em; }
  .chart-data { overflow: auto; max-height: 15rem; margin-top: .6rem; }
  .palette { display: grid; gap: .4rem; margin-top: .6rem; justify-items: start; }
  .palette label { display: flex; align-items: center; gap: .55rem; min-height: 44px; }
  .palette input { width: 44px; height: 38px; }
</style>
