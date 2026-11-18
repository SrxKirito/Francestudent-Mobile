// Tests du flux de connexion e-mail / mot de passe (src/lib/services/login.ts) contre un faux serveur OAuth.
// L'adaptateur DOM (page-reader.ts) n'est pas couvert ici : Node n'a pas de DOMParser.
import assert from "node:assert/strict";
import { loginWithPassword, storeCookies } from "./src/lib/services/login.ts";
import { AuthError } from "./src/lib/services/auth.ts";
import { USER_AGENT } from "./src/lib/config.ts";

const IA = "https://ia.francestudent.org";
const MY = "https://my.francestudent.org";

let count = 0;
async function test(name, fn) {
  try {
    await fn();
    count += 1;
  } catch (error) {
    console.error(`ÉCHEC : ${name}`);
    throw error;
  }
}

const field = (over) => ({ name: "", id: "", type: "text", value: "", checked: false, disabled: false, ...over });
const json = (value, extra = {}) => ({ status: 200, headers: {}, data: JSON.stringify(value), ...extra });
const html = (info, extra = {}) => ({
  status: 200,
  headers: { "content-type": "text/html" },
  data: JSON.stringify({ forms: [], hasCaptcha: false, errorText: "", text: "", title: "", ...info }),
  ...extra
});
const redirect = (location, headers = {}, status = 302) => ({ status, headers: { location, ...headers }, data: "" });

const loginForm = {
  action: MY + "/login",
  method: "POST",
  fields: [
    field({ name: "token", type: "hidden", value: "T" }),
    field({ name: "username", id: "inputEmail", type: "email" }),
    field({ name: "password", id: "inputPassword", type: "password" }),
    field({ name: "rememberme", type: "checkbox" }),
    field({ name: "decoy", value: "x", disabled: true })
  ],
  buttons: [{ name: "login", value: "Connexion", type: "submit", label: "Se connecter" }]
};

const consentForm = {
  action: MY + "/oauth/authorize",
  method: "POST",
  fields: [field({ name: "state", type: "hidden", value: "S" })],
  buttons: [
    { name: "deny", value: "0", type: "submit", label: "Refuser" },
    { name: "authorize", value: "1", type: "submit", label: "Autoriser" }
  ]
};

const base = {
  [`GET ${IA}/api/auth/csrf`]: json({ csrfToken: "tok" }, { headers: { "set-cookie": ["next-auth.csrf-token=abc; Path=/"] } }),
  [`POST ${IA}/api/auth/signin/whmcs`]: json({ url: MY + "/oauth/authorize?x=1" }),
  [`GET ${MY}/oauth/authorize?x=1`]: redirect("/login", { "set-cookie": ["WHMCS=sess1; path=/"] }),
  [`GET ${MY}/login`]: html({ forms: [loginForm] }),
  [`POST ${MY}/login`]: redirect(IA + "/api/auth/callback/whmcs?code=1"),
  [`GET ${IA}/api/auth/callback/whmcs?code=1`]: redirect("/", { "set-cookie": ["next-auth.session-token=SESSIONVALUE; Path=/; HttpOnly"] })
};

function server(overrides = {}) {
  const log = [];
  const routes = { ...base, ...overrides };
  const http = async input => {
    log.push(input);
    const route = routes[`${input.method} ${input.url}`];
    if (!route) throw new Error(`route inconnue ${input.method} ${input.url}`);
    return typeof route === "function" ? route(input, log) : route;
  };
  return { log, deps: { http, readPage: data => JSON.parse(data) } };
}

const header = (input, name) => Object.entries(input.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const attempt = overrides => {
  const s = server(overrides);
  return { s, run: () => loginWithPassword(s.deps, "lea@exemple.fr", "s3cret") };
};
const rejectsAuth = async (run, pattern) =>
  assert.rejects(run(), error => error instanceof AuthError && error.auth === true && pattern.test(error.message), String(pattern));

// --- storeCookies -------------------------------------------------------------
await test("storeCookies : tableau, chaîne jointe par virgules, suppression", () => {
  const jar = new Map();
  storeCookies({ "Set-Cookie": ["a=1; Path=/", "b=2; Secure"] }, jar);
  assert.deepEqual([...jar], [["a", "1"], ["b", "2"]]);
  storeCookies({ "set-cookie": "c=3; Expires=Wed, 21 Oct 2030 07:28:00 GMT, d=4; Path=/" }, jar);
  assert.equal(jar.get("c"), "3");
  assert.equal(jar.get("d"), "4");
  assert.equal(jar.size, 4);
  storeCookies({ "set-cookie": ["a=; Path=/", "b=2; Max-Age=0", "c=3; max-age=-1; Path=/"] }, jar);
  assert.deepEqual([...jar], [["d", "4"]]);
  storeCookies({}, jar);
  storeCookies({ "set-cookie": ["=oublié", "sansvaleur"] }, jar);
  assert.deepEqual([...jar], [["d", "4"]]);
});

// --- chemin nominal -----------------------------------------------------------
await test("connexion réussie : renvoie le cookie de session", async () => {
  const { s, run } = attempt();
  assert.equal(await run(), "SESSIONVALUE");
  assert.deepEqual(s.log.map(r => `${r.method} ${r.url}`), [
    `GET ${IA}/api/auth/csrf`,
    `POST ${IA}/api/auth/signin/whmcs`,
    `GET ${MY}/oauth/authorize?x=1`,
    `GET ${MY}/login`,
    `POST ${MY}/login`,
    `GET ${IA}/api/auth/callback/whmcs?code=1`
  ]);
});

await test("en-têtes : navigateur imité, Referer, Origin et jeton CSRF", async () => {
  const { s, run } = attempt();
  await run();
  const [csrf, signin, authorize, loginPage, post, callback] = s.log;
  for (const request of s.log) {
    assert.equal(header(request, "User-Agent"), USER_AGENT);
    assert.match(header(request, "Accept-Language"), /^fr-FR/);
  }
  assert.equal(header(csrf, "Accept"), "application/json");
  assert.equal(header(signin, "Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(header(signin, "Origin"), IA);
  assert.equal(header(signin, "X-Auth-Return-Redirect"), "1");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(signin.data)), { csrfToken: "tok", callbackUrl: "/" });
  assert.equal(header(authorize, "Referer"), IA + "/");
  assert.equal(header(loginPage, "Referer"), MY + "/oauth/authorize?x=1");
  assert.equal(header(post, "Referer"), MY + "/login");
  assert.equal(header(post, "Origin"), MY);
  assert.equal(header(post, "Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(header(callback, "Referer"), MY + "/login");
});

await test("cookies cloisonnés par hôte", async () => {
  const { s, run } = attempt();
  await run();
  const [csrf, signin, authorize, loginPage, post, callback] = s.log;
  assert.equal(header(csrf, "Cookie"), undefined);
  assert.equal(header(signin, "Cookie"), "next-auth.csrf-token=abc");
  assert.equal(header(authorize, "Cookie"), undefined, "le cookie du site ne part pas vers le fournisseur");
  assert.equal(header(loginPage, "Cookie"), "WHMCS=sess1");
  assert.equal(header(post, "Cookie"), "WHMCS=sess1");
  assert.equal(header(callback, "Cookie"), "next-auth.csrf-token=abc");
});

await test("corps du formulaire : champs cachés conservés, champs inertes écartés", async () => {
  const { s, run } = attempt();
  await run();
  const post = s.log.find(r => r.method === "POST" && r.url === MY + "/login");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(post.data)), {
    token: "T",
    username: "lea@exemple.fr",
    password: "s3cret",
    login: "Connexion"
  });
});

await test("le mot de passe ne sort que vers l'hôte du fournisseur", async () => {
  const { s, run } = attempt();
  await run();
  for (const request of s.log) {
    if (request.data?.includes("s3cret")) assert.equal(new URL(request.url).host, "my.francestudent.org");
  }
  assert.equal(s.log.filter(r => r.data?.includes("s3cret")).length, 1);
});

await test("champ identifiant choisi par nom, sinon premier champ texte", async () => {
  const form = {
    ...loginForm,
    fields: [
      field({ name: "search", type: "text" }),
      field({ name: "login_id", id: "x", type: "text" }),
      field({ name: "pw", type: "password" })
    ],
    buttons: []
  };
  const { s, run } = attempt({ [`GET ${MY}/login`]: html({ forms: [form] }) });
  await run();
  const post = s.log.find(r => r.method === "POST" && r.url === MY + "/login");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(post.data)), { search: "", login_id: "lea@exemple.fr", pw: "s3cret" });
});

// --- consentement -------------------------------------------------------------
await test("page de consentement acceptée automatiquement", async () => {
  const { s, run } = attempt({
    [`POST ${MY}/login`]: redirect("/consent"),
    [`GET ${MY}/consent`]: html({ forms: [consentForm] }),
    [`POST ${MY}/oauth/authorize`]: redirect(IA + "/api/auth/callback/whmcs?code=1")
  });
  assert.equal(await run(), "SESSIONVALUE");
  const post = s.log.find(r => r.url === MY + "/oauth/authorize" && r.method === "POST");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(post.data)), { state: "S", authorize: "1" });
  assert.equal(header(post, "Origin"), MY);
});

await test("formulaire de consentement en GET : champs placés dans l'adresse", async () => {
  const getForm = { ...consentForm, method: "GET" };
  const { s, run } = attempt({
    [`POST ${MY}/login`]: redirect("/consent"),
    [`GET ${MY}/consent`]: html({ forms: [getForm] }),
    [`GET ${MY}/oauth/authorize?state=S&authorize=1`]: redirect(IA + "/api/auth/callback/whmcs?code=1")
  });
  assert.equal(await run(), "SESSIONVALUE");
  assert.ok(s.log.some(r => r.url === MY + "/oauth/authorize?state=S&authorize=1"));
});

// --- refus et blocages --------------------------------------------------------
await test("identifiants refusés, avec ou sans message du site", async () => {
  const again = (errorText) => ({
    [`POST ${MY}/login`]: redirect("/login?error=1"),
    [`GET ${MY}/login?error=1`]: html({ forms: [loginForm], errorText })
  });
  await rejectsAuth(attempt(again("Mot de passe incorrect")).run, /^Identifiants refusés : Mot de passe incorrect$/);
  await rejectsAuth(attempt(again("")).run, /^Identifiants refusés\.$/);
});

await test("captcha : aucune soumission du mot de passe", async () => {
  const { s, run } = attempt({ [`GET ${MY}/login`]: html({ forms: [loginForm], hasCaptcha: true }) });
  await rejectsAuth(run, /captcha/);
  assert.ok(!s.log.some(r => r.data?.includes("s3cret")));
});

await test("double authentification détectée après soumission seulement", async () => {
  const twoFactor = { [`POST ${MY}/login`]: redirect("/2fa"), [`GET ${MY}/2fa`]: html({ text: "Entrez votre code de vérification" }) };
  await rejectsAuth(attempt(twoFactor).run, /Double authentification/);
  const before = { [`GET ${MY}/login`]: html({ forms: [], text: "Entrez votre code de vérification", title: "Page" }) };
  await rejectsAuth(attempt(before).run, /Page inattendue/);
});

await test("Cloudflare : en-tête de défi ou page d'attente", async () => {
  await rejectsAuth(attempt({ [`GET ${MY}/login`]: html({}, { headers: { "cf-mitigated": "challenge" } }) }).run, /Cloudflare/);
  await rejectsAuth(attempt({ [`GET ${MY}/login`]: { status: 403, headers: {}, data: "Just a moment..." } }).run, /Cloudflare/);
});

await test("erreur HTTP de la page de connexion", async () => {
  await rejectsAuth(attempt({ [`GET ${MY}/login`]: { status: 500, headers: {}, data: "oups" } }).run, /HTTP 500/);
  await rejectsAuth(attempt({ [`GET ${MY}/login`]: { status: 403, headers: {}, data: "interdit" } }).run, /HTTP 403/);
});

await test("jeton CSRF absent ou refusé", async () => {
  await rejectsAuth(attempt({ [`GET ${IA}/api/auth/csrf`]: json({}) }).run, /Jeton CSRF non reçu \(HTTP 200\)/);
  await rejectsAuth(attempt({ [`GET ${IA}/api/auth/csrf`]: json({ csrfToken: "x" }, { status: 403 }) }).run, /Jeton CSRF non reçu \(HTTP 403\)/);
  await rejectsAuth(attempt({ [`GET ${IA}/api/auth/csrf`]: { status: 200, headers: {}, data: "<html>" } }).run, /Jeton CSRF/);
});

await test("adresse d'autorisation absente ou donnée par l'en-tête Location", async () => {
  await rejectsAuth(attempt({ [`POST ${IA}/api/auth/signin/whmcs`]: json({}) }).run, /Adresse de connexion non reçue \(HTTP 200\)/);
  const { run } = attempt({ [`POST ${IA}/api/auth/signin/whmcs`]: redirect(MY + "/oauth/authorize?x=1") });
  assert.equal(await run(), "SESSIONVALUE");
});

await test("boucle de redirections bornée à 15", async () => {
  const { s, run } = attempt({ [`GET ${MY}/login`]: redirect("/login") });
  await rejectsAuth(run, /Trop de redirections/);
  assert.ok(s.log.length < 30, `trop de requêtes : ${s.log.length}`);
});

await test("page inattendue : hôte, statut et titre dans le message", async () => {
  await rejectsAuth(
    attempt({ [`GET ${MY}/login`]: html({ title: "Maintenance", text: "Revenez plus tard" }) }).run,
    /^Page inattendue pendant la connexion \(my\.francestudent\.org, HTTP 200, « Maintenance »\)\.$/
  );
  await rejectsAuth(attempt({ [`GET ${MY}/login`]: html({}) }).run, /HTTP 200\)\.$/);
});

await test("connexion incomplète quand le cookie n'arrive jamais", async () => {
  const loop = { action: MY + "/consent", method: "POST", fields: [], buttons: [{ name: "", value: "", type: "submit", label: "Accepter" }] };
  const { s, run } = attempt({
    [`POST ${MY}/login`]: redirect("/consent"),
    [`GET ${MY}/consent`]: html({ forms: [loop] }),
    [`POST ${MY}/consent`]: html({ forms: [loop] })
  });
  await rejectsAuth(run, /Connexion incomplète/);
  assert.ok(s.log.length < 20);
});

await test("panne réseau : message explicite, erreur ordinaire", async () => {
  const { run } = attempt({
    [`GET ${IA}/api/auth/csrf`]: () => { throw new Error("délai dépassé"); }
  });
  await assert.rejects(run(), error => !(error instanceof AuthError) && error.message === "Réseau indisponible : délai dépassé");
  const text = attempt({ [`GET ${IA}/api/auth/csrf`]: () => { throw "coupé"; } });
  await assert.rejects(text.run(), /^Error: Réseau indisponible : coupé$/);
});

await test("corps non textuel converti en texte", async () => {
  const { run } = attempt({ [`GET ${IA}/api/auth/csrf`]: { status: 200, headers: {}, data: { csrfToken: "obj" } } });
  assert.equal(await run(), "SESSIONVALUE");
});

console.log(`test-svelte-login : ${count} tests réussis`);
