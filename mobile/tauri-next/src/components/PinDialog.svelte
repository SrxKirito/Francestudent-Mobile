<!-- Saisie d'un code PIN à 4 chiffres (même balisage et mêmes classes que locked-chats-ui.js). Le code n'est jamais conservé :
     il reste dans ce champ le temps de la validation puis est effacé. -->
<script lang="ts">
  import { tick } from "svelte";
  import { isValidPin, sanitizePin } from "../lib/services/locked-chats.ts";
  import type { ChatStore } from "../lib/stores/chat.svelte.ts";

  interface Props {
    chat: ChatStore;
  }

  let { chat }: Props = $props();

  const request = $derived(chat.pinRequest);
  const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  let dialog: HTMLElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let value = $state("");
  let error = $state("");
  let shake = $state(false);
  let pending = $state(false);

  // Une nouvelle demande repart d'un champ vide.
  let lastRequest: unknown = null;
  $effect(() => {
    const current = request;
    if (current === lastRequest) return;
    lastRequest = current;
    value = "";
    error = "";
    shake = false;
    pending = false;
    if (current) {
      void tick().then(() => (coarse ? dialog : input)?.focus());
    }
  });

  function setValue(next: string) {
    value = sanitizePin(next);
  }

  function press(key: string) {
    if (pending) return;
    if (key === "clear") setValue("");
    else if (key === "back") setValue(value.slice(0, -1));
    else setValue(value + key);
    shake = false;
  }

  async function submit() {
    if (pending || !request) return;
    if (!isValidPin(value)) {
      error = "Le code doit contenir exactement 4 chiffres.";
      shake = true;
      return;
    }
    pending = true;
    error = "";
    const message = await chat.submitPin(value);
    pending = false;
    if (message) {
      setValue("");
      error = message;
      shake = false;
      await tick();
      shake = true;
      if (!coarse) input?.focus();
    } else {
      value = "";
    }
  }

  function cancel() {
    if (!pending) chat.resolvePin(false);
  }

  function onKeydown(event: KeyboardEvent) {
    if (!request) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Tab" && dialog) {
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not([readonly])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
          last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (pending || (event.target === input && !coarse)) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      setValue(value + event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      setValue(value.slice(0, -1));
    } else if (event.key === "Enter" && (event.target as Element | null)?.tagName !== "BUTTON") {
      event.preventDefault();
      void submit();
    }
  }

  const KEYS: { label: string; key: string; secondary: boolean; aria?: string }[] = [
    ...[..."123456789"].map(digit => ({ label: digit, key: digit, secondary: false })),
    { label: "Effacer", key: "clear", secondary: true, aria: "Effacer tout le code" },
    { label: "0", key: "0", secondary: false },
    { label: "⌫", key: "back", secondary: true, aria: "Supprimer le dernier chiffre" }
  ];
</script>

<svelte:document onkeydowncapture={onKeydown} />

{#if request}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="locked-pin-overlay open" style="z-index: 10001" onclick={event => { if (event.target === event.currentTarget) cancel(); }}>
    <div class="locked-pin-dialog" class:has-error={shake} class:busy={pending} role="dialog" aria-modal="true" aria-labelledby="locked-pin-title" aria-busy={pending ? "true" : "false"} tabindex="-1" bind:this={dialog}>
      <h2 class="locked-pin-title" id="locked-pin-title">{request.request.title}</h2>
      <p class="locked-pin-description">{request.request.description ?? ""}</p>
      <input class="locked-pin-input" type="password" inputmode={coarse ? "none" : "numeric"} autocomplete="off" maxlength="4" spellcheck="false" pattern="[0-9]*" aria-label="Code PIN (4 chiffres)" readonly={coarse} {value} bind:this={input} oninput={event => setValue((event.currentTarget as HTMLInputElement).value)} onkeydown={event => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}>
      <p class="locked-pin-error" role="alert" aria-live="assertive">{error}</p>
      <div class="locked-pin-keypad" role="group" aria-label="Pavé numérique">
        {#each KEYS as key (key.key)}
          <button type="button" class={"locked-pin-key" + (key.secondary ? " locked-pin-key-secondary" : "")} data-key={key.key} aria-label={key.aria} disabled={pending} onclick={() => press(key.key)}>{key.label}</button>
        {/each}
      </div>
      <div class="locked-pin-actions">
        <button type="button" class="locked-pin-btn" disabled={pending} onclick={cancel}>Annuler</button>
        <button type="button" class="locked-pin-btn primary" disabled={pending || !isValidPin(value)} onclick={() => void submit()}>{request.request.confirmLabel ?? "Valider"}</button>
      </div>
    </div>
  </div>
{/if}
