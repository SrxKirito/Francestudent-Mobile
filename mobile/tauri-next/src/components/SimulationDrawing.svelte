<script lang="ts">
  import { calculate, number, snapSimulationField, type Field, type SimulationDrawing } from "../lib/services/interactive-widgets.ts";
  let { drawing, fields, values, onchange }: {
    drawing: SimulationDrawing; fields: Field[]; values: unknown[];
    onchange: (index: number, value: number) => void;
  } = $props();

  const clipId = $props.id();
  const arrowId = clipId + "-arrow";
  const hintId = clipId + "-hint";
  const width = 400, height = 230, padding = 22;
  let surface: SVGSVGElement | undefined = $state();
  let drag: { id: string; pointer: number; dx: number; dy: number } | undefined = $state();
  const [left, bottom, right, top] = $derived(drawing.bounds);
  const scale = $derived(Math.min((width - 2 * padding) / (right - left), (height - 2 * padding) / (top - bottom)));
  const pointX = (x: number) => width / 2 + (x - (left + right) / 2) * scale;
  const pointY = (y: number) => height / 2 - (y - (bottom + top) / 2) * scale;
  const draggable = $derived(drawing.points.some(point => point.dragX !== undefined || point.dragY !== undefined));
  const points = $derived(new Map(drawing.points.flatMap(point => {
    const x = calculate(point.x, values), y = calculate(point.y, values);
    return number(x) && number(y) ? [[point.id, { ...point, x: pointX(x), y: pointY(y) }]] : [];
  })));

  type RenderedPoint = NonNullable<ReturnType<typeof points.get>>;

  function cursor(event: PointerEvent): DOMPoint | undefined {
    const matrix = surface?.getScreenCTM();
    if (!surface || !matrix) return undefined;
    const point = surface.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function apply(index: number | undefined, value: number, min: number, max: number) {
    if (index === undefined || !fields[index] || !Number.isFinite(value)) return;
    const next = snapSimulationField(fields[index], Math.max(min, Math.min(max, value)));
    if (next >= min && next <= max && values[index] !== next) onchange(index, next);
  }

  function start(event: PointerEvent & { currentTarget: SVGGElement }, point: RenderedPoint) {
    if (drag || event.button !== 0) return;
    const position = cursor(event);
    if (!position) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    surface?.setPointerCapture(event.pointerId);
    drag = { id: point.id, pointer: event.pointerId, dx: point.x - position.x, dy: point.y - position.y };
  }

  function move(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return;
    const point = points.get(drag.id);
    const position = cursor(event);
    if (!point || !position) return;
    const x = left + (position.x + drag.dx - pointX(left)) / scale;
    const y = bottom + (pointY(bottom) - position.y - drag.dy) / scale;
    apply(point.dragX, x, left, right);
    apply(point.dragY, y, bottom, top);
  }

  function end(event: PointerEvent) {
    if (drag?.pointer === event.pointerId) drag = undefined;
  }

  function step(event: KeyboardEvent, point: RenderedPoint) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 :
      event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (!direction) return;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const index = horizontal ? point.dragX : point.dragY;
    if (index === undefined) return;
    event.preventDefault();
    const field = fields[index];
    const current = typeof values[index] === "number" && Number.isFinite(values[index]) ? Number(values[index]) : Number(field.value);
    const candidate = current + direction * field.step * (event.shiftKey ? 10 : 1);
    apply(index, candidate, horizontal ? left : bottom, horizontal ? right : top);
  }
</script>

<figure>
  <figcaption>{drawing.title}</figcaption>
  {#if points.size}
    {#if draggable}<p id={hintId} class="settings-hint">Déplace un point marqué avec le doigt, la souris ou les flèches du clavier.</p>{/if}
    <svg viewBox={"0 0 " + width + " " + height} role={draggable ? "group" : "img"} aria-label={drawing.title}
      aria-describedby={draggable ? hintId : undefined} bind:this={surface}
      onpointermove={move} onpointerup={end} onpointercancel={end} onlostpointercapture={end}>
      <defs>
        <clipPath id={clipId}><rect x={pointX(left)} y={pointY(top)} width={(right - left) * scale} height={(top - bottom) * scale} /></clipPath>
        <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path class="arrow" d="M0 0 L10 5 L0 10 Z" />
        </marker>
      </defs>
      <g clip-path={"url(#" + clipId + ")"}>
        {#if left <= 0 && right >= 0}<path class="axis" d={`M${pointX(0)} 0 V${height}`} />{/if}
        {#if bottom <= 0 && top >= 0}<path class="axis" d={`M0 ${pointY(0)} H${width}`} />{/if}
        {#each drawing.shapes as shape, index (index)}
          {#if shape.kind === "circle"}
            {@const center = points.get(shape.center)}
            {@const radius = calculate(shape.radius, values)}
            {#if center && number(radius) && radius > 0}<circle class="contour" cx={center.x} cy={center.y} r={radius * scale} />{/if}
          {:else if shape.points.every(id => points.has(id))}
            {@const poly = shape.points.map(id => {
              const point = points.get(id)!;
              return point.x + "," + point.y;
            }).join(" ")}
            {#if shape.closed}<polygon points={poly} />{:else}<polyline points={poly} marker-end={shape.arrow ? "url(#" + arrowId + ")" : undefined} />{/if}
          {/if}
        {/each}
      </g>
      {#each [...points] as [id, point] (id)}
        {#if point.x >= pointX(left) && point.x <= pointX(right) && point.y >= pointY(top) && point.y <= pointY(bottom)}
          {#if point.dragX !== undefined || point.dragY !== undefined}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Un point bidimensionnel se déplace aux flèches.) -->
            <g class="handle" class:dragging={drag?.id === id} role="group" tabindex="0" aria-label={(point.label || id) + ", point déplaçable"}
              onpointerdown={event => start(event, point)} onkeydown={event => step(event, point)}>
              <circle class="hit" cx={point.x} cy={point.y} r="24" />
              <circle class="grip" cx={point.x} cy={point.y} r="6" />
            </g>
          {:else}
            <circle class="point" cx={point.x} cy={point.y} r="3.5" />
          {/if}
          {#if point.label}<text x={point.x + 7} y={point.y - 6}>{point.label}</text>{/if}
        {/if}
      {/each}
    </svg>
  {:else}
    <p class="settings-hint">La figure est indéfinie pour ces valeurs.</p>
  {/if}
</figure>

<style>
  figure { margin: .75rem 0 0; padding: .65rem; border: 1px solid var(--border); border-radius: .65rem; }
  figcaption { font-weight: 600; }
  p { margin-block: .35rem; }
  svg { display: block; width: 100%; max-height: 16rem; }
  .axis { stroke: var(--muted); opacity: .45; }
  polyline, polygon, .contour { stroke: #6479e9; stroke-width: 2; fill: none; }
  polygon, .contour { fill: #6479e9; fill-opacity: .15; }
  .point, .arrow { fill: #6479e9; }
  .handle { cursor: grab; touch-action: none; }
  .hit { fill: transparent; touch-action: none; }
  .grip { fill: var(--bg); stroke: #6479e9; stroke-width: 2.5; pointer-events: none; }
  .handle:focus-visible .grip, .handle.dragging .grip { stroke: currentColor; }
  .handle.dragging { cursor: grabbing; }
  text { fill: currentColor; font-size: 13px; pointer-events: none; }
</style>
