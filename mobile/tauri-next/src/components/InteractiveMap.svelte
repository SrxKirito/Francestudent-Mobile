<script lang="ts">
  import RenderOptions from "./RenderOptions.svelte";
  import { tick, untrack } from "svelte";
  import { groupMapMarkers, mapSpan } from "../lib/services/interactive-map.ts";
  import type { InteractiveWidget } from "../lib/services/interactive-widgets.ts";
  let { data }: { data: Extract<InteractiveWidget, { kind: "map" }> } = $props();

  type Point = { x: number; y: number };
  type Camera = Point & { scale: number };
  const hint = $props.id();
  const maxZoom = 2048;
  const pointers = new Map<number, Point>();
  const world = import("../lib/data/world-land.json").then(module => module.default.path).catch(() => "");
  const coordinates = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
  let surface: SVGSVGElement | undefined = $state();
  let dialog = $state<HTMLDialogElement>();
  let openButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();
  let expanded = $state(false);
  let pixelWidth = $state(360);
  let aspect = $state(2);
  let selected = $state(0);
  let cluster = $state<number[]>([]);
  let camera = $state.raw<Camera>({ x: 180, y: 90, scale: 1 });
  let dragging = $state(false);
  let start: Point | undefined;
  let hit: number[] | undefined;
  let moved = false;

  const x = (lon: number) => lon + 180;
  const y = (lat: number) => 90 - lat;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const place = $derived(data.places[selected] ?? data.places[0]);
  const span = $derived(mapSpan(camera.scale, aspect));
  const width = $derived(span.width);
  const height = $derived(span.height);
  const unitsPerPixel = $derived(width / pixelWidth);
  const markers = $derived(groupMapMarkers(data.places.map(place => ({ x: x(place.lon), y: y(place.lat) })), unitsPerPixel));
  const box = $derived([camera.x - width / 2, camera.y - height / 2, width, height].join(" "));
  const route = $derived(data.places.map((point, index) =>
    (!index || Math.abs(point.lon - data.places[index - 1].lon) > 180 ? "M" : "L") + x(point.lon) + " " + y(point.lat)).join(" "));

  function setCamera(cx: number, cy: number, zoom: number) {
    const scale = clamp(zoom, 1, maxZoom);
    const span = mapSpan(scale, aspect);
    const axis = (value: number, visible: number, whole: number) =>
      visible >= whole ? whole / 2 : clamp(value, visible / 2, whole - visible / 2);
    camera = { x: axis(cx, span.width, 360), y: axis(cy, span.height, 180), scale };
  }

  function fit(places: typeof data.places) {
    const longs = places.map(point => x(point.lon));
    const lats = places.map(point => y(point.lat));
    const west = Math.min(...longs), east = Math.max(...longs);
    const north = Math.min(...lats), south = Math.max(...lats);
    const fitZoom = places.length === 1 ? 64 :
      Math.min(mapSpan(1, aspect).width / Math.max(.24, (east - west) * 1.55),
        mapSpan(1, aspect).height / Math.max(.12, (south - north) * 1.55), 1024);
    setCamera((west + east) / 2, (north + south) / 2, fitZoom);
  }

  $effect(() => {
    const places = data.places;
    untrack(() => fit(places));
    cluster = [];
    selected = 0;
  });

  $effect(() => {
    const element = surface;
    if (!element) return;
    function measure() {
      const bounds = element?.getBoundingClientRect();
      if (!bounds || !bounds.width || !bounds.height) return;
      pixelWidth = bounds.width;
      aspect = bounds.width / bounds.height;
      setCamera(camera.x, camera.y, camera.scale);
    }
    untrack(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  async function expand() {
    if (!dialog || dialog.open) return;
    pointers.clear();
    dragging = false;
    dialog.showModal();
    expanded = true;
    await tick();
    closeButton?.focus();
  }

  async function finishExpansion() {
    pointers.clear();
    dragging = false;
    expanded = false;
    await tick();
    openButton?.focus({ preventScroll: true });
  }

  function select(index: number, center = false) {
    const point = data.places[index];
    if (!point) return;
    selected = index;
    cluster = [];
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
      const marker = event.target instanceof Element ? event.target.closest("[data-marker]") : null;
      hit = marker ? markers[Number(marker.getAttribute("data-marker"))]?.places : undefined;
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
    const nextSpan = mapSpan(scale, aspect);
    setCamera(cameraX - (((current.x + other.x) / 2 - bounds.left) / bounds.width - .5) * nextSpan.width,
      cameraY - (((current.y + other.y) / 2 - bounds.top) / bounds.height - .5) * nextSpan.height, scale);
  }

  function finishGesture(event: PointerEvent) {
    if (!pointers.delete(event.pointerId) || pointers.size) return;
    dragging = false;
    if (event.type === "pointerup" && !moved && hit) {
      if (hit.length === 1) select(hit[0]);
      else cluster = hit;
    }
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

{#snippet mapContent(hint: string)}
  <p id={hint} class="settings-hint">Pince pour zoomer, glisse pour déplacer la carte et touche un repère.</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Carte pilotable aux flèches.) -->
  <svg class="map-surface" class:dragging viewBox={box} role="img" aria-label={data.title} aria-describedby={hint} tabindex="0" bind:this={surface}
    onpointerdown={startGesture} onpointermove={moveGesture} onpointerup={finishGesture}
    onpointercancel={finishGesture} onlostpointercapture={finishGesture} onkeydown={keyboard}>
    <rect width="360" height="180" class="water" />
    {#await world then land}<path d={land} fill-rule="evenodd" class="land" />{/await}
    {#if data.route}<path d={route} class="route" vector-effect="non-scaling-stroke" />{/if}
    {#each markers as marker, index (marker.places[0])}
      <g data-marker={index} class="marker">
        <title>{marker.places.map(place => data.places[place].title).join(", ")}</title>
        <circle cx={marker.x} cy={marker.y} r={22 * unitsPerPixel} fill="transparent" />
        <circle cx={marker.x} cy={marker.y} r={12 * unitsPerPixel} class:active={marker.places.includes(selected)}
          class="pin" vector-effect="non-scaling-stroke" />
        <text x={marker.x} y={marker.y} font-size={12 * unitsPerPixel} text-anchor="middle" dominant-baseline="central">
          {marker.places.length === 1 ? marker.places[0] + 1 : "+" + marker.places.length}
        </text>
      </g>
    {/each}
  </svg>
  <RenderOptions label="Options de la carte">
  <div class="actions">
    <button type="button" class="settings-btn" aria-label="Réduire le zoom de la carte" disabled={camera.scale <= 1}
      onclick={() => setCamera(camera.x, camera.y, camera.scale / 2)}>−</button>
    <button type="button" class="settings-btn" aria-label="Augmenter le zoom de la carte" disabled={camera.scale >= maxZoom}
      onclick={() => setCamera(camera.x, camera.y, camera.scale * 2)}>+</button>
    <button type="button" class="settings-btn" onclick={() => { cluster = []; fit(data.places); }}>Recentrer</button>
  </div>
  <label>Lieu <select class="settings-input" value={selected} onchange={event => select(Number(event.currentTarget.value), true)}>
    {#each data.places as point, index (index)}<option value={index}>{point.title}</option>{/each}
  </select></label>
  </RenderOptions>
  {#if cluster.length > 1}
    <div class="cluster">
      <p role="status">{cluster.length} lieux proches. Choisis un lieu.</p>
      <div class="actions places" role="group" aria-label="Lieux du groupe">
        {#each cluster as index (index)}
          <button type="button" class="settings-btn" aria-pressed={selected === index} onclick={() => select(index, true)}>
            {index + 1}. {data.places[index].title}
          </button>
        {/each}
        <button type="button" class="settings-btn" onclick={() => { cluster = []; }}>Masquer le groupe</button>
      </div>
    </div>
  {/if}
  <p aria-live="polite">{place.text || place.title} · {coordinates.format(place.lat)}, {coordinates.format(place.lon)}</p>
  {#if data.route}<p class="settings-hint">Liaisons entre étapes à vol d’oiseau.</p>{/if}
  <a href={"https://www.openstreetmap.org/?mlat=" + place.lat + "&mlon=" + place.lon + "#map=14/" + place.lat + "/" + place.lon}
    target="_blank" rel="noopener noreferrer">Ouvrir ce lieu dans OpenStreetMap</a>
  <small>Fond de carte Natural Earth</small>
{/snippet}

{#if !expanded}
  <figure class="interactive-map">
    <figcaption>
      <strong>{data.title}</strong>
      <button type="button" class="settings-btn" aria-haspopup="dialog" bind:this={openButton} onclick={() => void expand()}>Plein écran</button>
    </figcaption>
    {@render mapContent(hint)}
  </figure>
{/if}

<dialog class="map-dialog" aria-labelledby={hint + "-title"} bind:this={dialog} onclose={() => void finishExpansion()}>
  {#if expanded}
    <header>
      <h2 id={hint + "-title"}>{data.title}</h2>
      <button type="button" class="settings-btn" bind:this={closeButton} onclick={() => dialog?.close()}>Fermer la carte</button>
    </header>
    <div class="wide-map">
      {@render mapContent(hint + "-wide")}
    </div>
  {/if}
</dialog>

<style>
  figure { margin: .8rem 0; padding: .8rem; border: 1px solid var(--border); border-radius: .75rem; }
  figcaption, header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .45rem; }
  h2 { font-size: 1.1rem; margin: 0; overflow-wrap: anywhere; }
  .map-surface { display: block; width: min(100%, 36rem); aspect-ratio: 2; margin: .5rem auto; border-radius: .5rem;
    background: #183953; touch-action: none; cursor: grab; user-select: none; }
  .map-surface.dragging { cursor: grabbing; }
  .map-surface:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .water { fill: #183953; }
  .land { fill: #668e73; }
  .route { fill: none; stroke: #ffe089; stroke-width: 2; pointer-events: none; }
  .pin { fill: #ffe089; stroke: #15202a; stroke-width: 1.5; }
  .pin.active { fill: #fff; stroke: #ffbe33; stroke-width: 2; }
  .marker { cursor: pointer; }
  .marker text { fill: #15202a; font-weight: 700; pointer-events: none; }
  .actions { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .4rem; }
  .actions button, figcaption button, header button { min-height: 44px; }
  .places [aria-pressed=true] { border-color: var(--accent); }
  .cluster { margin-top: .6rem; padding: .5rem; border: 1px solid var(--border); border-radius: .65rem; }
  .cluster p { margin: 0; }
  small { display: block; color: var(--muted); }
  .map-dialog { box-sizing: border-box; position: fixed; inset: 0; inset-block-start: var(--ios-viewport-top, 0px);
    margin: 0 auto; padding: 0; width: min(100%, 70rem); height: var(--ios-viewport-height, 100dvh);
    max-width: 100%; max-height: var(--ios-viewport-height, 100dvh); border: 1px solid var(--border);
    background: var(--bg); color: var(--text); overflow: hidden; }
  .map-dialog[open] { display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .map-dialog::backdrop { background: #0009; }
  header { padding: max(.8rem, env(safe-area-inset-top)) .9rem .8rem; border-bottom: 1px solid var(--border); }
  .wide-map { overflow: auto; padding: .65rem .9rem max(.8rem, env(safe-area-inset-bottom)); }
  .wide-map .map-surface { width: 100%; aspect-ratio: auto; height: min(58dvh, 32rem); }
</style>