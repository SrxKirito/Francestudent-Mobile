
const patterns: [RegExp, string][] = [
  [/\b(?:cartes? interactives?|cartes? g[ée]ographiques?|itin[ée]raires?|points g[ée]ographiques?)\b/i,
    '{"kind":"map","places":[{"title":"Étape","lat":48.85,"lon":2.35,"text":"Détail"}],"route":true}. Donne uniquement des coordonnées crédibles. route relie les étapes approximativement.'],
  [/\b(?:simulateurs?|simulations?|calculatrices?|calcul interactif|convertisseur|visualisations? math[ée]matiques?)\b/i,
    '{"kind":"simulator","fields":[{"id":"intensity","label":"Intensité","type":"range","min":0,"max":100,"value":35}],"results":[{"label":"Puissance","unit":"W","formula":{"op":"mul","args":[{"field":"intensity"},2]}}]}. Opérations autorisées : add, sub, mul, div, pow, min, max ; sin, cos, sqrt, abs ont un argument. Une référence field désigne un champ numérique ou une case à cocher. Pour convertir un choix radio/select en nombre, utilise {"choice":"id","values":[0.5,1,2]} avec une valeur par option dans le même ordre.'],
  [/\b(?:formulaires?|curseurs?|cases? [àa] cocher|boutons? radio|menus? d[ée]roulants?|s[ée]lecteurs? de dates?|champs? de saisie|boutons? interactifs?)\b/i,
    '{"kind":"form","fields":[{"id":"jour","label":"Jour","type":"date","required":true},{"id":"choix","label":"Choix","type":"select","choices":["A","B"]}]}. Champs : text, textarea, number, range, date, checkbox, select et radio. Le formulaire reste local et n’envoie aucune donnée.'],
  [/\b(?:frises?|chronologies?)\b/i, '{"kind":"timeline","items":[{"label":"Date","title":"Événement","text":"Description"}]}.'],
  [/\b(?:organigrammes?|sch[ée]mas? interactifs?|diagrammes?|arbres? de d[ée]cision)\b/i,
    '{"kind":"diagram","items":[{"title":"Début"},{"title":"Suite"}],"edges":[[0,1]]}. Les liaisons désignent les indices des éléments.'],
  [/\b(?:carrousels?|galeries? interactives?)\b/i,
    '{"kind":"carousel","items":[{"title":"Carte","text":"Description","url":"https://source-verifiee.example"}]}. Une image directe Wikimedia Commons vérifiée peut être fournie dans image.'],
  [/\banimations?\b/i, '{"kind":"animation","items":[{"title":"Étape","text":"Description"}]}. Chaque élément est un écran de la séquence.'],
  [/\b(?:tableaux? interactifs?|tableaux? comparatifs?|comparateurs?|tableaux? de bord)\b/i,
    '{"kind":"table","columns":["Nom","Valeur"],"rows":[["A",12]]}. Les cellules sont du texte, des nombres, des booléens ou null.'],
  [/\b(?:listes? [àa] cocher|checklists?)\b/i, '{"kind":"checklist","items":["Élément"]}.'],
  [/\b(?:popovers?|infobulles?)\b/i, '{"kind":"popover","items":[{"title":"Information","content":"Détails"}]}.'],
  [/\baccord[ée]ons?\b/i, '{"kind":"accordion","items":[{"title":"Section","content":"Détails"}]}.'],
  [/\b(?:documents? [ée]ditables?|blocs? de r[ée]daction|[ée]diteurs? de texte)\b/i, '{"kind":"editor","text":"Contenu modifiable"} .'],
  [/\b(?:m[ée]t[ée]o|pr[ée]visions?|r[ée]servations?|cr[ée]neaux?|restaurants?|scores?|classements?|produits?|devises|fiches? de lieux|cartes? de contenu)\b/i,
    '{"kind":"cards","items":[{"title":"Résultat","label":"Date ou valeur","text":"Détails","url":"https://source-verifiee.example"}]}. Utilise des sources consultées pour les informations récentes. Si les données ou le service manquent, indique-le sans inventer de prix, disponibilité ou réservation.']
];

export function widgetInstruction(message: string): string {
  const formats = patterns.filter(([pattern]) => pattern.test(message)).slice(0, 3);
  if (!formats.length) return "";
  return 'Pour chaque rendu demandé et réalisable, réponds avec un bloc de code frst-ui contenant uniquement un objet JSON valide. Ajoute "version":1 et "title" à chacun. ' +
    'N’utilise aucun HTML, script ou URL non vérifiée. Les exemples ci-dessous décrivent les structures ; remplace toutes leurs données. ' +
    formats.map(([, rule]) => rule).join(" ");
}
