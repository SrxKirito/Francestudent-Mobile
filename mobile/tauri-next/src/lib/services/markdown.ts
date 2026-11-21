// Rendu Markdown du chat : port typé de mobile/www/js/render.js (partie affichage uniquement).
// Aucune dépendance : le HTML produit est identique à celui de l'original (test-svelte-markdown.mjs le vérifie sur un
// corpus, avec et sans KaTeX). Tout texte est échappé avant d'être mis en forme ; seules les balises générées ici sortent.
//
// Les contenus interactifs utilisent les blocs analysés ici et sont rendus par Svelte.

/** Sous-ensemble de KaTeX utilisé (window.katex, chargé depuis /legacy/katex/katex.min.js). */
export interface KatexLike {
  renderToString(tex: string, options: { displayMode: boolean; throwOnError: boolean; output: string }): string;
}

export interface MarkdownOptions {
  /** KaTeX à utiliser ; `null` désactive les maths ; absent = `window.katex` lu au moment du rendu. */
  katex?: KatexLike | null;
  /** Rendu interactif d'un bloc d'étude (quiz, cartes) ; renvoie "" pour laisser le bloc en code. */
  study?: (code: string, lang: string, open: boolean) => string;
  /** Nom de fichier d'une présentation (bloc pptx) ; absent = déduit comme pour les autres langages. */
  powerPointFileName?: (code: string) => string;
}

interface Download {
  name: string;
  index: number;
}

interface Context {
  katex: KatexLike | null;
  study?: MarkdownOptions["study"];
  powerPointFileName?: MarkdownOptions["powerPointFileName"];
}

export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CODE_KEYWORDS = new Set(("abstract and as async await break case catch char class const continue def default del delete do double elif else enum except export extends false False final finally float fn for from func function global go if impl import in instanceof int interface is lambda let long match mod mut namespace new nil none None not null or package pass private protected pub public raise return self static struct super switch this throw throws true True try type typeof undefined use using var void while with yield").split(" "));
const HASH_COMMENT_LANGS = /^(py|python|sh|bash|shell|zsh|rb|ruby|r|yaml|yml|toml|perl|ps1|powershell|dockerfile|makefile|conf|ini)$/;
const PLAIN_LANGS = /^(text|txt|plain|plaintext|md|markdown)$/;
const STRING_TOKEN = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/;
const WORD_TOKEN = /\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function highlightCode(code: string, lang?: string | null): string {
  const language = String(lang || "").toLowerCase();
  if (PLAIN_LANGS.test(language)) return escapeHtml(code);
  const comment = HASH_COMMENT_LANGS.test(language) ? /#[^\n]*/ : /\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/;
  const pattern = new RegExp(comment.source + "|" + STRING_TOKEN.source + "|" + WORD_TOKEN.source, "g");
  let html = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    const token = match[0];
    html += escapeHtml(code.slice(last, match.index));
    last = match.index + token.length;
    let kind = "";
    if (/^(#|\/\/|\/\*|<!--)/.test(token)) kind = "comment";
    else if (/^["'`]/.test(token)) kind = "string";
    else if (/^\d/.test(token)) kind = "number";
    else if (CODE_KEYWORDS.has(token)) kind = "keyword";
    else if (/^\s*\(/.test(code.slice(last, last + 20))) kind = "function";
    html += kind ? "<span class=\"tok-" + kind + "\">" + escapeHtml(token) + "</span>" : escapeHtml(token);
  }
  return html + escapeHtml(code.slice(last));
}

export const DL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

export function fileIconSvg(name?: string | null, kind?: string): string {
  const ext = String(name || "").split(".").pop()!.toLowerCase();
  const isImg = kind === "image" || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext);
  const body = isImg
    ? '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'
    : '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
}

function fileCardHtml(name: string, index: number): string {
  const safe = escapeHtml(name);
  return '<button type="button" class="file-card" data-file-index="' + index + '" data-name="' + safe + '" title="Aperçu de ' + safe + '"><span class="file-card-icon">' + fileIconSvg(name) + '</span><span class="file-card-name">' + safe + '</span><span class="file-card-dl" title="Télécharger">' + DL_SVG + "</span></button>";
}

const CODE_EXT: Record<string, string> = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", html: "html", css: "css", json: "json", csv: "csv", markdown: "md", md: "md", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", bash: "sh", sh: "sh", shell: "sh", powershell: "ps1", sql: "sql", xml: "xml", yaml: "yml", yml: "yml", php: "php", ruby: "rb", go: "go", rust: "rs", kotlin: "kt", swift: "swift", latex: "tex", tex: "tex", txt: "txt", text: "txt", pdf: "pdf", svg: "svg", pptx: "pptx", powerpoint: "pptx" };

/** Types MIME des fichiers générés (utile au téléchargement, étape suivante). */
export const FILE_MIME: Record<string, string> = { py: "text/x-python", js: "text/javascript", html: "text/html", css: "text/css", json: "application/json", csv: "text/csv", md: "text/markdown", pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", svg: "image/svg+xml", xml: "application/xml", txt: "text/plain" };

// Les extensions sont lues par `Object.prototype.hasOwnProperty` pour ne jamais résoudre « constructor » ou « __proto__ ».
function extensionFor(lang: unknown): string | undefined {
  const key = String(lang || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CODE_EXT, key) ? CODE_EXT[key] : undefined;
}

export function fileNameFromCode(code: string, lang?: string | null, powerPointFileName?: (code: string) => string): string {
  if (/^(pptx|powerpoint)$/i.test(String(lang || "")) && typeof powerPointFileName === "function") return powerPointFileName(code);
  const ext = extensionFor(lang);
  if (!ext) return "";
  const first = String(code || "").split("\n")[0].trim();
  const m = /^(#|[/][/]|<!--|[/][*]|--|%)/.test(first) ? first.match(/[A-Za-z0-9_-]+[.][A-Za-z0-9]{1,5}/) : null;
  if (m) return m[0];
  return ext === "pdf" ? "document.pdf" : "";
}

export function guessFileName(code: string, lang?: string | null): string {
  const ext = extensionFor(lang) || "txt";
  const re = /[A-Za-z0-9_-]+[.]([A-Za-z0-9]{1,5})/g;
  const pick = (text: string): string => {
    let found = "";
    for (const m of String(text || "").matchAll(re)) if (m[1].toLowerCase() === ext) found = m[0];
    return found;
  };
  const first = code.split("\n")[0].trim();
  const name = /^(#|[/][/]|<!--|[/][*]|--|%)/.test(first) ? pick(first) : "";
  return name || "fichier." + ext;
}

export function renderCodeBlockInner(code: string, lang: string): string {
  const label = lang ? escapeHtml(lang) : "code";
  return "<div class=\"code-block\"><div class=\"code-header\"><span class=\"code-lang\">" + label +
    "</span><button type=\"button\" class=\"code-copy\">Copier</button></div><pre><code>" +
    highlightCode(code, lang) + "</code></pre></div>";
}

function renderCodeBlock(code: string, lang: string, open: boolean, downloads: Download[], context: Context): string {
  const study = typeof context.study === "function" ? context.study(code, lang, open) : "";
  if (study) return study;
  const fname = fileNameFromCode(code, lang, context.powerPointFileName) || guessFileName(code, lang);
  const index = downloads.length;
  downloads.push({ name: fname, index });
  const fileOnly = /\.(pdf|pptx)$/i.test(fname);
  return '<div class="file-wrap' + (fileOnly ? " file-only" : "") + '" data-file-index="' + index + '">' + renderCodeBlockInner(code, lang) + "</div>";
}

function renderInline(text: string): string {
  const codes: string[] = [];
  const html = escapeHtml(text)
    .replace(/`([^`]+)`/g, (_, code: string) => {
      codes.push("<code>" + code + "</code>");
      return "\u0000" + (codes.length - 1) + "\u0000";
    })
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codes[Number(index)]);
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map(cell => cell.trim());
}

function renderTable(header: string, separator: string, rows: string[]): string {
  const aligns = splitRow(separator).map(cell =>
    cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "");
  const cell = (tag: string, text: string, index: number): string =>
    "<" + tag + (aligns[index] ? " style=\"text-align:" + aligns[index] + "\"" : "") + ">" + renderInline(text) + "</" + tag + ">";
  const head = splitRow(header);
  let html = "<div class=\"table-wrap\"><table><thead><tr>" + head.map((text, index) => cell("th", text, index)).join("") + "</tr></thead><tbody>";
  for (const row of rows) {
    const cells = splitRow(row);
    html += "<tr>" + head.map((_, index) => cell("td", cells[index] || "", index)).join("") + "</tr>";
  }
  return html + "</tbody></table></div>";
}

interface ListState {
  type: "ul" | "ol";
  items: string[][];
  start?: number;
}

function renderBlocks(text: string): string {
  const lines = text.split("\n");
  let html = "";
  let paragraph: string[] = [];
  // L'état de liste vit dans un objet : TypeScript ne suit pas les affectations faites dans les fermetures.
  const state: { list: ListState | null } = { list: null };
  let quote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) html += "<p>" + paragraph.map(renderInline).join("<br>") + "</p>";
    paragraph = [];
  };
  const flushList = (): void => {
    const list = state.list;
    if (list) {
      const start = list.type === "ol" && (list.start ?? 0) > 1 ? " start=\"" + list.start + "\"" : "";
      html += "<" + list.type + start + ">" + list.items.map(item => "<li>" + item.map(renderInline).join("<br>") + "</li>").join("") + "</" + list.type + ">";
    }
    state.list = null;
  };
  const flushQuote = (): void => {
    if (quote.length) html += "<blockquote>" + renderBlocks(quote.join("\n")) + "</blockquote>";
    quote = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };
  const addItem = (type: "ul" | "ol", item: string, start?: number): void => {
    flushParagraph();
    flushQuote();
    if (!state.list || state.list.type !== type) {
      flushList();
      state.list = { type, items: [], start };
    }
    state.list.items.push([item]);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    let match: RegExpExecArray | null;
    if (!line.trim()) {
      flushAll();
    } else if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && TABLE_SEPARATOR.test(lines[i + 1])) {
      flushAll();
      const rows: string[] = [];
      let next = i + 2;
      while (next < lines.length && lines[next].trim() && lines[next].includes("|")) rows.push(lines[next++]);
      html += renderTable(line, lines[i + 1], rows);
      i = next - 1;
    } else if ((match = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line))) {
      flushAll();
      const level = match[1].length;
      html += "<h" + level + ">" + renderInline(match[2]) + "</h" + level + ">";
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      html += "<hr>";
    } else if ((match = /^\s*>\s?(.*)$/.exec(line))) {
      flushParagraph();
      flushList();
      quote.push(match[1]);
    } else if ((match = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      addItem("ul", match[1]);
    } else if ((match = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
      addItem("ol", match[2], Number(match[1]));
    } else if (state.list && /^\s+\S/.test(raw)) {
      state.list.items[state.list.items.length - 1].push(line.trim());
    } else {
      flushList();
      flushQuote();
      paragraph.push(line);
    }
  }
  flushAll();
  return html;
}

const MATH_PATTERN = /`[^`\n]+`|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?![\w$])/g;

function renderMath(tex: string, display: boolean, raw: string, katex: KatexLike | null): string {
  if (!katex || typeof katex.renderToString !== "function") return escapeHtml(raw);
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
  } catch {
    return escapeHtml(raw);
  }
}

function renderTextWithMath(text: string, katex: KatexLike | null): string {
  const maths: string[] = [];
  const stashed = text.replace(MATH_PATTERN, (match: string, dollarBlock?: string, bracketBlock?: string, parenInline?: string, prefix?: string, dollarInline?: string) => {
    if (match[0] === "`") return match;
    let lead = "";
    let tex: string | undefined;
    let display = false;
    if (dollarBlock !== undefined) {
      tex = dollarBlock;
      display = true;
    } else if (bracketBlock !== undefined) {
      tex = bracketBlock;
      display = true;
    } else if (parenInline !== undefined) {
      tex = parenInline;
    } else {
      lead = prefix || "";
      tex = dollarInline;
    }
    if (!tex || !tex.trim()) return match;
    maths.push(renderMath(tex.trim(), display, match.slice(lead.length), katex));
    return lead + "\u0001" + (maths.length - 1) + "\u0001";
  });
  const html = renderBlocks(stashed);
  if (!maths.length) return html;
  return html.replace(/\u0001(\d+)\u0001/g, (_, index: string) => maths[Number(index)] || "");
}

function globalKatex(): KatexLike | null {
  const holder = globalThis as { window?: { katex?: KatexLike } };
  return holder.window?.katex ?? null;
}


export type MarkdownBlock =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string; open: boolean; index: number };

export function parseMarkdownBlocks(source: unknown): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  let text: string[] = [];
  let code: { fence: string; language: string; lines: string[] } | null = null;
  let index = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (code) {
      if (trimmed.length >= code.fence.length && trimmed === code.fence[0].repeat(trimmed.length)) {
        blocks.push({ type: "code", language: code.language, content: code.lines.join("\n"), open: false, index: index++ });
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    const fence = /^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/.exec(line);
    if (fence) {
      if (text.length) blocks.push({ type: "text", content: text.join("\n") });
      text = [];
      code = { fence: fence[1], language: fence[2], lines: [] };
    } else {
      text.push(line);
    }
  }
  if (code) blocks.push({ type: "code", language: code.language, content: code.lines.join("\n"), open: true, index });
  if (text.length) blocks.push({ type: "text", content: text.join("\n") });
  return blocks;
}

/** Convertit un fragment de texte Markdown (sans bloc de code) en HTML sûr. */
export function renderMarkdownText(source: string): string {
  return renderTextWithMath(source, globalKatex());
}

/**
 * Convertit du Markdown en HTML sûr. `streaming` : réponse encore en cours d'écriture (pas de cartes de téléchargement).
 */
export function renderMarkdown(source: unknown, streaming = false, options: MarkdownOptions = {}): string {
  const context: Context = {
    katex: options.katex === undefined ? globalKatex() : options.katex,
    study: options.study,
    powerPointFileName: options.powerPointFileName
  };
  const downloads: Download[] = [];
  let html = "";
  for (const block of parseMarkdownBlocks(source)) {
    html += block.type === "text"
      ? renderTextWithMath(block.content, context.katex)
      : renderCodeBlock(block.content, block.language, block.open, downloads, context);
  }
  if (!streaming && downloads.length) html += '<div class="message-downloads" role="group" aria-label="Fichiers à télécharger">' + downloads.map(file => fileCardHtml(file.name, file.index)).join("") + "</div>";
  return html;
}
