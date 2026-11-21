<script lang="ts">
  import { onMount } from "svelte";

  let { source, name, onerror }: { source: string; name: string; onerror: () => void } = $props();

  type Point = { x: number; y: number };
  const maxZoom = 3;
  const pointers = new Map<number, Point>();
  let viewport: HTMLDivElement;
  let image: HTMLImageElement;
  let zoom = $state(1);
  let pinching = $state(false);
  let offset = $state.raw<Point>({ x: 0, y: 0 });
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

  onMount(() => {
    const observer = new ResizeObserver(() => moveImage(zoom, offset));
    observer.observe(viewport);
    return () => observer.disconnect();
  });

  function moveImage(nextZoom: number, point: Point) {
    const horizontal = Math.max(0, (image.offsetWidth * nextZoom - viewport.clientWidth) / 2);
    const vertical = Math.max(0, (image.offsetHeight * nextZoom - viewport.clientHeight) / 2);
    zoom = nextZoom;
    offset = {
      x: clamp(point.x, -horizontal, horizontal),
      y: clamp(point.y, -vertical, vertical)
    };
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2 || !image.naturalWidth) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinching = pointers.size > 1;
    viewport.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, current);

    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) {
      if (zoom > 1) moveImage(zoom, { x: offset.x + current.x - previous.x, y: offset.y + current.y - previous.y });
      return;
    }

    const lastDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
    const distance = Math.hypot(current.x - other.x, current.y - other.y);
    if (lastDistance < 8 || distance < 8) return;
    const nextZoom = clamp(zoom * distance / lastDistance, 1, maxZoom);
    const ratio = nextZoom / zoom;
    const bounds = viewport.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    // Conserve le point de l’image sous le centre des deux doigts.
    const x = (current.x + other.x) / 2 - centerX - ((previous.x + other.x) / 2 - centerX - offset.x) * ratio;
    const y = (current.y + other.y) / 2 - centerY - ((previous.y + other.y) / 2 - centerY - offset.y) * ratio;
    moveImage(nextZoom, { x, y });
  }

  function stop(event: PointerEvent) {
    pointers.delete(event.pointerId);
    pinching = pointers.size > 1;
  }

  function panWithKeys(event: KeyboardEvent) {
    if (zoom === 1) return;
    const directions = { ArrowLeft: { x: 30, y: 0 }, ArrowRight: { x: -30, y: 0 },
      ArrowUp: { x: 0, y: 30 }, ArrowDown: { x: 0, y: -30 } };
    if (!Object.hasOwn(directions, event.key)) return;
    const direction = directions[event.key as keyof typeof directions];
    event.preventDefault();
    moveImage(zoom, { x: offset.x + direction.x, y: offset.y + direction.y });
  }

  function zoomBy(step: number) {
    const nextZoom = clamp(zoom + step, 1, maxZoom);
    moveImage(nextZoom, { x: offset.x * nextZoom / zoom, y: offset.y * nextZoom / zoom });
  }
</script>

<div class="preview-image">
  <div class="image-controls">
    <button type="button" class="settings-btn" aria-label="Réduire le zoom" disabled={zoom === 1} onclick={() => zoomBy(-.5)}>−</button>
    <span role="status" aria-live={pinching ? "off" : "polite"}>{Math.round(zoom * 100)} %</span>
    <button type="button" class="settings-btn" aria-label="Augmenter le zoom" disabled={zoom === maxZoom} onclick={() => zoomBy(.5)}>+</button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Le focus permet de déplacer l’image zoomée au clavier.) -->
  <div class="preview-image-viewport" class:zoomed={zoom > 1} role="group" aria-label="Image à agrandir"
    tabindex={zoom > 1 ? 0 : undefined} bind:this={viewport} onkeydown={panWithKeys} onpointerdown={start} onpointermove={move}
    onpointerup={stop} onpointercancel={stop} onlostpointercapture={stop}>
    <img src={source} alt={name} draggable="false" bind:this={image}
      style:transform={`translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`} {onerror}>
  </div>
</div>

<style>
  .preview-image { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: .75rem; height: 100%; min-width: 0; }
  .image-controls { display: flex; align-items: center; justify-content: center; gap: .75rem; }
  .preview-image-viewport {
    position: relative;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    touch-action: none;
    user-select: none;
  }
  .preview-image-viewport.zoomed { cursor: grab; }
  .preview-image-viewport.zoomed:active { cursor: grabbing; }
  img {
    position: absolute;
    inset: 0;
    margin: auto;
    max-width: 100%;
    max-height: 100%;
    pointer-events: none;
  }
</style>
