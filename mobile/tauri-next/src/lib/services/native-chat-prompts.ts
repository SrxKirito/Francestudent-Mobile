import type { StudyMode } from "../types/chat.ts";

const POWERPOINT_MARK = "Création PowerPoint.";
const POWERPOINT = POWERPOINT_MARK + " Crée une présentation visuelle et soignée. Donne une courte introduction puis un seul bloc de code pptx contenant uniquement ce JSON valide : " +
  '{"filename":"presentation.pptx","title":"Titre","subtitle":"Sous-titre","slides":[{"title":"Titre court","layout":"visual","illustration":"earth","bullets":["Idée clé"],"notes":"Détails oraux"}]}. ' +
  "Varie les mises en page hero, visual et cards. Pour les illustrations intégrées, utilise energy, earth, science, technology, education ou economy. " +
  'Une photo est facultative : "image":{"url":"URL HTTPS directe vérifiée","caption":"Légende et crédit"}. Respecte le nombre demandé (1 à 40 diapositives), avec 2 à 4 points courts par page. ' +
  "Appuie-toi sur la demande et les documents fournis. Demande le sujet si nécessaire et ne fournis aucun script ni faux lien.";

const STUDY_RULE = "Appuie-toi sur le contenu fourni. Si seul un sujet est indiqué, utilise les connaissances générales sur ce sujet. Demande le cours ou le document lorsqu’il est nécessaire pour répondre.";
const STUDY: Record<Exclude<StudyMode, "">, string> = {
  fiches: "Mode étudiant — FICHES DE RÉVISION. Rédige des fiches en français avec une définition, les points clés, les formules ou dates importantes, un exemple et un résumé. " + STUDY_RULE,
  quiz: "Mode étudiant — QUIZ INTERACTIF. Fais un quiz en français avec QCM, vrai/faux et questions ouvertes. Mets le quiz dans un bloc de code quiz avec uniquement du JSON valide : " +
    '{"title":"Titre","questions":[{"type":"qcm","question":"Question ?","choices":["A","B","C","D"],"answer":0,"explanation":"Correction"}]}. ' +
    'Pour un qcm, answer est l’index dès 0. Pour vf, answer est un booléen. Pour ouverte, answer contient le texte attendu. ' + STUDY_RULE,
  cartes: "Mode étudiant — CARTES MÉMOIRE. Crée des questions courtes en français. Mets les cartes mémoire dans un bloc de code cards avec uniquement du JSON valide : " +
    '{"title":"Titre","cards":[{"q":"Question ?","a":"Réponse"}]}. ' + STUDY_RULE
};

const WORD_RULE = "Pour générer un document Word, donne le texte final dans un seul bloc de code docx. Écris sur la première ligne # document.docx, puis le contenu. Utilise # devant les titres.";
const EXCEL_RULE = 'Pour générer un classeur Excel, écris un seul bloc de code xlsx. La première ligne peut être # tableau.xlsx. Ensuite, écris uniquement un tableau JSON de lignes, par exemple [["Nom","Valeur"],["A",12]]. Les valeurs sont texte, nombres, booléens ou null.';


export function isPowerPointPrompt(value?: string): boolean {
  return value?.startsWith(POWERPOINT_MARK) === true;
}

export function isDedicatedFormatPrompt(value: string): boolean {
  return isPowerPointPrompt(value) || value.startsWith(WORD_RULE) || value.startsWith(EXCEL_RULE);
}

export function chatPrompt(text: string, options: {
  skillPrefix?: string; studyMode: StudyMode; powerpointMode: boolean; previousPrompt?: string;
}): string {
  const mode = options.studyMode;
  const powerpoint = options.powerpointMode || /\b(power[ -]?point|pptx)\b/i.test(text) ||
    (isPowerPointPrompt(options.previousPrompt) && /\b(modifi|corrig|ajout|am[ée]lior|diapos|slides?)/i.test(text));
  const office = /\b(xlsx|classeur excel|tableau excel|fichier excel)\b/i.test(text) ? EXCEL_RULE :
    /\b(docx|document word|fichier word)\b/i.test(text) ? WORD_RULE : "";
  const format = options.powerpointMode ? POWERPOINT : office || (powerpoint ? POWERPOINT : mode ? STUDY[mode] : "");
  return (format ? format + "\n\n" : "") + (options.skillPrefix || "") + text;
}
