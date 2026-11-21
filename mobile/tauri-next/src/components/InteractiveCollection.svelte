
<script lang="ts">
  import type { Card, InteractiveWidget } from "../lib/services/interactive-widgets.ts";
  let { data }: { data: Extract<InteractiveWidget, { kind: "cards" | "carousel" | "timeline" | "animation" | "diagram" }> } = $props();
  const uid = $props.id();
  let index = $state(0);
  let playing = $state(false);
  let reduced = $state(false);
  let full = $state<HTMLDialogElement>();
  let fullImage = $state<Card | null>(null);
  const current = $derived(data.items[index] ?? data.items[0]);
  const nodeX = (node: number) => 44 + (node % 4) * 104;
  const nodeY = (node: number) => 32 + Math.floor(node / 4) * 60;
  const diagramHeight = $derived(8 + Math.ceil(data.items.length / 4) * 60);
  const step = (delta: number) => { index = (index + delta + data.items.length) % data.items.length; };

  $effect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => { reduced = media.matches; if (reduced) playing = false; };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  });
  $effect(() => {
    if (!playing || reduced || data.kind !== "animation") return;
    const timer = setInterval(() => { if (!document.hidden) step(1); }, 1500);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (fullImage && full && !full.open) full.showModal();
  });

  function closeImage(event?: Event) {
    event?.preventDefault();
    full?.close();
    fullImage = null;
  }
</script>

{#snippet card(item: Card)}
  <article>
    {#if item.label}<small>{item.label}</small>{/if}
    <strong>{item.title}</strong>
    {#if item.image}
      <button type="button" class="media" aria-label={"Agrandir " + item.title} onclick={() => fullImage = item}>
        <img src={item.image} alt={item.title} loading="lazy" referrerpolicy="no-referrer">
      </button>
    {/if}
    {#if item.text}<p>{item.text}</p>{/if}
    {#if item.href}<a href={item.href} target="_blank" rel="noopener noreferrer">Consulter la source</a>{/if}
  </article>
{/snippet}

<section class="interactive-collection" aria-label={data.title}>
  <strong>{data.title}</strong>
  {#if data.kind === "carousel" || data.kind === "animation"}
    <div class="frame" aria-live={playing ? "off" : "polite"}>{@render card(current)}</div>
    <div class="actions">
      <button type="button" class="settings-btn" aria-label="Précédent" disabled={data.items.length === 1} onclick={() => step(-1)}>‹</button>
      <span>{index + 1} / {data.items.length}</span>
      <button type="button" class="settings-btn" aria-label="Suivant" disabled={data.items.length === 1} onclick={() => step(1)}>›</button>
      {#if data.kind === "animation" && !reduced && data.items.length > 1}
        <button type="button" class="settings-btn" onclick={() => playing = !playing}>{playing ? "Pause" : "Lire la séquence"}</button>
      {/if}
    </div>
  {:else if data.kind === "timeline"}
    <ol class="timeline">
      {#each data.items as item, i (i)}<li>{@render card(item)}</li>{/each}
    </ol>
  {:else if data.kind === "diagram"}
    <svg viewBox={"0 0 400 " + diagramHeight} class="diagram" role="img" aria-label={data.title}>
      <defs><marker id={uid} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0 0L10 5L0 10Z" fill="currentColor" />
      </marker></defs>
      {#each data.edges as [from, to], i (i)}
        {@const dx = nodeX(to) - nodeX(from)}
        {@const dy = nodeY(to) - nodeY(from)}
        {@const length = Math.hypot(dx, dy)}
        {#if length > 0}
          <line x1={nodeX(from) + 17 * dx / length} y1={nodeY(from) + 17 * dy / length}
            x2={nodeX(to) - 22 * dx / length} y2={nodeY(to) - 22 * dy / length}
            stroke="currentColor" marker-end={"url(#" + uid + ")"} />
        {/if}
      {/each}
      {#each data.items as item, i (i)}
        <g class:current={index === i}>
          <circle cx={nodeX(i)} cy={nodeY(i)} r="16" />
          <text x={nodeX(i)} y={nodeY(i)} text-anchor="middle" dominant-baseline="central">{i + 1}</text>
          <title>{item.title}</title>
        </g>
      {/each}
    </svg>
    <div class="actions" role="group" aria-label="Étapes du schéma">
      {#each data.items as item, i (i)}
        <button type="button" class="settings-btn" aria-pressed={index === i} onclick={() => index = i}>{i + 1} · {item.title}</button>
      {/each}
    </div>
    {@render card(current)}
    <div class="actions" role="group" aria-label="Liaisons">
      {#each data.edges.filter(([from]) => from === index) as [, to], i (i)}
        <button type="button" class="settings-btn" onclick={() => index = to}>Aller à {data.items[to].title}</button>
      {/each}
    </div>
  {:else}
    <div class="cards">
      {#each data.items as item, i (i)}{@render card(item)}{/each}
    </div>
  {/if}
</section>
{#if fullImage}
  <dialog class="widget-image" bind:this={full} aria-label={fullImage.title} oncancel={closeImage}>
    <button type="button" class="settings-btn" onclick={() => closeImage()}>Fermer l’image</button>
    <img src={fullImage.image} alt={fullImage.title} referrerpolicy="no-referrer">
  </dialog>
{/if}

<style>
  section, article { padding: .75rem; border: 1px solid var(--border); border-radius: .75rem; min-width: 0; overflow-wrap: anywhere; }
  section { margin: .8rem 0; }
  article { display: grid; gap: .35rem; margin-block: .5rem; }
  article p { margin: 0; white-space: pre-wrap; }
  small { color: var(--muted); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .5rem; }
  .timeline { border-inline-start: 2px solid var(--border); padding-inline-start: 1.25rem; }
  .actions { display: flex; align-items: center; gap: .45rem; flex-wrap: wrap; }
  .actions button { min-height: 44px; }
  .actions [aria-pressed=true] { border-color: var(--accent); }
  .diagram { display: block; width: 100%; max-height: 20rem; }
  .diagram circle { fill: var(--surface); stroke: currentColor; }
  .diagram .current circle { fill: var(--accent); }
  .diagram text { fill: currentColor; font-size: 12px; }
  .media { display: block; padding: 0; background: none; border: 0; cursor: zoom-in; }
  img { max-width: 100%; max-height: 16rem; object-fit: contain; border-radius: .5rem; }
  .widget-image { position: fixed; inset: 0; margin: auto; max-width: 92vw; max-height: 82dvh; background: var(--surface); color: var(--text); border: 1px solid var(--border); }
  .widget-image img { display: block; max-height: 65dvh; margin-top: .6rem; }
  .widget-image::backdrop { background: #000b; }
</style>
