
<script lang="ts">
  import type { InteractiveWidget } from "../lib/services/interactive-widgets.ts";
  let { data }: { data: Extract<InteractiveWidget, { kind: "map" }> } = $props();
  let selected = $state(0);
  let scale = $state(1);
  const place = $derived(data.places[selected] ?? data.places[0]);
  const world = import("../lib/data/world-land.json").then(module => module.default.path).catch(() => "");
  const x = (lon: number) => lon + 180;
  const y = (lat: number) => 90 - lat;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const box = $derived.by(() => {
    const width = 360 / scale, height = 180 / scale;
    const left = clamp(x(place.lon) - width / 2, 360 - width);
    const top = clamp(y(place.lat) - height / 2, 180 - height);
    return [left, top, width, height].join(" ");
  });
  const route = $derived(data.places.map((point, index) =>
    (!index || Math.abs(point.lon - data.places[index - 1].lon) > 180 ? "M" : "L") + x(point.lon) + " " + y(point.lat)).join(" "));
  const coordinates = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
</script>

<figure class="interactive-map">
  <figcaption><strong>{data.title}</strong></figcaption>
  <svg viewBox={box} role="img" aria-label={data.title}>
    <rect width="360" height="180" class="water" />
    {#await world then land}<path d={land} fill-rule="evenodd" class="land" />{/await}
    {#if data.route}<path d={route} class="route" vector-effect="non-scaling-stroke" />{/if}
    {#each data.places as point, index (index)}
      <circle cx={x(point.lon)} cy={y(point.lat)} r={(index === selected ? 3.5 : 2.1) / scale}
        class:active={index === selected} class="pin" vector-effect="non-scaling-stroke"><title>{point.title}</title></circle>
    {/each}
  </svg>
  <div class="actions">
    <button class="settings-btn" aria-label="Réduire le zoom de la carte" disabled={scale === 1} onclick={() => scale /= 2}>−</button>
    <button class="settings-btn" aria-label="Agrandir la carte" disabled={scale === 64} onclick={() => scale *= 2}>+</button>
  </div>
  <div class="actions places" role="group" aria-label="Lieux sur la carte">
    {#each data.places as point, index (index)}
      <button type="button" class="settings-btn" aria-pressed={selected === index} onclick={() => selected = index}>{point.title}</button>
    {/each}
  </div>
  <p aria-live="polite">{place.text || place.title} · {coordinates.format(place.lat)}, {coordinates.format(place.lon)}</p>
  {#if data.route}<p class="settings-hint">Liaisons entre étapes à vol d’oiseau.</p>{/if}
  <a href={"https://www.openstreetmap.org/?mlat=" + place.lat + "&mlon=" + place.lon + "#map=14/" + place.lat + "/" + place.lon}
    target="_blank" rel="noopener noreferrer">Ouvrir ce lieu dans OpenStreetMap</a>
  <small>Fond de carte Natural Earth</small>
</figure>

<style>
  figure { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  svg { display: block; width: 100%; max-height: 18rem; aspect-ratio: 2; margin-block: .5rem; border-radius: .5rem; }
  .water { fill: #183953; }
  .land { fill: #668e73; }
  .route { fill: none; stroke: #ffe089; stroke-width: 2; }
  .pin { fill: #ffe089; stroke: #15202a; stroke-width: 1.5; }
  .pin.active { fill: #fff; stroke: #ffbe33; stroke-width: 2; }
  .actions { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .4rem; }
  .actions button { min-height: 44px; }
  .places [aria-pressed=true] { border-color: var(--accent); }
  small { display: block; color: var(--muted); }
</style>
