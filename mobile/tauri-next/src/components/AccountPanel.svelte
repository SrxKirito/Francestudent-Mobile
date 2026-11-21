<!-- Onglet Compte (Svelte) : même balisage et mêmes classes que la section #panel-account de mobile/www/index.html
    (feuilles legacy déjà importées par le shell). Seule la section « Sessions actives » est nouvelle. La logique est dans AccountStore. -->
<script lang="ts">
  import ApiKeyPanel from "./ApiKeyPanel.svelte";
  import type { ApiClient } from "../lib/services/api-client.ts";
  import type { AccountStore } from "../lib/stores/account.svelte.ts";
  import { compactNumber, exactNumber, sessionDateLabel } from "../lib/services/account.ts";
  import type { UserSession } from "../lib/services/account.ts";
  import logo from "../../../www/image.png";

  interface Props {
    account: AccountStore;
    api?: ApiClient;
    onconfirm?: (text: string) => Promise<boolean>;
  }

  let { account, api, onconfirm = async () => false }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();

  const summary = $derived(account.activitySummary);
  const calendar = $derived(account.activityCalendar);
  const quota = $derived(account.quotaView);
  const confirmText = $derived(
    account.pendingRevoke === "all"
      ? "Terminer toutes les sessions ? Tu seras aussi déconnecté de cet appareil."
      : "Terminer cette session ? Si c’est celle de cet appareil, cela peut te déconnecter de cet appareil."
  );

  function pickAvatar() {
    fileInput?.click();
  }

  function avatarChosen(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    void account.changeAvatar(file);
  }

  function sessionDetails(session: UserSession): string {
    const since = sessionDateLabel(session.since);
    const last = sessionDateLabel(session.lastActiveAt);
    return [session.location, since && "Connectée le " + since, last && "Active le " + last].filter(Boolean).join(" · ");
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role : balisage identique à l'écran classique (testé) -->
<section id="panel-account" class="settings-panel" data-panel="account" role="tabpanel" aria-labelledby="tab-account">
  <div class="profile-card settings-profile">
    <button type="button" id="avatar-edit" class="avatar-edit" aria-label="Changer la photo de profil" title="Changer la photo" onclick={pickAvatar}>
      <img id="profile-avatar" class="avatar avatar-img" src={account.avatar || logo} alt="" aria-hidden="true">
      <span class="avatar-edit-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span>
    </button>
    <div class="profile-text">
      <div id="profile-name" class="profile-name">{account.displayName}</div>
      <div id="profile-email" class="profile-email">{account.profile.email}</div>
      <div class="avatar-actions">
        <button type="button" id="avatar-change" class="settings-btn small" onclick={pickAvatar}>Changer la photo</button>
        <button type="button" id="avatar-remove" class="settings-btn small" hidden={!account.hasCustomAvatar} onclick={() => account.removeAvatar()}>Retirer</button>
      </div>
    </div>
    <input type="file" id="avatar-input" accept="image/*" hidden bind:this={fileInput} onchange={avatarChosen}>
  </div>
  <div class="settings-section-title quota-head">Budget du jour <button type="button" id="quota-refresh" class="quota-refresh" aria-label="Actualiser le quota" title="Actualiser" disabled={account.quotaState === "loading"} onclick={() => void account.refreshQuota()}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg></button></div>
  <div id="quota-box" class="quota-box" aria-live="polite">{#if quota}<div class="quota-row-head"><span>Utilisé</span><strong>{quota.label}</strong></div><div class="quota-bar"><span class={quota.level || undefined} style={"width: " + quota.percent + "%"}></span></div><div class="quota-note">{quota.note}</div>{:else}<div class="quota-note">{account.quotaMessage}</div>{/if}</div>
  <div class="settings-actions">
    {#if api && !account.signingOut}<ApiKeyPanel {api} {onconfirm} />{/if}
    <section id="account-activity" class="account-activity" aria-label="Activité tokens">
      <div class="activity-heading"><h3>Activité tokens</h3><div><button type="button" id="activity-share" class="settings-btn small" disabled={account.shareDisabled || account.activityLoading} onclick={() => void account.shareActivity()}>Partager</button><button type="button" id="activity-refresh" class="settings-icon-btn" aria-label="Actualiser l’activité" disabled={account.activityLoading} onclick={() => void account.refreshActivity()}>↻</button></div></div>
      <p id="activity-status" class="settings-hint" role="status" aria-live="polite">{account.activityStatus}</p>
      <div id="activity-content" hidden={summary === null}>
        {#if summary}
          <div class="activity-metrics">{#each account.activityMetrics as metric (metric.label)}<div><strong>{metric.value}</strong><span>{metric.label}</span></div>{/each}</div>
          {#if calendar && summary.rows.length > 0}
            <div class="activity-calendar-box">
              <strong>{exactNumber(summary.total) + " tokens · " + summary.rows.length + " jours renseignés"}</strong>
              <div class="activity-calendar-scroll">
                <div class="activity-months">{#each calendar.months as month, index (index)}<span>{month}</span>{/each}</div>
                <div class="activity-calendar" aria-label="Activité quotidienne des 343 derniers jours. Chaque case indique sa date et son nombre de tokens.">
                  {#each calendar.cells as cell (cell.date)}
                    <button type="button" class={cell.reported ? "activity-cell" : "activity-cell unreported"} data-level={String(cell.level)} title={cell.label} aria-label={cell.label} onclick={() => account.selectCell(cell.label)}></button>
                  {/each}
                </div>
              </div>
              <p class="settings-hint">Clair = activité élevée · cases en pointillés = aucune donnée reçue.</p>
            </div>
            <div class="activity-insights">
              <section>
                <h4>Insights d’activité</h4>
                <div class="activity-pair"><span>Total période</span><strong>{compactNumber(summary.total)}</strong></div>
                <div class="activity-pair"><span>Pic journalier</span><strong>{(summary.peak.date ? summary.peak.date + " · " : "") + compactNumber(summary.peak.total)}</strong></div>
                <div class="activity-pair"><span>Jours actifs</span><strong>{String(summary.active)}</strong></div>
              </section>
              <section>
                <h4>Répartition tokens</h4>
                <div class="activity-pair"><span>🔵 Input</span><strong>{compactNumber(summary.input)}</strong></div>
                <div class="activity-pair"><span>🟢 Output</span><strong>{compactNumber(summary.output)}</strong></div>
                <div class="activity-pair"><span>🟠 Reasoning</span><strong>{compactNumber(summary.reasoning)}</strong></div>
              </section>
            </div>
          {:else}
            <p class="settings-hint">Aucun historique journalier disponible pour cette période.</p>
          {/if}
        {/if}
      </div>
    </section>
    <section id="account-sessions" class="account-activity account-sessions" aria-label="Sessions actives">
      <div class="activity-heading"><h3>Sessions actives</h3><div><button type="button" id="sessions-end-all" class="settings-btn small danger" disabled={account.sessions.length === 0 || account.revoking} onclick={() => account.askRevoke("all")}>Tout terminer</button><button type="button" id="sessions-refresh" class="settings-icon-btn" aria-label="Actualiser les sessions" disabled={account.sessionsState === "loading" || account.revoking} onclick={() => void account.refreshSessions()}>↻</button></div></div>
      <p id="sessions-status" class="settings-hint" role="status" aria-live="polite">{account.sessionsMessage}</p>
      <ul id="sessions-list" class="sessions-list" hidden={account.sessions.length === 0}>
        {#each account.sessions as session (session.id)}
          <li class="sessions-item" data-session-id={session.id}>
            <div class="sessions-text"><span class="sessions-name">{session.os || "Appareil inconnu"}</span><span class="sessions-meta">{sessionDetails(session)}</span></div>
            <button type="button" class="settings-btn small danger" data-session-end={session.id} disabled={account.revoking} onclick={() => account.askRevoke(session.id)}>Terminer</button>
          </li>
        {/each}
      </ul>
      {#if account.pendingRevoke !== null}
        <div id="sessions-confirm" class="sessions-confirm" role="alertdialog" aria-label="Confirmer la fin de session"><p id="sessions-confirm-text" class="settings-hint">{confirmText}</p><div class="sessions-confirm-actions"><button type="button" id="sessions-confirm-cancel" class="settings-btn small" disabled={account.revoking} onclick={() => account.cancelRevoke()}>Annuler</button><button type="button" id="sessions-confirm-yes" class="settings-btn small danger" disabled={account.revoking} onclick={() => void account.confirmRevoke()}>{account.pendingRevoke === "all" ? "Tout terminer" : "Terminer"}</button></div></div>
      {/if}
    </section>
    <button id="logout" class="settings-btn danger" type="button" disabled={account.signingOut} onclick={() => void account.logout()}>Se déconnecter</button>
    {#if account.logoutError}
      <p id="logout-status" role="alert" class="settings-hint general-status-error">{account.logoutError}</p>
    {/if}
  </div>
</section>

<style>
  :global(.sessions-list) { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  :global(.sessions-list[hidden]) { display: none; }
  :global(.sessions-item) { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; }
  :global(.sessions-text) { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  :global(.sessions-name) { font-size: 14px; overflow-wrap: anywhere; }
  :global(.sessions-meta) { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  :global(.sessions-confirm) { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; }
  :global(.sessions-confirm p) { margin: 0 0 10px; }
  :global(.sessions-confirm-actions) { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
</style>
