import assert from "node:assert/strict";
import { encodeOffice } from "./src/lib/services/office-export.ts";
import { generatedArtifacts, generatedFile } from "./src/lib/services/file-preview.ts";
import { chatPrompt } from "./src/lib/services/native-chat-prompts.ts";

function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  const parts = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0);
    const length = view.getUint32(at + 18, true), nameSize = view.getUint16(at + 26, true);
    const name = text.decode(bytes.subarray(at + 30, at + 30 + nameSize));
    const begin = at + 30 + nameSize + view.getUint16(at + 28, true);
    parts[name] = text.decode(bytes.subarray(begin, begin + length));
    at = begin + length;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint32(bytes.length - 6, true), at);
  return parts;
}

const doc = unzipStored(encodeOffice("docx", "# rapport.docx\n# Résumé\nA & B < C"));
assert.match(doc["[Content_Types].xml"], /wordprocessingml.document.main/);
assert.match(doc["_rels/.rels"], /word\/document.xml/);
assert.match(doc["word/document.xml"], /Résumé/);
assert.match(doc["word/document.xml"], /A &amp; B &lt; C/);
assert.doesNotMatch(doc["word/document.xml"], /rapport\.docx/);
const sheet = unzipStored(encodeOffice("xlsx", '# notes.xlsx\n[["Sujet",12,true,null],["=1+2","  texte  "]]'));
assert.match(sheet["xl/_rels/workbook.xml.rels"], /worksheets\/sheet1.xml/);
const cells = sheet["xl/worksheets/sheet1.xml"];
assert.match(cells, /r="B1"><v>12/);
assert.match(cells, /r="C1" t="b"><v>1/);
assert.match(cells, /r="A2" t="inlineStr"/);
assert.match(cells, /=1\+2/);
assert.doesNotMatch(cells, /<f[ >]/);
assert.throws(() => encodeOffice("xlsx", '[["ok",{}]]'), /cellule/);
assert.throws(() => encodeOffice("docx", "A".repeat(250_001)), /volumineux/);

const fence = String.fromCharCode(96).repeat(3);
const [artifact] = generatedArtifacts(fence + "xlsx\n# notes.xlsx\n[[42]]\n" + fence);
assert.equal(artifact.name, "notes.xlsx");
const blob = await generatedFile(artifact.name, artifact.code).load();
assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
assert.match(unzipStored(new Uint8Array(await blob.arrayBuffer()))["xl/worksheets/sheet1.xml"], /<v>42<\/v>/);
const options = { studyMode: "", powerpointMode: false };
assert.match(chatPrompt("Crée un classeur Excel", options), /bloc de code xlsx/);
assert.match(chatPrompt("Rédige un document Word", options), /bloc de code docx/);
console.log("Exports Word et Excel : archives, types de cellules, validation et cartes du chat vérifiés.");
