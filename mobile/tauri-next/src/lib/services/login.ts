import { ORIGIN, SESSION_COOKIE, USER_AGENT } from "../config.ts";
import type { LoginInput, LoginOutput } from "../types/api.ts";
import { AuthError } from "./auth.ts";

// Port de la connexion par e-mail / mot de passe de mobile/www/js/login.js.
// Le site n'expose pas d'API : on rejoue le parcours OAuth WHMCS (csrf, signin, formulaires, consentement).
// Les requêtes passent par la commande Rust `legacy_login`, qui impose la liste des hôtes autorisés.

const MAX_REDIRECTS = 15;
const MAX_PAGE_STEPS = 6;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const VISIBLE_TEXT_TYPES = ["text", "email", "tel", ""];
const SKIPPED_TYPES = ["password", "submit", "button", "image", "file", "reset"];

export interface PageField {
  name: string;
  id: string;
  type: string;
  value: string;
  checked: boolean;
  disabled: boolean;
}

export interface PageButton {
  name: string;
  value: string;
  type: string;
  label: string;
}

export interface PageForm {
  action: string;
  method: string;
  fields: PageField[];
  buttons: PageButton[];
}

/** Ce que le flux a besoin de savoir d'une page HTML ; produit par `readPageFromHtml` (DOM) ou par un faux en test. */
export interface PageInfo {
  forms: PageForm[];
  hasCaptcha: boolean;
  /** Texte du bandeau d'erreur de la page de connexion, déjà normalisé et borné à 200 caractères. */
  errorText: string;
  /** Texte visible de la page (sans script ni style), espaces normalisés. */
  text: string;
  title: string;
}

export interface LoginDeps {
  http(input: LoginInput): Promise<LoginOutput>;
  readPage(html: string, baseUrl: string): PageInfo;
}

interface PageResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  url: string;
}

type Jar = Map<string, string>;

interface RequestOptions {
  method?: string;
  data?: string;
  headers?: Record<string, string>;
  referer?: string;
}

interface LoginSession {
  request(url: string, options?: RequestOptions): Promise<PageResponse>;
  jarFor(host: string): Jar;
}

function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string | string[] {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name);
  return key === undefined || !headers ? "" : headers[key];
}

function headerText(headers: Record<string, string | string[]>, name: string): string {
  const value = headerValue(headers, name);
  return Array.isArray(value) ? value[0] ?? "" : value;
}

/** Mémorise les cookies d'une réponse ; une valeur vide ou `Max-Age=0` supprime le cookie. */
export function storeCookies(headers: Record<string, string | string[]>, jar: Jar): void {
  const raw = headerValue(headers, "set-cookie");
  const lines = (Array.isArray(raw) ? raw : [raw]).flatMap(v => String(v || "").split(/,(?=\s*[^;,=\s]+=)/));
  for (const line of lines) {
    const pair = line.split(";")[0];
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value || /max-age=(0|-\d+)\s*(;|$)/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

function createLoginSession(deps: LoginDeps): LoginSession {
  const jars = new Map<string, Jar>();
  const jarFor = (host: string): Jar => {
    let jar = jars.get(host);
    if (!jar) {
      jar = new Map();
      jars.set(host, jar);
    }
    return jar;
  };

  async function request(url: string, { method = "GET", data, headers = {}, referer }: RequestOptions = {}): Promise<PageResponse> {
    const target = new URL(url);
    const jar = jarFor(target.host);
    const cookie = [...jar].map(([name, value]) => name + "=" + value).join("; ");
    let response: LoginOutput;
    try {
      response = await deps.http({
        url: target.toString(),
        method,
        data,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          Referer: referer || ORIGIN + "/",
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers
        }
      });
    } catch (error) {
      const message = (error as { message?: unknown } | null)?.message;
      throw new Error("Réseau indisponible : " + (message ? String(message) : String(error)));
    }
    storeCookies(response.headers, jar);
    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
    return { status: Number(response.status) || 0, headers: response.headers || {}, body, url: target.toString() };
  }

  return { request, jarFor };
}

function parseJson(response: PageResponse): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(response.body);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function followRedirects(session: LoginSession, response: PageResponse, stop: () => boolean): Promise<PageResponse> {
  let current = response;
  let hops = 0;
  while (!stop() && REDIRECT_STATUSES.includes(current.status)) {
    const location = headerText(current.headers, "location");
    if (!location) break;
    if (++hops > MAX_REDIRECTS) throw new AuthError("Trop de redirections pendant la connexion.");
    current = await session.request(new URL(location, current.url).toString(), { referer: current.url });
  }
  return current;
}

async function startOAuth(session: LoginSession): Promise<string> {
  const csrf = await session.request(ORIGIN + "/api/auth/csrf", { headers: { Accept: "application/json" } });
  const csrfToken = csrf.status === 200 && (parseJson(csrf) || {}).csrfToken;
  if (!csrfToken) throw new AuthError("Jeton CSRF non reçu (HTTP " + csrf.status + ").");

  const response = await session.request(ORIGIN + "/api/auth/signin/whmcs", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: ORIGIN,
      "X-Auth-Return-Redirect": "1"
    },
    data: new URLSearchParams({ csrfToken: String(csrfToken), callbackUrl: "/" }).toString()
  });
  const target = headerText(response.headers, "location") || (parseJson(response) || {}).url;
  if (!target) throw new AuthError("Adresse de connexion non reçue (HTTP " + response.status + ").");
  return new URL(String(target), ORIGIN).toString();
}

interface LoginForm {
  form: PageForm;
  username: PageField;
  password: PageField;
}

function findLoginForm(forms: PageForm[]): LoginForm | null {
  for (const form of forms) {
    const password = form.fields.find(f => f.type === "password" && f.name);
    const candidates = form.fields.filter(f => VISIBLE_TEXT_TYPES.includes(f.type) && f.name && !f.disabled);
    if (!password || !candidates.length) continue;
    const username = candidates.find(f => /user|mail|login|ident/i.test(f.name + " " + f.id)) || candidates[0];
    return { form, username, password };
  }
  return null;
}

function formBody(form: PageForm, skip: PageField[]): URLSearchParams {
  const body = new URLSearchParams();
  for (const field of form.fields) {
    if (!field.name || field.disabled || skip.includes(field)) continue;
    if (SKIPPED_TYPES.includes(field.type)) continue;
    if ((field.type === "checkbox" || field.type === "radio") && !field.checked) continue;
    body.append(field.name, field.type === "checkbox" && field.value === "" ? "on" : field.value);
  }
  return body;
}

function buildLoginBody({ form, username, password }: LoginForm, email: string, secret: string): URLSearchParams {
  const body = formBody(form, [username, password]);
  body.set(username.name, email);
  body.set(password.name, secret);
  const submitter = form.fields.find(f => f.type === "submit" && f.name) || form.buttons.find(b => b.type === "submit" && b.name);
  if (submitter) body.set(submitter.name, submitter.value);
  return body;
}

function findConsentForm(forms: PageForm[]): { form: PageForm; body: URLSearchParams } | null {
  for (const form of forms) {
    if (form.fields.some(f => (VISIBLE_TEXT_TYPES.includes(f.type) && f.name && !f.disabled) || f.type === "password")) continue;
    const submitters = [
      ...form.fields.filter(f => f.type === "submit").map(f => ({ name: f.name, value: f.value, label: f.value })),
      ...form.buttons.filter(b => b.type === "submit").map(b => ({ name: b.name, value: b.value, label: b.label }))
    ];
    const accept = submitters.find(s => /autoris|authori[sz]e|approve|allow|accepter|accept/i.test(s.name + " " + s.value + " " + s.label));
    if (accept) {
      const body = formBody(form, []);
      if (accept.name) body.set(accept.name, accept.value);
      return { form, body };
    }
  }
  return null;
}

function checkPage(response: PageResponse): void {
  const blocked = headerText(response.headers, "cf-mitigated") === "challenge" ||
    ([403, 429, 503].includes(response.status) && /just a moment|cf-chl|attention required|cloudflare/i.test(response.body));
  if (blocked) throw new AuthError("Cloudflare bloque la connexion automatique. Utilise le cookie de session.");
  if (response.status >= 400) throw new AuthError("La page de connexion a répondu HTTP " + response.status + ".");
}

async function submitForm(
  session: LoginSession,
  form: PageForm,
  body: URLSearchParams,
  referer: string,
  stop: () => boolean
): Promise<PageResponse> {
  const post = form.method === "POST";
  const target = new URL(form.action);
  if (!post) body.forEach((value, name) => target.searchParams.set(name, value));
  const response = await session.request(target.toString(), {
    method: post ? "POST" : "GET",
    referer,
    data: post ? body.toString() : undefined,
    headers: post ? { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(referer).origin } : {}
  });
  return followRedirects(session, response, stop);
}

const TWO_FACTOR = /double authentification|authentification (?:à|a) deux|two-?factor|\b2fa\b|code de v[ée]rification|authenticator|totp/i;

/** Renvoie la valeur du cookie de session `next-auth.session-token`, ou lève une `AuthError` explicite. */
export async function loginWithPassword(deps: LoginDeps, email: string, password: string): Promise<string> {
  const session = createLoginSession(deps);
  const jar = session.jarFor(new URL(ORIGIN).host);
  const stop = (): boolean => jar.has(SESSION_COOKIE);

  const authorizeUrl = await startOAuth(session);
  let response = await followRedirects(session, await session.request(authorizeUrl), stop);
  let submitted = false;

  for (let step = 0; step < MAX_PAGE_STEPS && !stop(); step++) {
    checkPage(response);
    const page = deps.readPage(response.body, response.url);
    const loginForm = findLoginForm(page.forms);

    if (loginForm) {
      if (submitted) {
        throw new AuthError("Identifiants refusés" + (page.errorText ? " : " + page.errorText : "."));
      }
      if (page.hasCaptcha) {
        throw new AuthError("La page de connexion demande un captcha. Utilise le cookie de session.");
      }
      submitted = true;
      response = await submitForm(session, loginForm.form, buildLoginBody(loginForm, email, password), response.url, stop);
      continue;
    }

    if (submitted && TWO_FACTOR.test(page.text)) {
      throw new AuthError("Double authentification requise : non prise en charge. Utilise le cookie de session.");
    }

    const consent = findConsentForm(page.forms);
    if (consent) {
      response = await submitForm(session, consent.form, consent.body, response.url, stop);
      continue;
    }

    const title = page.title.trim().slice(0, 80);
    throw new AuthError(
      "Page inattendue pendant la connexion (" + new URL(response.url).host + ", HTTP " + response.status + (title ? ", « " + title + " »" : "") + ")."
    );
  }

  const value = jar.get(SESSION_COOKIE);
  if (!value) throw new AuthError("Connexion incomplète : le cookie de session n'a pas été reçu.");
  return value;
}
