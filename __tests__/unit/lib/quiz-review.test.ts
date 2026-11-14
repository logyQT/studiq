import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildQuizDemoResult,
  type QuizDemoResult,
} from '@/components/marketing/previews/quiz-demo-result';
import {
  DEMO_QUESTION_ORDER,
  QUIZ_QUESTION_FIXTURES,
  type QuizFixtureLocale,
} from '@/components/marketing/previews/quiz-question-fixtures';
import { QuizResultPreview } from '@/components/marketing/previews/quiz-result-preview';
import { questionReviewLabels, scoreSummaryLabels } from '@/components/quiz/quiz-review-labels';
import { QuizQuestionReview } from '@/components/quiz/quiz-question-review';
import {
  QuizScoreSummary,
  type QuizScoreSummaryAttempt,
} from '@/components/quiz/quiz-score-summary';
import pl from '@/i18n/messages/pl.json';

/**
 * The review screen is product UI first and marketing imagery second: the page
 * and the landing preview render these same two components and build their copy
 * with the same helpers. These pin the four score states and the answer review,
 * so a preview cannot quietly stop matching what a student is graded with.
 */
const provider = (child: ReactElement) =>
  createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, child);

function SummaryProbe({ value }: { value: QuizScoreSummaryAttempt }) {
  const t = useTranslations('AppQuizReviewPage');
  return createElement(QuizScoreSummary, {
    attempt: value,
    locale: 'pl',
    labels: scoreSummaryLabels(t),
  });
}

const summary = (value: QuizScoreSummaryAttempt) =>
  renderToStaticMarkup(provider(createElement(SummaryProbe, { value })));

const attempt = (
  score: number,
  types: readonly string[],
  overrides: Partial<QuizScoreSummaryAttempt> = {},
): QuizScoreSummaryAttempt => ({
  score,
  totalQuestions: types.length,
  totalPoints: null,
  isAssignment: false,
  startedAt: '2026-11-12T09:14:00.000Z',
  questions: types.map((type) => ({ type })),
  ...overrides,
});

describe('QuizScoreSummary', () => {
  it('scores a practice quiz from the closed questions it asked', () => {
    const html = summary(attempt(4, ['mcq', 'mcq', 'mcq', 'mcq', 'mcq']));

    expect(html).toContain('Wynik: 80%');
    expect(html).toContain('4 z 5 poprawnych');
  });

  it('scores an assignment in awarded points, not in questions', () => {
    const html = summary(
      attempt(7, ['mcq', 'mcq', 'mcq', 'mcq', 'open'], {
        isAssignment: true,
        totalPoints: 8,
      }),
    );

    expect(html).toContain('Wynik: 88%');
    expect(html).toContain('7 z 8 punktów');
  });

  it('replaces the percentage with the closed-question count when a question is open', () => {
    const html = summary(attempt(2, ['mcq', 'mcq', 'mcq', 'open']));

    // Two of three closed answers is 67%, but the mandated headline names both
    // numbers instead: the denominator a student can check.
    expect(html).toContain('Poprawnie: 2 z 3 pytań zamkniętych');
    expect(html).toContain('Pytanie otwarte: 1');
    expect(html).not.toContain('Wynik: 67%');
  });

  it('shows no percentage at all when nothing was auto-graded', () => {
    const html = summary(attempt(0, ['open', 'open']));

    expect(html).toContain('Tylko pytania otwarte');
    expect(html).not.toContain('Wynik');
  });

  it('keeps the attempt date on the review card, where the demo drops it', () => {
    expect(summary(attempt(4, ['mcq']))).toContain('12.11.2026');
  });
});

const question = {
  id: 'q1',
  content: 'Który narząd wytwarza insulinę?',
  type: 'mcq',
  question_answers: [
    { id: 'a', content: 'Trzustka', is_correct: true },
    { id: 'b', content: 'Wątroba', is_correct: false },
  ],
} as const;

function QuestionProbe({
  value,
  answer,
}: {
  value: typeof question;
  answer: { selected_answer_id: string | null; text_answer: string | null; is_correct: boolean };
}) {
  const t = useTranslations('AppQuizReviewPage');
  return createElement(QuizQuestionReview, {
    question: value,
    answer,
    isAssignment: false,
    labels: questionReviewLabels(t, { number: 1, type: value.type }),
  });
}

const review = (
  value: typeof question,
  answer: { selected_answer_id: string | null; text_answer: string | null; is_correct: boolean },
) => renderToStaticMarkup(provider(createElement(QuestionProbe, { value, answer })));

describe('QuizQuestionReview', () => {
  it('marks the key answer and the wrong pick separately', () => {
    const html = review(question, {
      selected_answer_id: 'b',
      text_answer: null,
      is_correct: false,
    });

    expect(html).toContain('data-correct="true"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('Niepoprawnie');
  });

  it('shows a typed answer for an open question instead of an answer key', () => {
    const html = review(
      { ...question, type: 'open', question_answers: [] },
      { selected_answer_id: null, text_answer: 'Odpowiedź kontrolna.', is_correct: false },
    );

    expect(html).toContain('Odpowiedź kontrolna.');
    expect(html).toContain('Do samodzielnej oceny');
  });
});

/**
 * The demo's own answers, keyed the way the preview stores them. `all` picks the
 * fixture's key, `none` picks any other option, `skipped` answers nothing.
 */
function demoAnswers(locale: QuizFixtureLocale, how: 'all' | 'none' | 'skipped') {
  if (how === 'skipped') return {};
  return Object.fromEntries(
    DEMO_QUESTION_ORDER.map((subject) => {
      const fixture = QUIZ_QUESTION_FIXTURES[locale][subject];
      const pick =
        how === 'all'
          ? fixture.correctOptionId
          : fixture.options.find((option) => option.id !== fixture.correctOptionId)?.id;
      return [`${subject}:option`, pick ?? ''];
    }),
  );
}

const demo = (locale: QuizFixtureLocale, how: 'all' | 'none' | 'skipped') =>
  buildQuizDemoResult({
    locale,
    answers: demoAnswers(locale, how),
    startedAt: '2026-11-14T09:00:00.000Z',
  });

describe('buildQuizDemoResult', () => {
  it('grades the four demo answers against the fixtures key', () => {
    expect(DEMO_QUESTION_ORDER).toHaveLength(4);
    expect(demo('pl', 'all').attempt.score).toBe(4);
    expect(demo('pl', 'none').attempt.score).toBe(0);
    expect(demo('pl', 'skipped').attempt.score).toBe(0);
  });

  it('counts one keyed selection as one correct answer', () => {
    for (const subject of DEMO_QUESTION_ORDER) {
      const fixture = QUIZ_QUESTION_FIXTURES.pl[subject];
      const only = buildQuizDemoResult({
        locale: 'pl',
        answers: { [`${subject}:option`]: fixture.correctOptionId ?? '' },
        startedAt: '2026-11-14T09:00:00.000Z',
      });

      expect(only.attempt.score, subject).toBe(1);
    }
  });

  it('reports the attempt shape the review header reads', () => {
    const { attempt: graded } = demo('pl', 'all');

    expect(graded.totalQuestions).toBe(4);
    // A practice attempt has no awardable points and no reviewer.
    expect(graded.totalPoints).toBeNull();
    expect(graded.isAssignment).toBe(false);
    expect(graded.questions.map((entry) => entry.type)).toEqual([
      'mcq',
      'true_false',
      'mcq',
      'mcq',
    ]);
  });

  it('tells a skipped question apart from a wrong one', () => {
    const mixed = buildQuizDemoResult({
      locale: 'pl',
      answers: { 'biology:option': 'mitochondrium', 'history:option': 'false' },
      startedAt: '2026-11-14T09:00:00.000Z',
    });

    expect(mixed.questions.map(({ status }) => status)).toEqual([
      'correct',
      'wrong',
      'skipped',
      'skipped',
    ]);
    expect(mixed.questions.map(({ text }) => text)).toEqual(
      DEMO_QUESTION_ORDER.map((subject) => QUIZ_QUESTION_FIXTURES.pl[subject].stem),
    );
  });

  it('shows the score the visitor earned in the review header', () => {
    expect(summary(demo('pl', 'all').attempt)).toContain('Wynik: 100%');
    expect(summary(demo('pl', 'all').attempt)).toContain('4 z 4 poprawnych');
    expect(summary(demo('pl', 'none').attempt)).toContain('Wynik: 0%');
  });
});

function BareProbe({ value }: { value: QuizScoreSummaryAttempt }) {
  const t = useTranslations('AppQuizReviewPage');
  return createElement(QuizScoreSummary, {
    attempt: value,
    locale: 'pl',
    labels: scoreSummaryLabels(t),
    variant: 'bare',
  });
}

describe('QuizScoreSummary (bare)', () => {
  it('keeps the score and drops the date and the centring the demo does not need', () => {
    const html = renderToStaticMarkup(
      provider(createElement(BareProbe, { value: demo('pl', 'all').attempt })),
    );

    expect(html).toContain('4 z 4 poprawnych');
    expect(html).not.toContain('2026');
    expect(html).not.toContain('text-center');
    expect(html).not.toContain('justify-center');
  });
});

function ResultProbe({ value }: { value: QuizDemoResult }) {
  const t = useTranslations('AppQuizReviewPage');
  const tLanding = useTranslations('LandingPage');
  return createElement(QuizResultPreview, {
    result: value,
    locale: 'pl',
    labels: { cta: tLanding('quiz_end_cta'), restart: tLanding('quiz_end_restart') },
    scoreLabels: scoreSummaryLabels(t),
    statusLabels: {
      correct: t('badge_correct'),
      wrong: t('badge_incorrect'),
      skipped: t('no_answer'),
    },
    onRestart: () => {},
  });
}

const renderedResult = (how: 'all' | 'none' | 'skipped' = 'all') =>
  renderToStaticMarkup(provider(createElement(ResultProbe, { value: demo('pl', how) })));

describe('QuizResultPreview', () => {
  it('announces the real score once, from the block focus lands on', () => {
    const html = renderedResult();

    expect(html.match(/4 z 4 poprawnych/g)).toHaveLength(1);
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('4 z 4 poprawnych'));
    expect(html).toContain('tabindex="-1"');
    // The demo shows the attempt just finished, not a dated record.
    expect(html).not.toContain('2026');
  });

  it('offers the primary action before the restart, both as 44px controls', () => {
    const html = renderedResult();

    expect(html).toContain('href="/register"');
    expect(html).toContain('Rozwiąż własny test');
    expect(html).toContain('type="button"');
    expect(html).toContain('Zacznij od nowa');
    expect(html.indexOf('Rozwiąż własny test')).toBeLessThan(html.indexOf('Zacznij od nowa'));
    expect(html.match(/h-11/g)).toHaveLength(2);
    expect(html.match(/rounded-control/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/<a[^>]*bg-primary[^>]*text-primary-foreground/);
    expect(html).toMatch(/<button[^>]*border-input/);
    // No `signal` on either: the hero keeps the page's one lime action.
    expect(html).not.toContain('bg-signal');
  });

  it('lists every question once, with a glyph and a spoken state per row', () => {
    const html = renderedResult();
    const list = html.match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? '';

    expect(list.match(/<li /g)).toHaveLength(4);
    for (const subject of DEMO_QUESTION_ORDER) {
      expect(list).toContain(QUIZ_QUESTION_FIXTURES.pl[subject].stem);
    }
    // The state is not colour or shape alone: each row names it for a screen reader.
    expect(list.match(/Poprawnie/g)).toHaveLength(4);
    expect(list).toContain('truncate');
    // A record, not a destination: no link, no button, no hover in the list.
    expect(list).not.toContain('href=');
    expect(list).not.toContain('<button');
    expect(list).not.toContain('hover:');
  });

  it('keeps all four rows when three questions were skipped, marked quieter', () => {
    const html = renderedResult('skipped');
    const list = html.match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? '';

    expect(list.match(/<li /g)).toHaveLength(4);
    expect(list.match(/Brak odpowiedzi/g)).toHaveLength(4);
    expect(list).toContain('text-muted-foreground');
    expect(list).not.toContain('Poprawnie');
  });
});
