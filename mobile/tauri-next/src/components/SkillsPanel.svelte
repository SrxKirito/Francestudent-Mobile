<script lang="ts">
  import type { SkillsStore } from "../lib/stores/skills.svelte.ts";

  let { skills }: { skills: SkillsStore } = $props();
  let query = $state("");
  let fileInput: HTMLInputElement;
  const rows = $derived(skills.search(query));

  $effect(() => { void skills.load(true); });

  function importSkill(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void skills.import(file);
  }
</script>

<div id="panel-skills" class="settings-panel" role="tabpanel" aria-labelledby="tab-skills">
  <h3 class="settings-section-title">Skills du compte ({skills.skills.length})</h3>
  <div class="settings-item-actions">
    <button type="button" class="settings-btn" disabled={skills.busy || skills.loading} onclick={() => fileInput.click()}>Importer</button>
    <button type="button" class="settings-btn" disabled={skills.busy || skills.loading} onclick={() => void skills.load(true)}>Actualiser</button>
    <input type="file" accept=".md,.zip" hidden bind:this={fileInput} onchange={importSkill}>
  </div>
  <input class="settings-input" type="search" aria-label="Rechercher un skill" placeholder="Rechercher un skill" bind:value={query}>
  {#if skills.error}<p class="settings-error" role="alert">{skills.error}</p>{/if}
  {#if skills.loading || skills.busy}<p class="settings-hint" role="status">Chargement des skills…</p>{/if}
  {#if !skills.loading && !skills.error && rows.length === 0}<p class="settings-hint">{query ? "Aucun résultat." : "Aucun skill sur ton compte."}</p>{/if}
  {#each rows as skill (skill.id)}
    <article class="settings-item">
      <div class="settings-item-head">
        <strong>{skill.name}</strong>
        <label><input type="checkbox" role="switch" aria-label={"Activer " + skill.name} checked={skill.enabled} disabled={skills.busy || skills.loading} onchange={event => { event.currentTarget.checked = skill.enabled; void skills.toggle(skill); }}> {skill.enabled ? "Activé" : "Désactivé"}</label>
      </div>
      {#if skill.description}<details class="settings-tools"><summary>Description</summary><p>{skill.description}</p></details>{/if}
      <div class="settings-item-actions">
        <button type="button" class="settings-btn small danger" disabled={skills.busy || skills.loading} onclick={() => { if (window.confirm("Supprimer le skill « " + skill.name + " » ?")) void skills.remove(skill); }}>Supprimer</button>
      </div>
    </article>
  {/each}
</div>
