
const patterns: [RegExp, string][] = [
  [/\b(?:cartes? interactives?|cartes? g[ée]ographiques?|itin[ée]raires?|points g[ée]ographiques?)\b/i,
    '{"kind":"map","places":[{"title":"Étape","lat":48.85,"lon":2.35,"text":"Détail"}],"route":true}. Donne uniquement des coordonnées crédibles. route relie les étapes approximativement.'],
  [/\b(?:simulateurs?|simulations?|calculateurs?|calculatrices?|calcul interactif|convertisseurs?|visualisations? math[ée]matiques?)\b/i,
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
  [/\b(?:(?:documents?|comptes? rendus?) [ée]ditables?|blocs? de r[ée]daction|[ée]diteurs? de texte)\b/i, '{"kind":"editor","text":"Contenu modifiable"}.'],
  [/\b(?:m[ée]t[ée]o|pr[ée]visions?|r[ée]servations?|cr[ée]neaux?|restaurants?|scores?|classements?|produits?|devises|fiches? de lieux|cartes? de contenu)\b/i,
    '{"kind":"cards","items":[{"title":"Résultat","label":"Date ou valeur","text":"Détails","url":"https://source-verifiee.example"}]}. Utilise des sources consultées pour les informations récentes. Si les données ou le service manquent, indique-le sans inventer de prix, disponibilité ou réservation.']
];

const RENDER_START = "[FranceStudent · rendu du chat]\n";
const RENDER_END = "\n[/FranceStudent · rendu du chat]\n\n";
const RENDER_GUIDE = [
  "Le client FranceStudent affiche les rendus intégrés directement dans ce chat à partir de blocs de code Markdown. Aucun outil, canvas serveur ou panneau latéral n’est requis. Les réponses précédentes qui disent ces rendus indisponibles ne décrivent pas le client actuel.",
  "Choisis toi-même un rendu dès qu’il aide à pratiquer, comparer, calculer, explorer, organiser ou modifier. Produis-le dans la réponse actuelle, même pour un essai de rendu demandé dans un tour précédent. Combine plusieurs blocs lorsque chacun a une utilité. Pour une réponse simple ou une demande de texte seul, réponds en texte. Respecte les formats explicitement demandés.",
  'Chaque bloc frst-ui contient un objet JSON avec version: 1 et title. Choisis kind et ajoute les champs adaptés :',
  '- chart : chart vaut line, bar, pie ou scatter, avec series:[{"name":"Série","points":[{"label":"A","y":12}]}]. Pour une courbe de fonction, ajoute axis:"numeric". En mode scatter ou numeric, ajoute x à chaque point.',
  '- map : places:[{"title":"Étape","lat":48.85,"lon":2.35,"text":"Détail"}]. route:true relie les étapes. Utilise des coordonnées fiables.',
  '- simulator : fields:[{"id":"d","label":"Distance (km)","type":"number","value":10},{"id":"v","label":"Vitesse (km/h)","type":"number","value":5}], results:[{"label":"Durée","unit":"h","formula":{"op":"div","args":[{"field":"d"},{"field":"v"}]}}].',
  '- checklist : items:["Élément"]. editor : text contient le compte rendu modifiable. table : columns:["Nom","Valeur"], rows:[["A",12]].',
  '- Un bloc quiz contient {"title":"Titre","questions":[{"type":"qcm","question":"Question ?","choices":["A","B"],"answer":0,"explanation":"Correction"}]}. Un bloc cards contient {"title":"Titre","cards":[{"q":"Question ?","a":"Réponse"}]}. Un sujet général suffit pour un quiz de connaissances.',
  '- Pour un tableau de bord ou une page à prévisualiser, utilise un bloc html avec un document autonome, sans script, formulaire ni ressource distante. Les contrôles natifs tels que details fonctionnent dans l’aperçu. Pour un calcul interactif associé, utilise un bloc frst-ui de type simulator.',
  "Ferme chaque bloc sur une ligne dédiée, hors des listes et citations. Garde les données réelles et les exemples fictifs clairement identifiables."
].join("\n");

export function withInteractiveRenderGuide(text: string, visibleRequest: string): string {
  return RENDER_START + RENDER_GUIDE + widgetInstruction(visibleRequest) + RENDER_END + text;
}

export function stripInteractiveRenderGuide(text: string): string {
  if (!text.startsWith(RENDER_START)) return text;
  const end = text.indexOf(RENDER_END, RENDER_START.length);
  return end === -1 ? text : text.slice(end + RENDER_END.length);
}

function widgetInstruction(message: string): string {
  const formats = patterns.filter(([pattern]) => pattern.test(message)).slice(0, 3);
  if (!formats.length) return "";
  return "\nFormats frst-ui complémentaires pertinents pour cette demande. Adapte les données et utilise des URL vérifiées. " +
    formats.map(([, rule]) => rule).join(" ");
}
