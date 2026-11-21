"use strict";

// Réutilise les convertisseurs embarqués depuis la page Svelte, sans monter l'ancienne interface.
const fs = require("node:fs");
const path = require("node:path");
const source = path.resolve(__dirname, "../www");
const target = path.join(__dirname, "public", "document-assets");
fs.mkdirSync(target, { recursive: true });

const assetPaths = {
  "pdf.min.js": "pdfjs/pdf.min.js",
  "pdf.worker.min.js": "pdfjs/pdf.worker.min.js",
  "pptxgen.bundle.js": "pptxgen/pptxgen.bundle.js",
  "powerpoint-visuals.js": "js/powerpoint-visuals.js",
  "PptxGenJS-LICENSE": "pptxgen/LICENSE",
  "JSZip-LICENSE.markdown": "pptxgen/JSZip-LICENSE.markdown"
};
for (const [asset, original] of Object.entries(assetPaths)) {
  fs.copyFileSync(path.join(source, original), path.join(target, asset));
}

function replaceRequired(text, before, after) {
  if (!text.includes(before)) throw new Error("Convertisseur modifié : " + before);
  return text.replace(before, after);
}

const originalRender = fs.readFileSync(path.join(source, "js/render.js"), "utf8");
const pdfStart = originalRender.indexOf("function makePdf(text)");
const pdfEnd = originalRender.indexOf("function fileSaverPlugin()", pdfStart);
if (pdfStart < 0 || pdfEnd < 0) throw new Error("Convertisseur PDF source introuvable.");
const pdf = originalRender.slice(pdfStart, pdfEnd);
const originalPowerpoint = fs.readFileSync(path.join(source, "js/powerpoint.js"), "utf8").replace(/\r\n/g, "\n");
// Les URL fournies par le modèle ne sont pas requêtées. Les illustrations intégrées restent disponibles.
let powerpoint = replaceRequired(originalPowerpoint,
  "      if (page.image) picture = await loadPowerPointPhoto(page.image.url);\n", "");
powerpoint = replaceRequired(powerpoint, "  const pages = powerPointPages(data);",
  '  const pages = powerPointPages(data);\n  if (pages.length > 200) throw new Error("Cette présentation contient trop de contenu pour être exportée.");');
fs.writeFileSync(path.join(target, "formats.mjs"),
  powerpoint + "\n" + pdf + "\nexport { makePdf, makePowerPoint, parsePowerPoint, powerPointPages };\n");

let convert = fs.readFileSync(path.join(source, "fileconvert.js"), "utf8").replace(/\r\n/g, "\n");
convert = replaceRequired(convert, "const MAX_TEXT = Infinity;", "const MAX_TEXT = 250000;");
convert = replaceRequired(convert, "const MAX_ENTRY_BYTES = 200 * 1024 * 1024;", "const MAX_ENTRY_BYTES = 12 * 1024 * 1024;");
convert = replaceRequired(convert, "    const entries = [];", [
  '    if (count > 10000) throw new Error("archive trop grande");',
  "    let total = 0;",
  "    const entries = [];"
].join("\n"));
convert = replaceRequired(convert, "      entries.push({", [
  "      total += u32(bytes, offset + 24);",
  '      if (total > 48 * 1024 * 1024) throw new Error("archive trop grande");',
  "      entries.push({"
].join("\n"));
convert = replaceRequired(convert, "    return new Uint8Array(await new Response(stream).arrayBuffer());", [
  "    const reader = stream.getReader();",
  "    const parts = [];",
  "    let length = 0;",
  "    try {",
  "      for (;;) {",
  "        const { value, done } = await reader.read();",
  "        if (done) break;",
  "        length += value.byteLength;",
  '        if (length > MAX_ENTRY_BYTES) throw new Error("entrée ZIP trop grande");',
  "        parts.push(value);",
  "      }",
  "    } finally {",
  "      await reader.cancel().catch(() => {});",
  "    }",
  "    const bytes = new Uint8Array(length);",
  "    let start = 0;",
  "    for (const part of parts) { bytes.set(part, start); start += part.length; }",
  "    return bytes;"
].join("\n"));
convert = replaceRequired(convert, "    if (entry.method === 0) return data;\n    if (entry.method === 8) return inflateRaw(data);", [
  "    if (entry.method === 0 || entry.method === 8) {",
  "      const decoded = entry.method === 0 ? data : await inflateRaw(data);",
  '      if (decoded.length !== entry.size) throw new Error("taille ZIP discordante");',
  "      return decoded;",
  "    }"
].join("\n"));
convert = replaceRequired(convert, "  const api = { embeddedThumbnail,", [
  "  async function wordXml(input) {",
  "    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);",
  "    if (!isZip(bytes)) return null;",
  '    const entry = zipEntries(bytes).find(item => item.name === "word/document.xml");',
  "    return entry && entry.size <= 1024 * 1024 ? utf8(await readEntry(bytes, entry)) : null;",
  "  }",
  "  const api = { wordXml, embeddedThumbnail,"
].join("\n"));
fs.writeFileSync(path.join(target, "fileconvert.js"), convert);
