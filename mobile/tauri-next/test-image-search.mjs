import assert from "node:assert/strict";
import { canSaveCommonsImage, imageSearchQuery, normalizeCommonsImage, searchCommons } from "./src/lib/services/image-search.ts";

assert.equal(imageSearchQuery("Trouve-moi des images du mont Fuji."), "mont Fuji");
assert.equal(imageSearchQuery("Cherche des photos d’Annecy s’il te plaît"), "Annecy");
assert.equal(imageSearchQuery("/images Strasbourg"), "Strasbourg");
assert.equal(imageSearchQuery("Génère une image du mont Fuji"), null);
assert.equal(imageSearchQuery("Analyse ces images"), null);
assert.equal(imageSearchQuery("Parle-moi d’images"), null);

const image = {
  id: 31, title: "Fuji.jpg", license: "CC BY-SA 4.0",
  original: "https://upload.wikimedia.org/wikipedia/commons/1/12/Fuji.jpg",
  thumbnail: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Fuji.jpg/330px-Fuji.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Fuji.jpg"
};
assert.equal(normalizeCommonsImage({ ...image, thumbnail: "https://upload.wikimedia.org.example.com/wikipedia/commons/test.jpg" }), null);
assert.equal(normalizeCommonsImage({ ...image, source: "javascript:alert(1)" }), null);
assert.equal(canSaveCommonsImage(image), true);
assert.equal(canSaveCommonsImage({ ...image, license: "Unknown" }), false);
const signal = new AbortController().signal;
const result = await searchCommons("mont Fuji", 8, signal, async (href, options) => {
  const url = new URL(href);
  assert.equal(url.origin, "https://commons.wikimedia.org");
  assert.equal(url.searchParams.get("gsroffset"), "8");
  assert.equal(url.searchParams.get("gsrsearch"), '"mont Fuji" filetype:bitmap');
  assert.equal(options.credentials, "omit");
  assert.equal(options.signal, signal);
  return Response.json({
    query: { pages: [{ pageid: image.id, title: "File:" + image.title, imageinfo: [{
      mime: "image/jpeg", url: image.original, thumburl: image.thumbnail + "?utm_source=test", descriptionurl: image.source,
      extmetadata: { Artist: { value: '<b>Auteur original</b>' }, LicenseShortName: { value: image.license } }
    }] }] },
    continue: { gsroffset: 16 }
  });
});
assert.deepEqual(result, { results: [{ ...image, artist: "Auteur original" }], next: 16 });
await assert.rejects(searchCommons("mont Fuji", 0, signal, async () => new Response("", { status: 503 })), /indisponible/);
console.log("Recherche d’images : intention, pagination, attribution, licences et validation des URL vérifiées.");
