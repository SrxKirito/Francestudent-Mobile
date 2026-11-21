import type { StudyMode } from "../types/chat.ts";

const POWERPOINT_MARK = "Création PowerPoint.";
const POWERPOINT = POWERPOINT_MARK + " Crée une présentation visuelle et soignée. Donne une courte introduction puis un seul bloc de code pptx contenant uniquement ce JSON valide : " +
  '{"filename":"presentation.pptx","title":"Titre","subtitle":"Sous-titre","slides":[{"title":"Titre court","layout":"visual","illustration":"earth","bullets":["Idée clé"],"notes":"Détails oraux"}]}. ' +
  "Varie les mises en page hero, visual et cards. Pour les illustrations intégrées, utilise energy, earth, science, technology, education ou economy. " +
  'Une photo est facultative : "image":{"url":"URL HTTPS directe vérifiée","caption":"Légende et crédit"}. Respecte le nombre demandé (1 à 40 diapositives), avec 2 à 4 points courts par page. ' +
  "Appuie-toi sur la demande et les documents fournis. Demande le sujet si nécessaire et ne fournis aucun script ni faux lien.";

const STUDY_RULE = "Appuie-toi uniquement sur le contenu fourni. S'il manque, demande le cours ou le document.";
const STUDY: Record<Exclude<StudyMode, "">, string> = {
  fiches: "Mode étudiant — FICHES DE RÉVISION. Rédige des fiches en français avec une définition, les points clés, les formules ou dates importantes, un exemple et un résumé. " + STUDY_RULE,
  quiz: "Mode étudiant — QUIZ INTERACTIF. Fais un quiz en français avec QCM, vrai/faux et questions ouvertes. Écris un seul bloc de code quiz avec uniquement du JSON valide : " +
    '{"title":"Titre","questions":[{"type":"qcm","question":"Question ?","choices":["A","B","C","D"],"answer":0,"explanation":"Correction"}]}. ' +
    'Pour un qcm, answer est l’index dès 0. Pour vf, answer est un booléen. Pour ouverte, answer contient le texte attendu. ' + STUDY_RULE,
  cartes: "Mode étudiant — CARTES MÉMOIRE. Crée des questions courtes en français. Écris un seul bloc de code cards avec uniquement du JSON valide : " +
    '{"title":"Titre","cards":[{"q":"Question ?","a":"Réponse"}]}. ' + STUDY_RULE
};

const CHART_PATTERN = /\b(?:graphique|histogramme|camembert|nuage de points|courbe interactive)s?\b/i;
const CHART_RULE = "Si des données fiables sont disponibles et que la demande porte sur un graphique, ajoute un bloc de code frst-ui avec uniquement du JSON : " +
  '{"version":1,"kind":"chart","title":"Titre","chart":"line","series":[{"name":"Série","points":[{"label":"Janvier","y":12}]}]}. ' +
  "Utilise line, bar, pie ou scatter ; scatter exige aussi x sur chaque point. Ne présente pas des données inventées comme des données réelles.";

export function isPowerPointPrompt(value?: string): boolean {
  return value?.startsWith(POWERPOINT_MARK) === true;
}

export function chatPrompt(text: string, options: {
  skillPrefix?: string; studyMode: StudyMode; powerpointMode: boolean; previousPrompt?: string;
}): string {
  const mode = options.studyMode || (/\b(flashcards?|cartes m[ée]moire)\b/i.test(text)
    ? "cartes" : /\bquiz\b/i.test(text) ? "quiz" : /\bfiches? de r[ée]vision\b/i.test(text) ? "fiches" : "");
  const powerpoint = options.powerpointMode || /\b(power[ -]?point|pptx)\b/i.test(text) ||
    (isPowerPointPrompt(options.previousPrompt) && /\b(modifi|corrig|ajout|am[ée]lior|diapos|slides?)/i.test(text));
  const format = powerpoint ? POWERPOINT : mode ? STUDY[mode] : CHART_PATTERN.test(text) ? CHART_RULE : "";
  return (format ? format + "\n\n" : "") + (options.skillPrefix || "") + text;
}
