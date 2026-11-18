<script lang="ts">
  import logo from "../../../www/image.png";
  import type { SessionStore } from "../lib/stores/session.svelte.ts";

  let { session }: { session: SessionStore } = $props();

  let email = $state("");
  let password = $state("");
  let cookie = $state("");

  async function onPassword(event: SubmitEvent) {
    event.preventDefault();
    if (await session.loginWithPassword(email, password)) password = "";
  }

  async function onCookie(event: SubmitEvent) {
    event.preventDefault();
    if (await session.loginWithCookie(cookie)) cookie = "";
  }
</script>

<section id="login-screen" class="login-screen">
  <div class="login-card">
    <img class="logo logo-img" src={logo} alt="FranceStudent">
    <h1>FranceStudent Chat</h1>
    <p class="login-help">Connecte-toi avec l'e-mail et le mot de passe de ton compte FranceStudent.</p>
    <form id="login-form" onsubmit={onPassword}>
      <input type="email" id="email-input" class="login-input" placeholder="Adresse e-mail" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" required bind:value={email}>
      <input type="password" id="password-input" class="login-input" placeholder="Mot de passe" autocomplete="current-password" required bind:value={password}>
      <button type="submit" id="login-button" class="primary" disabled={session.busy === "password"}>{session.busy === "password" ? "Connexion…" : "Se connecter"}</button>
    </form>
    <p id="login-error" class="error" class:hidden={!session.error}>{session.error}</p>
    <details class="cookie-login">
      <summary>Se connecter avec un cookie de session</summary>
      <p class="login-help">Colle la valeur du cookie <code>next-auth.session-token</code> de ton navigateur (F12 &gt; Stockage &gt; Cookies sur ia.francestudent.org).</p>
      <form id="cookie-form" onsubmit={onCookie}>
        <textarea id="session-input" rows="4" placeholder="Cookie de session" autocomplete="off" spellcheck="false" required bind:value={cookie}></textarea>
        <button type="submit" id="cookie-button" class="primary" disabled={session.busy === "cookie"}>{session.busy === "cookie" ? "Connexion…" : "Utiliser ce cookie"}</button>
      </form>
    </details>
  </div>
</section>
