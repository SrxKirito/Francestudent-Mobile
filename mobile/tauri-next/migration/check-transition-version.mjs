import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Transition build version rules. The legacy workflow publishes 1.1.N with build N;
 * the transition build keeps that scheme, so its build number is the patch number.
 * It must be strictly newer than every published `ios-*` release, otherwise iOS or
 * SideStore may refuse to replace the installed app.
 */
const VERSION = /^(\d{1,3})\.(\d{1,4})\.(\d{1,6})$/;

function parse(text) {
  const match = VERSION.exec(String(text).trim());
  return match ? match.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function transitionBuildNumber(version, publishedTags) {
  const wanted = parse(version);
  if (!wanted) throw new Error("Version invalide : attendu MAJEUR.MINEUR.CORRECTIF (ex. 1.1.40).");
  if (!Array.isArray(publishedTags)) throw new Error("Liste des versions publiées indisponible.");
  const published = publishedTags.map(tag => /^ios-(.+)$/.exec(String(tag).trim())).filter(Boolean).map(match => ({ tag: match[0], version: parse(match[1]) })).filter(item => item.version);
  if (!published.length) throw new Error("Aucune version ios-* publiée trouvée : vérification impossible, build annulé.");
  const newer = published.find(item => compare(wanted, item.version) <= 0);
  if (newer) throw new Error(`La version ${version} n'est pas supérieure à ${newer.tag}.`);
  return wanted[2];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, tags = ""] = process.argv.slice(2);
  console.log(transitionBuildNumber(version, tags.split(/\s+/).filter(Boolean)));
}
