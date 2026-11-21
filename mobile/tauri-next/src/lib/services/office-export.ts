const encoder = new TextEncoder();
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xml = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ ((byte & 1) ? 0xedb88320 : 0);
  return byte;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const entries = Object.entries(files).map(([path, content]) => {
    const data = encoder.encode(xmlDecl + content);
    return { name: encoder.encode(path), data, crc: crc32(data) };
  });
  const fileSize = entries.reduce((n, entry) => n + 30 + entry.name.length + entry.data.length, 0);
  const directorySize = entries.reduce((n, entry) => n + 46 + entry.name.length, 0);
  const archive = new Uint8Array(fileSize + directorySize + 22);
  const view = new DataView(archive.buffer);
  const short = (offset: number, value: number) => view.setUint16(offset, value, true);
  const long = (offset: number, value: number) => view.setUint32(offset, value, true);
  let header = 0;
  let directory = fileSize;
  for (const { name, data, crc } of entries) {
    long(header, 0x04034b50); short(header + 4, 20); short(header + 12, 33);
    long(header + 14, crc); long(header + 18, data.length); long(header + 22, data.length);
    short(header + 26, name.length);
    archive.set(name, header + 30); archive.set(data, header + 30 + name.length);
    long(directory, 0x02014b50); short(directory + 4, 20); short(directory + 6, 20); short(directory + 14, 33);
    long(directory + 16, crc); long(directory + 20, data.length); long(directory + 24, data.length);
    short(directory + 28, name.length); long(directory + 42, header);
    archive.set(name, directory + 46);
    header += 30 + name.length + data.length;
    directory += 46 + name.length;
  }
  long(directory, 0x06054b50); short(directory + 8, entries.length); short(directory + 10, entries.length);
  long(directory + 12, directorySize); long(directory + 16, fileSize);
  return archive;
}

function relationships(type: string, target: string) {
  return `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/${type}" Target="${target}"/></Relationships>`;
}

function packageParts(parts: Record<string, string>, root: string, types: Record<string, string>) {
  const overrides = Object.entries(types).map(([path, type]) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join("");
  return zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + overrides + "</Types>",
    "_rels/.rels": relationships("officeDocument", root),
    ...parts
  });
}

function encodeWord(input: string) {
  const content = input.replace(/^(?:#|\/\/)\s*[\w-]+\.docx\s*\n/i, "").trim();
  if (!content) throw new Error("Le document Word est vide.");
  const paragraphs = content.split(/\r?\n/).map(line => {
    const heading = /^#{1,3}\s+/.test(line);
    const text = xml(line.replace(/^#{1,3}\s+/, ""));
    return '<w:p><w:r>' + (heading ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : "") +
      '<w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
  }).join("");
  const path = "word/document.xml";
  return packageParts({
    [path]: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
  }, path, { [path]: "wordprocessingml.document.main" });
}

function column(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}

function encodeSheet(input: string) {
  const clean = input.replace(/^(?:#|\/\/)\s*[\w-]+\.xlsx\s*\n/i, "");
  let data: unknown;
  try { data = JSON.parse(clean); }
  catch { throw new Error("Le tableau Excel doit contenir un tableau JSON de lignes."); }
  if (!Array.isArray(data) || !data.length || data.length > 1000 ||
      !data.every(row => Array.isArray(row) && row.length <= 64)) throw new Error("Tableau Excel invalide ou trop grand.");
  const rows = data.map((row: unknown[], i: number) => {
    const rowNumber = i + 1;
    const cells = row.map((value, j) => {
      if (value === null) return "";
      const ref = ' r="' + column(j) + rowNumber + '"';
      if (typeof value === "number" && Number.isFinite(value)) return `<c${ref}><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c${ref} t="b"><v>${Number(value)}</v></c>`;
      if (typeof value !== "string" || value.length > 32767) throw new Error("Une cellule Excel contient une valeur invalide.");
      // Les chaînes restent des données, y compris celles qui commencent par = ou +.
      return `<c${ref} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");
  const root = "xl/workbook.xml";
  const sheet = "xl/worksheets/sheet1.xml";
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  return packageParts({
    [root]: `<workbook xmlns="${ns}" xmlns:r="${office}"><sheets><sheet name="Feuille 1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": relationships("worksheet", "worksheets/sheet1.xml"),
    [sheet]: `<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData></worksheet>`
  }, root, { [root]: "spreadsheetml.sheet.main", [sheet]: "spreadsheetml.worksheet" });
}

export function encodeOffice(kind: "docx" | "xlsx", input: string) {
  if (input.length > 250_000) throw new Error("Le document est trop volumineux.");
  return kind === "docx" ? encodeWord(input) : encodeSheet(input);
}
