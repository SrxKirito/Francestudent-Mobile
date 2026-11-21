// Service de streaming du chat — port typé de mobile/www/js/stream.js.
//
// Périmètre : tout ce qui transforme un flux SSE en texte, sources et images, sans toucher au DOM,
// aux globales (`store`, `apiFetch`, `stopRequested`…) ni à Capacitor. Les dépendances arrivent par
// paramètres, ce qui permet de tester le service sous Node en le comparant au code d'origine
// (test-svelte-chat-stream.mjs).
//
// Hors périmètre (reste dans le moteur legacy) : construction du payload et envoi des pièces jointes,
// image source précédente, récupération iOS/arrière-plan (`streamChat`), téléchargement des images
// (`fetchGeneratedImage`), rendu DOM. Ce service n'est branché nulle part.
//
// Syntaxe TypeScript « effaçable » uniquement : Node exécute ce fichier tel quel dans les tests.

import type {
  GeneratedImage,
  ProcessChatStreamOptions,
  SseHandler,
  SseParser,
  StreamError,
  StreamEvent,
  StreamSource
} from "../types/chat-stream";

// Les données du flux sont du JSON de forme libre, parcouru de façon défensive comme dans l'original.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPE_RE = /image_generation|imagegeneration|generated[_-]?image|output_image|^image$|^image_file$/i;
const IMAGE_ID_KEYS = ["imageId", "image_id", "generatedImageId", "generated_image_id", "fileId", "file_id"];
const RAW_IMAGE_RE = /^(data:image\/[\w.+-]+;base64,|iVBORw0KGgo|\/9j\/|UklGR|R0lGOD)/;

/** Chemin de reprise d'un flux interrompu (`GET`), curseur absent s'il est vide. */
export function resumeStreamPath(chatId: string, lastEventId?: string): string {
  return "/chats/" + encodeURIComponent(chatId) + "/stream" + (lastEventId ? "?last_event_id=" + encodeURIComponent(lastEventId) : "");
}

/** Analyseur Server-Sent Events : accepte des morceaux découpés n'importe où, \n ou \r\n. */
export function createSseParser(onEvent: SseHandler): SseParser {
  let buffer = "";
  let name = "";
  let data: string[] = [];
  let eventId = "";
  let explicitId = false;

  function dispatch(): void {
    const payload = data.join("\n");
    const eventName = name;
    name = "";
    data = [];
    if (payload) onEvent(eventName, payload, eventId, explicitId);
    explicitId = false;
  }

  function handleLine(line: string): void {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const index = line.indexOf(":");
    const field = index < 0 ? line : line.slice(0, index);
    let value = index < 0 ? "" : line.slice(index + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id" && !value.includes("\0")) {
      eventId = value;
      explicitId = true;
    }
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }

  return {
    feed(chunk: string): void {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        handleLine(line);
      }
    },
    end(): void {
      if (buffer) {
        handleLine(buffer.replace(/\r$/, ""));
        buffer = "";
      }
      dispatch();
    }
  };
}

export function describeStreamError(error: unknown): string {
  if (!error) return "Erreur inconnue.";
  if (typeof error === "string") return error;
  const e = error as Loose;
  if (e.message) return String(e.message);
  if (e.error && e.error.message) return String(e.error.message);
  return (JSON.stringify(error) ?? "").slice(0, 500);
}

/**
 * Message d'erreur lisible. `online` remplace `navigator.onLine` : le service ne lit pas les globales.
 * Seul `false` signifie « hors ligne » (comme l'original).
 */
export function friendlyError(error: unknown, online?: boolean): string {
  const e = (error || {}) as Loose;
  const raw = error && e.message ? String(e.message) : String(error || "");
  if (error && e.auth) return raw || "Session expirée : reconnecte-toi.";
  if (error && e.upload) return raw || "L'envoi de la pièce jointe a été refusé par le serveur.";
  if (online === false) {
    return "Pas de connexion Internet. Vérifie ton Wi-Fi ou tes données mobiles, puis appuie sur « Réessayer ». Ton message est conservé.";
  }
  if ((error && e.name === "TypeError") || /failed to fetch|networkerror|network request|load failed|réseau indisponible|timeout|timed out/i.test(raw)) {
    return "Impossible de joindre le serveur. Vérifie ta connexion Internet, puis appuie sur « Réessayer ». Ton message est conservé.";
  }
  const code = String((error && e.code) || "") + " " + String((error && e.type) || "");
  if (/moderation_blocked|CONTENT_POLICY_VIOLATION|image_generation_user_error/i.test(code + " " + raw)) {
    const stage = error && e.moderation && e.moderation.moderation_stage;
    if (stage === "output") return "L'image générée a été bloquée par un contrôle de sécurité. Modifie ta demande, puis réessaie.";
    return "Cette demande n'a pas pu être traitée, car elle ne respecte pas les règles de sécurité. Reformule-la, puis réessaie.";
  }
  if (/insufficient_quota|quota exceeded|billing/i.test(code + " " + raw)) {
    return "Le quota du service est épuisé pour le moment. Réessayer tout de suite ne servira à rien : patiente ou contacte l'administrateur.";
  }
  if (/at capacity|overloaded|server_is_overloaded|\b429\b|rate.?limit|too many requests/i.test(raw + " " + code)) {
    return "Ce modèle est saturé pour le moment. Réessaie dans quelques instants avec « Réessayer », ou choisis un autre modèle. Ton message est conservé.";
  }
  if (/\b50[234]\b|BAD_GATEWAY|SERVICE_UNAVAILABLE|GATEWAY_TIMEOUT/i.test(raw)) {
    return "Le fournisseur du modèle ne répond pas pour le moment. Réessaie dans un instant ou choisis un autre modèle. Ton message est conservé.";
  }
  let status = error ? Number(e.status) : 0;
  if (!status) {
    const match = raw.match(/HTTP (\d{3})/);
    status = match ? Number(match[1]) : 0;
  }
  if (status === 401 || status === 403) return "Accès refusé par le serveur (HTTP " + status + "). Reconnecte-toi puis réessaie.";
  if (status === 413) return "Le message ou la pièce jointe est trop volumineux (HTTP 413).";
  if (status === 429) return "Trop de requêtes en peu de temps (HTTP 429). Patiente quelques instants, puis réessaie.";
  if (status >= 500) return "Le serveur rencontre un problème (HTTP " + status + "). Réessaie dans un instant.";
  return "La réponse n'a pas pu être générée : " + (raw || "erreur inconnue.");
}

/**
 * Ajoute à `sources` les sites trouvés dans un événement (web_search_call, url_citation, listes de
 * domaines…). `keys` déduplique entre événements. Renvoie vrai si au moins une source a été ajoutée.
 */
export function collectSourceUrls(data: unknown, sources: StreamSource[], keys: Set<string>): boolean {
  let added = false;
  const addUrl = (raw: unknown, title: unknown): void => {
    let url = String(raw || "").trim();
    if (!url || url.length > 2048 || url.indexOf(" ") >= 0) return;
    const lower = url.toLowerCase();
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      // Domaine nu (ex. webSearchDomains du ChatMessage) : lemonde.fr
      if (!/^[a-z0-9.-]+[.][a-z]{2,}$/i.test(url)) return;
      url = "https://" + url;
    }
    let host = "";
    try { host = new URL(url).hostname.replace(/^www[.]/i, ""); } catch { return; }
    if (!host || host.indexOf(".") < 0) return;
    const key = url.split("#")[0].split("?")[0].replace(/[/]$/, "").toLowerCase();
    if (keys.has(key)) return;
    keys.add(key);
    sources.push({ url, title: typeof title === "string" ? title.trim() : "", host });
    added = true;
  };
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 10 || sources.length >= 40) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const obj = node as Loose;
    if (typeof obj.url === "string") addUrl(obj.url, obj.title);
    else if (typeof obj.uri === "string") addUrl(obj.uri, obj.title);
    for (const name of Object.keys(obj)) {
      const value = obj[name];
      // webSearchDomains, sources, links, citations : listes de chaînes (URL ou domaines).
      if (Array.isArray(value) && /domain|source|url|link|citation/i.test(name)) {
        for (const item of value) if (typeof item === "string") addUrl(item, "");
      }
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(data, 0);
  return added;
}

/** Clé unique d'une image générée (base64, identifiant ou URL). */
export function generatedImageKey(image: GeneratedImage | null | undefined): string {
  if (!image) return "";
  if (image.data) return "d:" + image.data.length + ":" + image.data.slice(-40);
  if (image.id) return "i:" + image.id;
  return image.url ? "u:" + image.url : "";
}

function rawImageDataUrl(value: string): string {
  if (value.startsWith("data:")) return value;
  const mime = value.startsWith("/9j/") ? "image/jpeg" : value.startsWith("UklGR") ? "image/webp" : value.startsWith("R0lGOD") ? "image/gif" : "image/png";
  return "data:" + mime + ";base64," + value;
}

// Détection typée : base64, identifiant (UUID) ou URL, quel que soit le format renvoyé.
function collectGeneratedImagesCore(root: unknown): GeneratedImage[] {
  const out: GeneratedImage[] = [];
  const seen = new Set<string>();
  const push = (image: GeneratedImage): void => {
    const key = generatedImageKey(image);
    if (key && !seen.has(key)) { seen.add(key); out.push(image); }
  };
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === "string" && depth <= 10 && /^[\s]*[\[{]/.test(value)) {
      try { walk(JSON.parse(value), depth + 1); } catch {}
      return;
    }
    if (!value || typeof value !== "object" || depth > 10) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    const node = value as Loose;
    const type = typeof node.type === "string" ? node.type : "";
    if (/partial|input/i.test(type) || /^(user|system)$/i.test(node.role || "")) return;
    if (IMAGE_TYPE_RE.test(type) || /image.?generation/i.test(node.toolName || node.tool_name || "") || /^image\//i.test(node.mimeType || node.mime_type || "") || IMAGE_ID_KEYS.some(key => typeof node[key] === "string")) {
      const raw = [node.result, node.b64_json, node.image_base64, node.base64, node.imageData, node.data]
        .find(v => typeof v === "string" && v.length > 200 && !UUID_RE.test(v)) || "";
      const imageUrl = node.image_url && typeof node.image_url === "object" ? node.image_url.url : node.image_url;
      const url = [node.url, imageUrl, node.imageUrl, node.src].find(v => typeof v === "string" && /^(https?:|data:image\/|\/)/i.test(v));
      const candidates: unknown[] = IMAGE_ID_KEYS.map(k => node[k])
        .concat([typeof node.result === "string" ? node.result : null, type !== "image_generation_call" ? node.id : null]);
      const id = candidates.find(v => typeof v === "string" && UUID_RE.test(v)) as string | undefined;
      if (raw) push({ data: raw.startsWith("data:") ? raw : "data:image/png;base64," + raw });
      else if (id) push({ id });
      else if (url) push({ url });
    } else {
      for (const k of ["imageId", "image_id", "generatedImageId", "generated_image_id"]) {
        if (typeof node[k] === "string" && UUID_RE.test(node[k])) push({ id: node[k] });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "result" || key === "b64_json" || key === "partial_image_b64") continue;
      if (key === "images" && Array.isArray(node[key])) {
        for (const image of node[key]) {
          if (typeof image === "string" && UUID_RE.test(image)) push({ id: image });
          else if (typeof image === "string" && /^(https?:|data:image\/|\/)/i.test(image)) push({ url: image });
          else if (image && typeof image === "object") walk({ ...image, type: image.type || "generated_image" }, depth + 1);
        }
        continue;
      }
      walk(node[key], depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Images générées d'un événement ou d'un message : détection typée, puis, si aucune n'a de contenu
 * direct, base64 brut sous n'importe quelle clé (hors images partielles ou envoyées par l'utilisateur).
 */
export function collectGeneratedImages(root: unknown): GeneratedImage[] {
  const out = collectGeneratedImagesCore(root);
  if (out.some(image => image.data)) return out;
  const seen = new Set(out.map(generatedImageKey));
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === "string" && depth <= 10 && /^[\s]*[\[{]/.test(value)) {
      try { walk(JSON.parse(value), depth + 1); } catch {}
      return;
    }
    if (!value || typeof value !== "object" || depth > 10) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    const node = value as Loose;
    if (typeof node.type === "string" && /partial|input/i.test(node.type)) return;
    if (typeof node.role === "string" && /user|system/i.test(node.role)) return;
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (/partial|input/i.test(key)) continue;
      if (typeof child === "string") {
        if (child.length > 200 && RAW_IMAGE_RE.test(child)) {
          const image = { data: rawImageDataUrl(child) };
          const k = generatedImageKey(image);
          if (!seen.has(k)) { seen.add(k); out.push(image); }
        }
      } else if (child && typeof child === "object") {
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Résumé court de la forme d'un objet (clés et types, sans le contenu), pour le diagnostic. */
export function describeShape(node: unknown, depth?: number): string {
  depth = depth || 0;
  if (node === null || node === undefined) return String(node);
  if (typeof node === "string") return UUID_RE.test(node) ? "uuid" : node.length > 60 ? "str(" + node.length + ")" : JSON.stringify(node);
  if (typeof node !== "object") return String(node);
  if (depth > 3) return Array.isArray(node) ? "[…]" : "{…}";
  const level = depth;
  if (Array.isArray(node)) return "[" + node.slice(0, 4).map(v => describeShape(v, level + 1)).join(",") + (node.length > 4 ? ",…" : "") + "]";
  const obj = node as Loose;
  return "{" + Object.keys(obj).slice(0, 12).map(k => k + ":" + describeShape(obj[k], level + 1)).join(",") + "}";
}

/** Tous les UUID d'un objet (6 au plus), hors identifiants connus (message, chat…). */
export function collectUuidCandidates(root: unknown, exclude?: unknown[]): string[] {
  const skip = new Set((exclude || []).filter(Boolean).map(v => String(v).toLowerCase()));
  const out: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (!node || depth > 10 || out.length >= 6) return;
    if (typeof node === "string") {
      const v = node.toLowerCase();
      if (UUID_RE.test(node) && !skip.has(v) && !out.includes(v)) out.push(v);
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const obj = node as Loose;
    for (const key of Object.keys(obj)) {
      if (/^(chatId|userId|agentId|messageId|parentId)$/i.test(key)) continue;
      walk(obj[key], depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Lit une réponse SSE du chat et renvoie le texte final. Reproduit `streamChatRequest` d'origine
 * à partir de la réponse HTTP : la requête (payload, pièces jointes, reprise) reste à l'appelant.
 *
 * Erreurs : réponse non OK (`status`), flux coupé (`TypeError`), erreur annoncée par le flux
 * (`fromStream`, avec `code`/`type`/`retryable`/`moderation`).
 */
export async function processChatStream(options: ProcessChatStreamOptions): Promise<string> {
  const { response, conversation, resume, imageMode, onDelta, onEvent, shouldStop, fetchChatDetail, resolveImage, save } = options;
  const now = options.now ?? Date.now;
  const streamLog = options.log ?? [];

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error: StreamError = new Error("HTTP " + response.status + (detail ? " : " + detail.slice(0, 500) : ""));
    error.status = response.status;
    throw error;
  }

  const checkpoint = resume ? conversation.pendingResponse?.lastEventId : undefined;
  let output = checkpoint ? conversation.pendingResponse?.output || "" : "";
  let cursor = /^\d+$/.test(checkpoint || "") ? BigInt(checkpoint as string) : null;
  if (output) onDelta(output);
  let checkpointAt = 0;
  // `as` : ces variables sont modifiées dans le rappel de l'analyseur, que TypeScript ne suit pas.
  let completed = false as boolean;
  let streamError = null as Loose | null;
  const append = (chunk: unknown): void => {
    if (typeof chunk !== "string" || !chunk) return;
    output += chunk;
    onDelta(output);
  };

  const sources: StreamSource[] = [];
  const sourceKeys = new Set<string>();
  const seenImages = new Set<string>();
  // Identifiants d'images vus sans messageId : résolus après le flux via /chats/{id}.
  const pendingImageIds = new Set<string>();
  let emittedImages = 0;
  // Signal « génération d'image démarrée » envoyé une seule fois à l'interface.
  let imageStartSent = false;
  let sawImageHint = resume && conversation.pendingResponse?.imageStarted === true;

  // Les événements `image_start`, `image`, `sources` et `web_search` n'échouent jamais vers le flux.
  const emit = (event: StreamEvent): void => {
    try { onEvent?.(event); } catch {}
  };

  const logEvent = (name: string, data: unknown, raw?: string): void => {
    if (streamLog.length >= 60 || name === "response.output_text.delta") return;
    let entry = String(name || "message");
    if (data && typeof data === "object") {
      const d = data as Loose;
      const item = d.item || d.output_item || d.part || d.message || null;
      const type = (item && typeof item.type === "string" && item.type) || (typeof d.type === "string" && d.type) || "";
      if (type && type !== entry) entry += "(" + type + ")";
      if (d.error || (d.response && d.response.error)) entry += "!erreur";
    } else if (raw) {
      entry += "[non-JSON:" + String(raw).slice(0, 40) + "]";
    }
    if (streamLog[streamLog.length - 1] !== entry) streamLog.push(entry);
  };

  const parser = createSseParser((name, payload, eventId, explicitId) => {
    if (payload === "[DONE]") { completed = true; return; }
    // Certains serveurs incluent l'événement du curseur dans le flux repris.
    // L'ignorer évite de répéter un fragment de texte déjà enregistré.
    if (cursor !== null && explicitId && /^\d+$/.test(eventId)) {
      const sequence = BigInt(eventId);
      if (sequence <= cursor) return;
      cursor = null;
    }
    let data: Loose;
    try {
      data = JSON.parse(payload);
    } catch {
      logEvent(name, null, payload);
      return;
    }
    logEvent(name, data);
    if (!data || typeof data !== "object") return;
    if (data.chat_id) {
      conversation.chatId = data.chat_id;
      if (conversation.pendingResponse) save?.();
    }
    // Diagnostic : forme de l'item image_generation_call terminé (clés et types seulement).
    if (name === "response.output_item.done" && data.item && data.item.type === "image_generation_call") {
      try { streamLog.push("image_item=" + describeShape(data.item).slice(0, 300)); } catch {}
    }
    // Images générées (image_generation_call) : base64 direct ou identifiant à télécharger.
    if (onEvent && name !== "response.output_text.delta") {
      if (/image_generation|generated_image|output_image/i.test(String(name || "") + " " + String(payload).slice(0, 4000))) {
        sawImageHint = true;
        if (!imageStartSent && emittedImages === 0) {
          imageStartSent = true;
          emit({ name: "image_start", data: null });
        }
      }
      const found = collectGeneratedImages(data);
      const messageId = (data.message && typeof data.message.id === "string" && (name === "completed" || data.message.role === "assistant") ? data.message.id : null)
        || (typeof data.message_id === "string" ? data.message_id : null)
        || (typeof data.messageId === "string" ? data.messageId : null);
      for (const image of found) {
        const key = generatedImageKey(image);
        if (!key || seenImages.has(key)) continue;
        if (!image.data && !image.url && !messageId) { pendingImageIds.add(image.id as string); continue; }
        seenImages.add(key);
        if (image.id) pendingImageIds.delete(image.id);
        emittedImages++;
        emit({ name: "image", data: { data: image.data || null, url: image.url || null, id: image.id || null, messageId, chatId: conversation.chatId } });
      }
    }
    // Sites consultés : web_search_call (action.sources), annotations url_citation, etc.
    if (name !== "response.output_text.delta" && onEvent && collectSourceUrls(data, sources, sourceKeys)) {
      emit({ name: "sources", data: sources.slice() });
    }
    switch (name) {
      case "response.output_text.delta":
        append(data.delta);
        break;
      case "response.output_text.done":
      if (!output) append(data.text);
      break;
      case "response.failed":
      case "error":
        streamError = data;
        break;
      case "cancelled":
      case "canceled":
      case "response.cancelled":
      case "response.canceled":
        completed = true;
        break;
      case "response.completed":
        completed = true;
        if (data.response && data.response.error) streamError = data.response.error;
        break;
      case "completed":
      completed = true;
 // Comme l'original, cet événement n'est pas protégé : une erreur de l'interface remonte.
 if (data.message && typeof data.message.id === "string" && onEvent) onEvent({ name: "message_saved", data: data.message });
        if (!output && data.message) {
          const msg = data.message;
          if (typeof msg.content === "string") append(msg.content);
          else {
     // content ou parts sous forme de tableau : on récupère les morceaux de texte.
     const pieces = ([] as unknown[]).concat(Array.isArray(msg.content) ? msg.content : [], Array.isArray(msg.parts) ? msg.parts : [])
     .map((p: unknown) => {
       const part = p as Loose | null;
       return typeof p === "string" ? p : part && typeof part.text === "string" ? part.text : part && typeof part.content === "string" && /text/i.test(String(part.type || "")) ? part.content : "";
     })
     .filter(Boolean);
     if (pieces.length) append(pieces.join("\n\n"));
   }
        }
        break;
      default:
      if (onEvent && !output) {
        const itemType = data && data.item && typeof data.item.type === "string" ? data.item.type : "";
        if (/web_search|websearch|web-search/i.test(String(name || "") + " " + itemType + " " + (typeof data.type === "string" ? data.type : ""))) {
          emit({ name: "web_search", data });
          }
        }
        break;
    }
    if (conversation.pendingResponse) {
      conversation.pendingResponse.output = output;
      if (/^\d+$/.test(eventId || "")) conversation.pendingResponse.lastEventId = eventId;
      if (now() - checkpointAt > 500) { checkpointAt = now(); save?.(); }
    }
  });

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      if (shouldStop()) {
        reader.cancel().catch(() => {});
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } else {
    parser.feed(await response.text());
  }
  parser.end();
  if (!completed && !streamError && !shouldStop()) throw new TypeError("Flux de réponse interrompu avant la fin.");

  // Dernier message assistant lu par le repli /chats (utilisé pour tester les UUID).
  let fallbackLast: Loose | null = null;
  // Secours : image annoncée dans le flux mais jamais affichée (pas de base64 ni de messageId).
  if (!shouldStop() && !streamError && onEvent && fetchChatDetail && conversation.chatId && emittedImages === 0 && (pendingImageIds.size || sawImageHint || imageMode)) {
    try {
      const res = await fetchChatDetail(conversation.chatId);
      streamLog.push("repli /chats HTTP " + res.status);
      if (res.ok) {
        const detail = (await res.json().catch(() => null)) as Loose | null;
        const list: Loose[] = detail && Array.isArray(detail.chatMessages) ? detail.chatMessages.slice() : [];
        const time = (v: unknown): number => { const t = Date.parse(v as string); return Number.isFinite(t) ? t : 0; };
        const last = list
          .filter(m => m && String(m.role || "").toLowerCase() === "assistant")
          .sort((a, b) => time(a.createdAt) - time(b.createdAt))
          .pop();
        if (last) {
          fallbackLast = last;
          for (const image of collectGeneratedImages(last.parts || last)) {
            const key = generatedImageKey(image);
            if (!key || seenImages.has(key)) continue;
            seenImages.add(key);
            emittedImages++;
            emit({ name: "image", data: { data: image.data || null, url: image.url || null, id: image.id || null, messageId: last.id || null, chatId: conversation.chatId } });
          }
        }
      }
    } catch {
    }
  }

  // Image générée introuvable dans le flux et dans /chats : diagnostic des parts, puis test des UUID
  // sur /chats/{chatId}/messages/{messageId}/images/{imageId} (endpoint décrit dans la doc).
  if (!shouldStop() && !streamError && onEvent && emittedImages === 0 && fallbackLast && fallbackLast.id) {
    const last = fallbackLast;
    try { streamLog.push("parts=" + describeShape(last.parts).slice(0, 300)); } catch {}
    const candidates = collectUuidCandidates(last.parts || last, [last.id, conversation.chatId, last.chatId]);
    if (!candidates.length) streamLog.push("aucun uuid d'image dans le message");
    for (const id of candidates) {
      try {
        const src = resolveImage ? await resolveImage({ id, messageId: last.id, chatId: conversation.chatId }) : null;
        if (src) {
          streamLog.push("image trouvée via uuid");
          emittedImages++;
          emit({ name: "image", data: { data: src, url: null, id, messageId: last.id, chatId: conversation.chatId } });
        }
      } catch (err) {
        streamLog.push("uuid " + id.slice(0, 8) + " : " + (err && (err as Error).message ? (err as Error).message : "échec"));
      }
    }
  }

  if (streamError && !shouldStop()) {
    // On conserve code / type / retryable pour un message clair (saturation, modération…).
    const error: StreamError = new Error(describeStreamError(streamError));
    const inner: Loose = streamError && typeof streamError.error === "object" && streamError.error ? streamError.error : streamError;
    if (inner && typeof inner === "object") {
      if (inner.code) error.code = String(inner.code);
      if (inner.type) error.type = String(inner.type);
      if (typeof inner.retryable === "boolean") error.retryable = inner.retryable;
      if (inner.moderation_details) error.moderation = inner.moderation_details;
    }
    error.fromStream = true;
    throw error;
  }
  return output;
}
