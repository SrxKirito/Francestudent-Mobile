export interface CommonsImage {
  id: number;
  title: string;
  thumbnail: string;
  original: string;
  source: string;
  artist: string;
  license: string;
}
export interface ImageSearch {
  query: string;
  results?: readonly CommonsImage[];
  next?: number;
}

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
export const MAX_IMAGE_RESULTS = 32;
const ROOTS = ["upload.wikimedia.org", "thumb.wikimedia.org"];
const label = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 260) : "";

export function imageSearchQuery(input: string): string | null {
  const match = input.trim().match(/^(?:\/images\s+|(?:(?:peux-tu|pourrais-tu)\s+)?(?:trouve|cherche|recherche|montre|affiche)(?:-moi| moi)?\s+(?:des\s+|les\s+|quelques\s+|une?\s+)?(?:images?|photos?)\s+(?:(?:de|du|des|sur)\s+|d[’'])?|(?:find|show|search for)(?: me)?\s+(?:some\s+)?(?:pictures?|photos?|images?)\s+(?:(?:of|for)\s+)?)(.+)$/iu);
  const query = match?.[1]?.replace(/\s+(?:s[’']il te plaît|stp)\s*[.!?]*$/iu, "").replace(/[.!?]+$/g, "").trim();
  return query && query.length <= 160 ? query : null;
}

function checkedUrl(value: unknown, origins: string[], prefix: string): string {
  if (typeof value !== "string" || value.length > 2500) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !origins.includes(url.hostname) || !url.pathname.startsWith(prefix)) return "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

export function normalizeCommonsImage(value: unknown): CommonsImage | null {
  const row = value as Partial<CommonsImage> | null;
  if (!row || !Number.isSafeInteger(row.id) || Number(row.id) <= 0) return null;
  const thumbnail = checkedUrl(row.thumbnail, ROOTS, "/wikipedia/commons/");
  const original = checkedUrl(row.original, ROOTS, "/wikipedia/commons/");
  const source = checkedUrl(row.source, ["commons.wikimedia.org"], "/wiki/File:");
  const title = label(row.title);
  if (!thumbnail || !original || !source || !title) return null;
  return { id: Number(row.id), thumbnail, original, source, title, artist: label(row.artist), license: label(row.license) };
}

export function canSaveCommonsImage(image: CommonsImage): boolean {
  return /^(Public domain|CC0(?: 1\.0)?|CC BY(?:-SA)? [1-4]\.0)$/i.test(image.license);
}

interface CommonsPage {
  pageid: number;
  index?: number;
  title: string;
  imageinfo?: {
    mime?: string;
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
  }[];
}

export async function searchCommons(query: string, offset: number, signal: AbortSignal, request = fetch) {
  const chars = query.trim().slice(0, 160).replace(/["\\]/g, " ").trim();
  if (!chars) return { results: [] as CommonsImage[], next: undefined };
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "search", gsrsearch: '"' + chars + '" filetype:bitmap',
    gsrnamespace: "6", gsrlimit: "8", gsroffset: String(offset),
    prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "320",
    iiextmetadatafilter: "Artist|LicenseShortName"
  });
  const response = await request(ENDPOINT + "?" + params, {
    signal, credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Api-User-Agent": "FranceStudentMobile/0.1 (https://github.com/SrxKirito/Francestudent-Mobile)" }
  });
  if (!response.ok) throw new Error("Wikimedia Commons est temporairement indisponible.");
  const data = await response.json() as { error?: unknown; query?: { pages?: CommonsPage[] }; continue?: { gsroffset?: number } };
  if (data.error) throw new Error("Wikimedia Commons n’a pas pu traiter la recherche.");
  const results = (Array.isArray(data.query?.pages) ? data.query.pages.slice(0, 8) : []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap(page => {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp|gif)$/i.test(info.mime ?? "")) return [];
    const image = normalizeCommonsImage({
      id: page.pageid, title: label(page.title).replace(/^File:/, ""), thumbnail: info.thumburl, original: info.url,
      source: info.descriptionurl, artist: info.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, " "),
      license: info.extmetadata?.LicenseShortName?.value
    });
    return image ? [image] : [];
  });
  const next = data.continue?.gsroffset;
  return { results, next: typeof next === "number" && Number.isInteger(next) && next > offset && next < MAX_IMAGE_RESULTS ? next : undefined };
}
