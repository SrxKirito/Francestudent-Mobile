import type { PageForm, PageInfo } from "./login.ts";

/**
 * Adaptateur DOM (WebView) : transforme une page HTML en `PageInfo`.
 * Ordre repris de login.js : la bannière d'erreur et le captcha sont lus avant le retrait des scripts.
 * Non exécutable sous Node (pas de DOMParser) : vérifié par `svelte-check`, à valider sur appareil.
 */
export function readPageFromHtml(html: string, baseUrl: string): PageInfo {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const forms: PageForm[] = [...doc.querySelectorAll("form")].map(form => {
    let action: string;
    try {
      action = new URL(form.getAttribute("action") || "", baseUrl).toString();
    } catch {
      action = baseUrl;
    }
    return {
      action,
      method: (form.getAttribute("method") || "get").toUpperCase(),
      fields: [...form.querySelectorAll("input")].map(input => ({
        name: input.getAttribute("name") || "",
        id: input.id || "",
        type: (input.getAttribute("type") || "text").toLowerCase(),
        value: input.getAttribute("value") || "",
        checked: input.hasAttribute("checked"),
        disabled: input.hasAttribute("disabled")
      })),
      buttons: [...form.querySelectorAll("button")].map(button => ({
        name: button.getAttribute("name") || "",
        value: button.getAttribute("value") || "",
        type: (button.getAttribute("type") || "submit").toLowerCase(),
        label: (button.textContent || "").replace(/\s+/g, " ").trim()
      }))
    };
  });

  const hasCaptcha = Boolean(doc.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile"));
  const alert = doc.querySelector(".alert-danger, .alert-error, .login-error, .errorbox");
  const errorText = alert ? (alert.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : "";

  doc.querySelectorAll("script, style, template, noscript").forEach(node => node.remove());
  const text = (doc.body ? doc.body.textContent || "" : "").replace(/\s+/g, " ").trim();

  return { forms, hasCaptcha, errorText, text, title: doc.title || "" };
}
