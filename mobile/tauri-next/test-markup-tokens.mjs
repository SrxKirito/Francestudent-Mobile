// Découpe un fragment HTML en jetons comparables : balises (attributs triés) et textes.
// Utilisé par les tests de balisage Svelte ↔ ancienne interface. Ne dit rien du rendu visuel sur appareil.
export function tokens(html, { ignoreClasses = [] } = {}) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  for (const part of cleaned.split(/(<[^>]+>)/).filter(p => p.trim() !== "")) {
    if (!part.startsWith("<")) {
      out.push("#" + part.replace(/&gt;/g, ">").replace(/\s+/g, " ").trim());
      continue;
    }
    const closing = /^<\//.test(part);
    const tag = part.match(/^<\/?([a-zA-Z0-9]+)/)[1].toLowerCase();
    if (closing) {
      out.push("/" + tag);
      continue;
    }
    const attrs = [];
    for (const match of part.matchAll(/\s([a-zA-Z:-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) {
      const name = match[1];
      let value = match[2] ?? match[3] ?? "";
      if (name === "src") continue; // le chemin du logo change (ressource Vite)
      if (name === "value" && value === "") continue;
      if (name === "class") {
        value = value.split(/\s+/).filter(c => c && !ignoreClasses.includes(c)).sort().join(" ");
        if (!value) continue;
      }
      attrs.push(`${name}=${value}`);
    }
    out.push(`<${tag} ${attrs.sort().join(" ")}`.trim());
  }
  return out;
}
