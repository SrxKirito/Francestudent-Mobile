<script lang="ts">
  import type { InteractiveWidget } from "../lib/services/interactive-widgets.ts";
  let { data }: { data: Extract<InteractiveWidget, { kind: "map" }> } = $props();

  type Point = { x: number; y: number };
  type Camera = Point & { scale: number };
  const hint = $props.id();
  const maxZoom = 128;
  const pointers = new Map<number, Point>();
  const world = import("../lib/data/world-land.json").then(module => module.default.path).catch(() => "");
  const coordinates = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
  let surface: SVGSVGElement | undefined = $state();
  let selected = $state(0);
  let camera = $state.raw<Camera>({ x: 180, y: 90, scale: 1 });
  let dragging = $state(false);
  let start: Point | undefined;
  let hit: number | undefined;
  let moved = false;

  const x = (lon: number) => lon + 180;
  const y = (lat: number) => 90 - lat;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const place = $derived(data.places[selected] ?? data.places[0]);
  const width = $derived(360 / camera.scale);
  const height = $derived(180 / camera.scale);
  const box = $derived([camera.x - width / 2, camera.y - height / 2, width, height].join(" "));
  const route = $derived(data.places.map((point, index) =>
    (!index || Math.abs(point.lon - data.places[index - 1].lon) > 180 ? "M" : "L") + x(point.lon) + " " + y(point.lat)).join(" "));

  function setCamera(cx: number, cy: number, zoom: number) {
    const scale = clamp(zoom, 1, maxZoom);
    const halfWidth = 180 / scale, halfHeight = 90 / scale;
    camera = { x: clamp(cx, halfWidth, 360 - halfWidth), y: clamp(cy, halfHeight, 180 - halfHeight), scale };
  }

  function fit(places: typeof data.places) {
    const longs = places.map(point => x(point.lon));
    const lats = places.map(point => y(point.lat));
    const west = Math.min(...longs), east = Math.max(...longs);
    const north = Math.min(...lats), south = Math.max(...lats);
    const fitZoom = Math.min(360 / Math.max(3, (east - west) * 1.55), 180 / Math.max(2, (south - north) * 1.55), 64);
    setCamera((west + east) / 2, (north + south) / 2, fitZoom);
  }

  $effect(() => { fit(data.places); selected = 0; });

  function select(index: number, center = false) {
    const point = data.places[index];
    if (!point) return;
    selected = index;
    if (center) setCamera(x(point.lon), y(point.lat), camera.scale);
  }

  function position(event: PointerEvent): Point {
    return { x: event.clientX, y: event.clientY };
  }

  function startGesture(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return;
    const point = position(event);
    if (pointers.size === 0) {
      start = point;
      moved = false;
      const marker = event.target instanceof Element ? event.target.closest("[data-place]") : null;
      hit = marker ? Number(marker.getAttribute("data-place")) : undefined;
    } else {
      moved = true;
    }
    pointers.set(event.pointerId, point);
    surface?.setPointerCapture(event.pointerId);
  }

  function moveGesture(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    const bounds = surface?.getBoundingClientRect();
    if (!previous || !bounds?.width || !bounds.height) return;
    const current = position(event);
    pointers.set(event.pointerId, current);
    if (!moved && start && Math.hypot(current.x - start.x, current.y - start.y) < 5) return;
    moved = true;
    dragging = true;

    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) {
      setCamera(camera.x - (current.x - previous.x) / bounds.width * width,
        camera.y - (current.y - previous.y) / bounds.height * height, camera.scale);
      return;
    }
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    const after = Math.hypot(current.x - other.x, current.y - other.y);
    if (before < 8 || after < 8) return;
    const scale = clamp(camera.scale * after / before, 1, maxZoom);
    const cameraX = camera.x + ((previous.x + other.x) / 2 - bounds.left) / bounds.width * width - width / 2;
    const cameraY = camera.y + ((previous.y + other.y) / 2 - bounds.top) / bounds.height * height - height / 2;
    setCamera(cameraX - (((current.x + other.x) / 2 - bounds.left) / bounds.width - .5) * (360 / scale),
      cameraY - (((current.y + other.y) / 2 - bounds.top) / bounds.height - .5) * (180 / scale), scale);
  }

  function finishGesture(event: PointerEvent) {
    if (!pointers.delete(event.pointerId) || pointers.size) return;
    dragging = false;
    if (event.type === "pointerup" && !moved && hit !== undefined) select(hit);
    start = undefined;
    hit = undefined;
  }

  function keyboard(event: KeyboardEvent) {
    const actions: Record<string, [number, number, number]> = {
      ArrowLeft: [-width * .12, 0, 1], ArrowRight: [width * .12, 0, 1],
      ArrowUp: [0, -height * .12, 1], ArrowDown: [0, height * .12, 1],
      "+": [0, 0, 2], "=": [0, 0, 2], "-": [0, 0, .5]
    };
    const action = actions[event.key];
    if (!Array.isArray(action)) return;
    event.preventDefault();
    setCamera(camera.x + action[0], camera.y + action[1], camera.scale * action[2]);
  }
</script>

<figure class="interactive-map">
  <figcaption><strong>{data.title}</strong></figcaption>
  <p id={hint} class="settings-hint">Pince pour zoomer, glisse pour déplacer la carte et touche un repère.</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (La surface de la carte se déplace aussi aux flèches du clavier.) -->
  <svg class="map-surface" class:dragging viewBox={box} role="img" aria-label={data.title} aria-describedby={hint} tabindex="0" bind:this={surface}
    onpointerdown={startGesture} onpointermove={moveGesture} onpointerup={finishGesture}
    onpointercancel={finishGesture} onlostpointercapture={finishGesture} onkeydown={keyboard}>
    <rect width="360" height="180" class="water" />
    {#await world then land}<path d={land} fill-rule="evenodd" class="land" />{/await}
    {#if data.route}<path d={route} class="route" vector-effect="non-scaling-stroke" />{/if}
    {#each data.places as point, index (index)}
      <circle cx={x(point.lon)} cy={y(point.lat)} r={10 / camera.scale} fill="transparent" data-place={index} />
      <circle cx={x(point.lon)} cy={y(point.lat)} r={(index === selected ? 3.5 : 2.5) / camera.scale}
        class:active={index === selected} class="pin" vector-effect="non-scaling-stroke"><title>{point.title}</title></circle>
    {/each}
  </svg>
  <div class="actions">
    <button type="button" class="settings-btn" aria-label="Réduire le zoom de la carte" disabled={camera.scale <= 1} onclick={() => setCamera(camera.x, camera.y, camera.scale / 2)}>−</button>
    <button type="button" class="settings-btn" aria-label="Agrandir la carte" disabled={camera.scale >= maxZoom} onclick={() => setCamera(camera.x, camera.y, camera.scale * 2)}>+</button>
    <button type="button" class="settings-btn" onclick={() => fit(data.places)}>Recentrer</button>
  </div>
  <div class="actions places" role="group" aria-label="Lieux sur la carte">
    {#each data.places as point, index (index)}
      <button type="button" class="settings-btn" aria-pressed={selected === index} onclick={() => select(index, true)}>{point.title}</button>
    {/each}
  </div>
  <p aria-live="polite">{place.text || place.title} Â· {coordinates.format(place.lat)}, {coordinates.format(place.lon)}</p>
  {#if data.route}<p class="settings-hint">Liaisons entre étapes à vol d’oiseau.</p>{/if}
  <a href={"https://www.openstreetmap.org/?mlat=" + place.lat + "&mlon=" + place.lon + "#map=14/" + place.lat + "/" + place.lon}
    target="_blank" rel="noopener noreferrer">Ouvrir ce lieu dans OpenStreetMap</a>
  <small>Fond de carte Natural Earth</small>
</figure>

<style>
  figure { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  .map-surface { display: block; width: min(100%, 36rem); aspect-ratio: 2; margin: .5rem auto; border-radius: .5rem; touch-action: none; cursor: grab; user-select: none; }
  .map-surface.dragging { cursor: grabbing; }
  .map-surface:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .water { fill: #183953; }
  .land { fill: #668e73; }
  .route { fill: none; stroke: #ffe089; stroke-width: 2; pointer-events: none; }
  .pin { fill: #ffe089; stroke: #15202a; stroke-width: 1.5; pointer-events: none; }
  .pin.active { fill: #fff; stroke: #ffbe33; stroke-width: 2; }
  [data-place] { cursor: pointer; }
  .actions { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .4rem; }
  .actions button { min-height: 44px; }
  .places [aria-pressed=true] { border-color: var(--accent); }
  small { display: block; color: var(--muted); }
</style>
