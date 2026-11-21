<script lang="ts">
  import type { StudyContent } from "../lib/services/study-content.ts";
  import { renderMarkdownText } from "../lib/services/markdown.ts";

  let { data }: { data: StudyContent } = $props();
  type QuizAnswer = { picked: number | null; correct: boolean | null };
  let answers: Record<number, QuizAnswer> = $state({});
  let flipped: Record<number, boolean> = $state({});
  const score = $derived(Object.values(answers).filter(answer => answer.correct === true).length);
  const done = $derived(Object.values(answers).filter(answer => answer.correct !== null).length);
</script>

{#if data.kind === "quiz"}
  <section class="quiz-block" aria-label={data.title}>
    <header class="quiz-head">
      <strong class="quiz-title">{data.title}</strong>
      <span class="quiz-score" role="status" aria-label="Bonnes réponses">{score} / {data.questions.length}</span>
    </header>
    {#each data.questions as question, i}
      {@const answer = answers[i]}
      <div class="quiz-q">
        <div class="quiz-qtext"><b>{i + 1}.</b> {@html renderMarkdownText(question.question)}</div>
        {#if question.kind === "choices"}
          <div class="quiz-choices">
            {#each question.choices as choice, j}
              <button
                type="button"
                class="quiz-choice"
                class:correct={answer !== undefined && j === question.answer}
                class:wrong={answer?.picked === j && j !== question.answer}
                disabled={answer !== undefined}
                onclick={() => { answers[i] = { picked: j, correct: j === question.answer }; }}
              >
                <span class="quiz-letter" aria-hidden="true">{String.fromCharCode(65 + j)}</span>
                <span>{choice}</span>
              </button>
            {/each}
          </div>
          {#if answer}
            <div class="quiz-feedback" role="status">
              <b>{answer.correct ? "Bonne réponse !" : "Mauvaise réponse."}</b>
              {#if !answer.correct}<p>Réponse attendue : {question.choices[question.answer]}</p>{/if}
              {#if question.explanation}<div class="quiz-explain">{@html renderMarkdownText(question.explanation)}</div>{/if}
            </div>
          {/if}
        {:else if answer}
          <div class="quiz-feedback">
            <b>Réponse attendue</b>
            {@html renderMarkdownText(question.answer)}
            {#if question.explanation}<div class="quiz-explain">{@html renderMarkdownText(question.explanation)}</div>{/if}
            {#if answer.correct === null}
              <div class="quiz-selfrow">
                <button type="button" class="quiz-self" onclick={() => { answers[i] = { picked: null, correct: true }; }}>Je savais</button>
                <button type="button" class="quiz-self" onclick={() => { answers[i] = { picked: null, correct: false }; }}>À revoir</button>
              </div>
            {/if}
          </div>
        {:else}
          <button type="button" class="quiz-reveal" onclick={() => { answers[i] = { picked: null, correct: null }; }}>Voir la réponse</button>
        {/if}
      </div>
    {/each}
    {#if done === data.questions.length}
      <div class="quiz-result">
        <b>Score final : {score} / {done}</b>
        <button type="button" class="quiz-retry" onclick={() => { answers = {}; }}>Recommencer</button>
      </div>
    {/if}
  </section>
{:else}
  <section class="cards-block" aria-label={data.title}>
    <header class="quiz-head">
      <strong class="quiz-title">{data.title}</strong>
      <span class="quiz-score">{data.cards.length} cartes</span>
    </header>
    <div class="cards-grid">
      {#each data.cards as card, i}
        <button type="button" class="flashcard" class:flipped={flipped[i]} aria-pressed={Boolean(flipped[i])} onclick={() => { flipped[i] = !flipped[i]; }}>
          <span class="fc-num">Carte {i + 1}</span>
          {#if flipped[i]}<span class="fc-a">{card.answer}</span>{:else}<span class="fc-q">{card.question}</span>{/if}
          <span class="fc-hint">{flipped[i] ? "Revoir la question" : "Voir la réponse"}</span>
        </button>
      {/each}
    </div>
  </section>
{/if}
