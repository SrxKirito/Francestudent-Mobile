
import type { Cell } from "./interactive-widgets.ts";

export interface Sheet { title: string; columns: string[]; rows: Cell[][] }

function sheet(title: string, values: string[][]): Sheet | null {
  const width = Math.min(24, Math.max(0, ...values.map(row => row.length)));
  if (!width || !values.length) return null;
  const header = values[0];
  return {
    title,
    columns: Array.from({ length: width }, (_, index) => header[index]?.trim() || "Colonne " + (index + 1)),
    rows: values.slice(1).map(row => Array.from({ length: width }, (_, index) => row[index]?.slice(0, 1000) ?? null))
  };
}

export function readDelimited(title: string, input: string, delimiter?: string): Sheet | null {
  const source = input.replace(/^\uFEFF/, "").slice(0, 250_000);
  const first = source.split(/\r?\n/, 1)[0].replace(/"(?:[^"]|"")*"/g, "");
  const separator = delimiter || (first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  function pushCell() { if (row.length < 24) row.push(value); value = ""; }
  function append(char: string) { if (value.length < 1000) value += char; }
  for (let index = 0; index < source.length && rows.length < 121; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { append('"'); index++; }
      else if (quoted || !value) quoted = !quoted;
      else append(char);
    } else if (!quoted && char === separator) pushCell();
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index++;
      pushCell();
      rows.push(row);
      row = [];
    } else append(char);
  }
  if (rows.length < 121 && (row.length || value)) { pushCell(); rows.push(row); }
  return sheet(title, rows);
}

export function readSheets(input: string): Sheet[] {
  const sections = input.slice(0, 250_000).split(/^--- Feuille (.+) ---$/gm);
  const sheets: Sheet[] = [];
  for (let index = 1; index < sections.length && sheets.length < 20; index += 2) {
    const values = sections[index + 1].replace(/^\r?\n/, "").trimEnd().split(/\r?\n/, 121)
      .map(line => line.split("\t", 24));
    const result = sheet(sections[index].slice(0, 120), values);
    if (result) sheets.push(result);
  }
  return sheets;
}

export interface WordParagraph {
  heading: "h1" | "h2" | "h3" | "p";
  runs: { text: string; bold: boolean; italic: boolean; underline: boolean }[];
}

export function readWordParagraphs(xml: string): WordParagraph[] {
  if (/<!DOCTYPE/i.test(xml)) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const namespace = doc.documentElement.namespaceURI;
  if (!namespace || !["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"].includes(namespace)) return [];
  const find = (element: Element, tag: string) => element.getElementsByTagNameNS(namespace, tag);
  const on = (element: Element, tag: string) => {
    const property = find(element, tag)[0];
    return Boolean(property && !/^(?:0|false|off|none)$/.test(property.getAttributeNS(namespace, "val") ?? ""));
  };
  return [...doc.getElementsByTagNameNS(namespace, "p")].slice(0, 250).flatMap(paragraph => {
    const style = find(paragraph, "pStyle")[0]?.getAttributeNS(namespace, "val") ?? "";
    const level = /^(?:heading|titre)([1-3])$/i.exec(style)?.[1];
    const heading = level ? "h" + level as WordParagraph["heading"] : "p";
    const runs = [...find(paragraph, "r")].slice(0, 120).map(run => ({
      text: [...run.children].map(node => {
        if (node.namespaceURI !== namespace) return "";
        if (node.localName === "t") return node.textContent;
        if (node.localName === "br" || node.localName === "cr") return "\n";
        return node.localName === "tab" ? "\t" : "";
      }).join("").slice(0, 1800),
      bold: on(run, "b"), italic: on(run, "i"), underline: on(run, "u")
    })).filter(run => run.text);
    return runs.length ? [{ heading, runs }] : [];
  });
}

const htmlTags = new Set("main section article nav header footer div span p strong b em i small mark h1 h2 h3 h4 h5 h6 ul ol li hr br pre code blockquote figure figcaption table thead tbody tfoot tr th td details summary style".split(" "));
const svgTags = new Set("svg g path rect circle ellipse line polyline polygon title desc text tspan defs linearGradient radialGradient stop".split(" "));
const htmlAttrs = new Set("class id style lang dir title colspan rowspan open".split(" "));
const svgAttrs = new Set("id viewBox xmlns width height x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linejoin stroke-linecap opacity fill-opacity stroke-opacity transform font-size text-anchor offset stop-color stop-opacity gradientUnits gradientTransform preserveAspectRatio".split(" "));

/** Parse dans un template inerte puis conserve uniquement les éléments d’affichage. */
function sanitize(source: string, svg: boolean): string {
  const template = document.createElement("template");
  template.innerHTML = source.slice(0, 100_000);
  const tags = svg ? svgTags : htmlTags;
  const attrs = svg ? svgAttrs : htmlAttrs;
  const namespace = svg ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml";
  const elements = template.content.querySelectorAll("*");
  if (elements.length > 2000) throw new Error("Aperçu trop complexe.");
  for (const element of elements) {
    if (!tags.has(element.localName) || element.namespaceURI !== namespace) {
      element.remove();
      continue;
    }
    for (const attr of [...element.attributes]) {
      if (!attrs.has(attr.name) || (svg && /url\s*\(/i.test(attr.value) && !/^url\(#[A-Za-z0-9_-]+\)$/.test(attr.value))) element.removeAttribute(attr.name);
    }
  }
  if (!svg) return template.innerHTML;
  const root = template.content.querySelector("svg");
  if (!root) throw new Error("Illustration SVG invalide.");
  root.setAttribute("xmlns", namespace);
  return root.outerHTML;
}

export function htmlPreview(source: string): string {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + policy + '">' +
    '<style>html{color-scheme:light dark}body{font:16px system-ui;margin:1rem;overflow-wrap:anywhere}table{max-width:100%}</style>' +
    "</head><body>" + sanitize(source, false) + "</body></html>";
}

export function svgPreview(source: string): Blob {
  return new Blob([sanitize(source, true)], { type: "image/svg+xml" });
}
