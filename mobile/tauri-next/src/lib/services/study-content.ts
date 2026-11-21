type RecordLike = Record<string, unknown>;

interface QuestionBase {
  question: string;
  explanation: string;
}

export type Question = QuestionBase & (
  | { kind: "choices"; choices: string[]; answer: number }
  | { kind: "open"; answer: string }
);

export type StudyContent =
  | { kind: "quiz"; title: string; questions: Question[] }
  | { kind: "cards"; title: string; cards: { question: string; answer: string }[] };

const bounded = (value: unknown, size: number): string => typeof value === "string" ? value.trim().slice(0, size) : "";
const object = (value: unknown): RecordLike | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;

function readQuestion(input: unknown): Question | null {
  const row = object(input);
  if (!row) return null;
  const question = bounded(row.question, 4000);
  if (!question) return null;
  const explanation = bounded(row.explanation, 4000);
  const answer = typeof row.answer === "number" ? String(row.answer) : bounded(row.answer, 4000);
  const choices = Array.isArray(row.choices) ? row.choices.slice(0, 8).map(value => bounded(value, 2000)) : [];
  if (bounded(row.type, 20).toLowerCase() === "vf" || typeof row.answer === "boolean" || (!choices.length && /^(vrai|faux|true|false)$/i.test(answer))) {
    if (typeof row.answer !== "boolean" && !/^(vrai|faux|true|false)$/i.test(answer)) return null;
    return { kind: "choices", question, explanation, choices: ["Vrai", "Faux"], answer: row.answer === true || /^(vrai|true)$/i.test(answer) ? 0 : 1 };
  }
  if (choices.length >= 2 && choices.every(Boolean)) {
    let index = /^\d+$/.test(answer) ? Number(answer) : choices.indexOf(answer);
    if (index < 0 && /^[A-H]$/i.test(answer)) index = answer.toUpperCase().charCodeAt(0) - 65;
    if (!Number.isSafeInteger(index) || index < 0 || index >= choices.length) return null;
    return { kind: "choices", question, explanation, choices, answer: index };
  }
  return answer ? { kind: "open", question, explanation, answer } : null;
}

export function parseStudyContent(language: string, source: string): StudyContent | null {
  const kind = language.toLowerCase();
  if ((kind !== "quiz" && kind !== "cards") || source.length > 150_000) return null;
  let data: RecordLike | null;
  try {
    data = object(JSON.parse(source));
  } catch {
    // Conserve les anciens quiz dont le bloc JSON se termine par une virgule.
    try {
      const repaired = source.replace(/"(?:\\[\s\S]|[^"\\])*"|,(?=\s*[}\]])/g, token => token === "," ? "" : token);
      data = object(JSON.parse(repaired));
    } catch {
      return null;
    }
  }
  if (!data) return null;
  if (kind === "quiz" && Array.isArray(data.questions)) {
    const questions = data.questions.slice(0, 60).map(readQuestion).filter((item): item is Question => item !== null);
    return questions.length ? { kind, title: bounded(data.title, 180) || "Quiz", questions } : null;
  }
  if (kind === "cards" && Array.isArray(data.cards)) {
    const cards = data.cards.slice(0, 100).flatMap(input => {
      const row = object(input);
      const question = bounded(row?.q, 4000);
      const answer = bounded(row?.a, 4000);
      return question && answer ? [{ question, answer }] : [];
    });
    return cards.length ? { kind, title: bounded(data.title, 180) || "Cartes mémoire", cards } : null;
  }
  return null;
}

export function studyLoading(_code: string, language: string): string {
  const kind = language.toLowerCase();
  if (kind !== "quiz" && kind !== "cards") return "";
  const label = kind === "quiz" ? "Création du quiz…" : "Création des cartes…";
  return '<div class="study-loading"><span class="study-spinner" aria-hidden="true"></span>' + label + "</div>";
}
