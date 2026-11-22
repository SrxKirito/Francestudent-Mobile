<script lang="ts">
  import type { Point3D, SimulationScene } from "../lib/services/interactive-widgets.ts";
  import { DEFAULT_SCENE_CAMERA, SCENE_HEIGHT, SCENE_WIDTH, evaluateSimulationScene, sceneFaceColor, sceneProjection,
    type SceneCamera } from "../lib/services/simulation-scene.ts";

  let { scene, values }: { scene: SimulationScene; values: unknown[] } = $props();
  const hint = $props.id();
  let surface: SVGSVGElement | undefined = $state();
  let camera = $state.raw<SceneCamera>({ ...DEFAULT_SCENE_CAMERA });
  let axesShown = $state(true);
  let wire = $state(false);
  let dragging = $state(false);
  const pointers = new Map<number, [number, number]>();
  const geometry = $derived(evaluateSimulationScene(scene, values));
  const project = $derived(sceneProjection(scene.bounds, camera));

  function faceLight(points: ReturnType<typeof project>[]) {
    const [a, b, c] = points;
    if (!c) return 1;
    const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y;
    const area = Math.abs(bx * cy - by * cx);
    const lengths = Math.hypot(bx, by) * Math.hypot(cx, cy);
    const angle = lengths ? area / lengths : 0;
    return .78 + angle * .38;
  }

  const faces = $derived(geometry.faces.map(({ points, color }, index) => {
    const vertices = points.map(project);
    return { index, segment: vertices.length === 2, points: vertices.map(point => point.x + "," + point.y).join(" "),
      depth: vertices.reduce((sum, point) => sum + point.depth, 0) / vertices.length,
      color: sceneFaceColor(color, faceLight(vertices)) };
  }).sort((a, b) => a.depth - b.depth));
  const labels = $derived([...geometry.points].map(([id, point]) => ({ id, label: point.label, ...project(point.position) })));
  const axes = $derived.by(() => {
    const [lower, upper] = scene.bounds;
    const origin = lower.map((value, index) => Math.max(value, Math.min(upper[index], 0))) as Point3D;
    const start = project(origin);
    return [
      { label: "X", end: project([upper[0], origin[1], origin[2]]), color: "#d65f63" },
      { label: "Y", end: project([origin[0], upper[1], origin[2]]), color: "#329d89" },
      { label: "Z", end: project([origin[0], origin[1], upper[2]]), color: "#7c72d8" }
    ].map(axis => ({ ...axis, start }));
  });

  function view(yaw: number, pitch: number, zoom: number) {
    camera = { yaw: yaw % (2 * Math.PI), pitch: Math.max(-1.48, Math.min(1.48, pitch)),
      zoom: Math.max(.5, Math.min(5, zoom)) };
  }

  function zoom(factor: number) {
    view(camera.yaw, camera.pitch, camera.zoom * factor);
  }

  function rotate(dx: number, dy: number) {
    view(camera.yaw + dx, camera.pitch + dy, camera.zoom);
  }

  function reset() {
    camera = { ...DEFAULT_SCENE_CAMERA };
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    surface?.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const current: [number, number] = [event.clientX, event.clientY];
    pointers.set(event.pointerId, current);
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    dragging = true;
    if (!other) {
      const viewport = surface?.clientWidth || SCENE_WIDTH;
      rotate(4 * (current[0] - previous[0]) / viewport, 4 * (current[1] - previous[1]) / viewport);
      return;
    }
    const before = Math.hypot(previous[0] - other[0], previous[1] - other[1]);
    const after = Math.hypot(current[0] - other[0], current[1] - other[1]);
    if (before > 6 && after > 6) zoom(after / before);
  }

  function end(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (!pointers.size) dragging = false;
  }

  function keyboard(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowLeft": rotate(-.17, 0); break;
      case "ArrowRight": rotate(.17, 0); break;
      case "ArrowUp": rotate(0, -.17); break;
      case "ArrowDown": rotate(0, .17); break;
      case "+": case "=": zoom(1.25); break;
      case "-": zoom(.8); break;
      case "Home": reset(); break;
      default: return;
    }
    event.preventDefault();
  }
</script>

<figure>
  <figcaption>{scene.title}</figcaption>
  <p id={hint} class="settings-hint">Glisse ou utilise les flèches pour tourner. Pince pour zoomer.</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (La vue 3D est manipulable au clavier.) -->
  <svg viewBox={"0 0 " + SCENE_WIDTH + " " + SCENE_HEIGHT} role="img" aria-label={scene.title} aria-describedby={hint}
    bind:this={surface} tabindex="0" class:dragging onpointerdown={start} onpointermove={move}
    onpointerup={end} onpointercancel={end} onlostpointercapture={end} onkeydown={keyboard}>
    {#if axesShown}
      {#each axes as { label, start, end, color } (label)}
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} stroke-dasharray="4 3" />
        <text x={end.x + 5} y={end.y - 4} fill={color}>{label}</text>
      {/each}
    {/if}
    {#each faces as face (face.index)}
      {#if face.segment}
        <polyline points={face.points} fill="none" stroke={face.color} stroke-width="2" />
      {:else}
        <polygon points={face.points} fill={wire ? "none" : face.color} stroke={face.color} stroke-width={wire ? 1 : .8} />
      {/if}
    {/each}
    {#each labels as point (point.id)}
      <circle cx={point.x} cy={point.y} r="2.6" />
      {#if point.label}<text x={point.x + 5} y={point.y - 4}>{point.label}</text>{/if}
    {/each}
  </svg>
  {#if !faces.length && !labels.length}<p class="settings-hint">La figure est indéfinie pour ces valeurs.</p>{/if}
  <div class="scene-actions">
    <button type="button" class="settings-btn" aria-label="Réduire le zoom de la figure 3D" disabled={camera.zoom <= .5} onclick={() => zoom(.8)}>−</button>
    <button type="button" class="settings-btn" aria-label="Agrandir la figure 3D" disabled={camera.zoom >= 5} onclick={() => zoom(1.25)}>+</button>
    <button type="button" class="settings-btn" onclick={reset}>Vue initiale</button>
    <button type="button" class="settings-btn" aria-pressed={wire} onclick={() => wire = !wire}>Filaire</button>
    <button type="button" class="settings-btn" aria-pressed={axesShown} onclick={() => axesShown = !axesShown}>Axes</button>
  </div>
</figure>

<style>
  figure { margin: .85rem 0 0; padding: .7rem; border: 1px solid var(--border); border-radius: .65rem; min-width: 0; }
  figcaption { font-weight: 600; }
  p { margin-block: .35rem; }
  svg { display: block; width: min(100%, 34rem); margin: 0 auto .55rem; border-radius: .55rem; background: var(--surface); touch-action: none; cursor: grab; }
  svg.dragging { cursor: grabbing; }
  svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  text { font-size: 12px; }
  text:not([fill]), circle { fill: currentColor; }
  .scene-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
  .scene-actions button { min-width: 44px; min-height: 44px; }
</style>
