import { createTranslator, NextIntlClientProvider, useTranslations } from 'next-intl';
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
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * The review screen is product UI first and marketing imagery second: the page
 * and the landing preview render these same two components and build their copy
 * with the same helpers. These pin the four score states and the answer review,
 * so a preview cannot quietly stop matching what a student is graded with.
 *
 * Expected copy comes from the same catalogues the components read, so a wording
 * change moves the expectation with the page instead of breaking the test.
 * Fixture text — a stem, an option label, a typed answer — stays literal: it is
 * the data under test, not UI copy.
 */
const copy = createTranslator({ locale: 'pl', messages: pl, namespace: 'AppQuizReviewPage' });
const landingCopy = createTranslator({ locale: 'pl', messages: pl, namespace: 'LandingPage' });

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

    expect(html).toContain(copy('score_percent', { percentage: 80 }));
    expect(html).toContain(copy('correct_of', { score: 4, total: 5 }));
  });

  it('scores an assignment in awarded points, not in questions', () => {
    const html = summary(
      attempt(7, ['mcq', 'mcq', 'mcq', 'mcq', 'open'], {
        isAssignment: true,
        totalPoints: 8,
      }),
    );

    expect(html).toContain(copy('score_percent', { percentage: 88 }));
    expect(html).toContain(copy('points_out_of', { score: 7, total: 8 }));
  });

  it('replaces the percentage with the closed-question count when a question is open', () => {
    const html = summary(attempt(2, ['mcq', 'mcq', 'mcq', 'open']));

    // Two of three closed answers is 67%, but the mandated headline names both
    // numbers instead: the denominator a student can check.
    expect(html).toContain(copy('correct_closed', { score: 2, total: 3 }));
    expect(html).toContain(copy('open_questions_line', { count: 1 }));
    expect(html).not.toContain(copy('score_percent', { percentage: 67 }));
  });

  it('shows no percentage at all when nothing was auto-graded', () => {
    const html = summary(attempt(0, ['open', 'open']));

    expect(html).toContain(copy('open_only_title'));
    // The score line is the one thing that must be absent, whatever its wording.
    expect(html).not.toContain('%');
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
    expect(html).toContain(copy('badge_incorrect'));
  });

  it('shows a typed answer for an open question instead of an answer key', () => {
    const html = review(
      { ...question, type: 'open', question_answers: [] },
      { selected_answer_id: null, text_answer: 'Odpowiedź kontrolna.', is_correct: false },
    );

    expect(html).toContain('Odpowiedź kontrolna.');
    expect(html).toContain(copy('badge_self_check'));
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
    // The result keeps the question identity, never its localised stem: the stem
    // is resolved where it is rendered, from the page's locale.
    expect(mixed.questions.map(({ subject }) => subject)).toEqual(DEMO_QUESTION_ORDER);
  });

  it('shows the score the visitor earned in the review header', () => {
    expect(summary(demo('pl', 'all').attempt)).toContain(
      copy('score_percent', { percentage: 100 }),
    );
    expect(summary(demo('pl', 'all').attempt)).toContain(
      copy('correct_of', { score: 4, total: 4 }),
    );
    expect(summary(demo('pl', 'none').attempt)).toContain(copy('score_percent', { percentage: 0 }));
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

    expect(html).toContain(copy('correct_of', { score: 4, total: 4 }));
    expect(html).not.toContain('2026');
    expect(html).not.toContain('text-center');
    expect(html).not.toContain('justify-center');
  });
});

function ResultProbe({ value, locale }: { value: QuizDemoResult; locale: QuizFixtureLocale }) {
  const t = useTranslations('AppQuizReviewPage');
  const tLanding = useTranslations('LandingPage');
  return createElement(QuizResultPreview, {
    result: value,
    locale,
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
  renderToStaticMarkup(
    provider(createElement(ResultProbe, { value: demo('pl', how), locale: 'pl' })),
  );

describe('QuizResultPreview', () => {
  it('announces the real score once, from the block focus lands on', () => {
    const html = renderedResult();
    const score = copy('correct_of', { score: 4, total: 4 });

    expect(html.split(score)).toHaveLength(2);
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf(score));
    expect(html).toContain('tabindex="-1"');
    // The demo shows the attempt just finished, not a dated record.
    expect(html).not.toContain('2026');
  });

  it('offers the primary action before the restart, both as 44px controls', () => {
    const html = renderedResult();
    const cta = landingCopy('quiz_end_cta');
    const restart = landingCopy('quiz_end_restart');

    expect(html).toContain('href="/register"');
    expect(html).toContain(cta);
    expect(html).toContain('type="button"');
    expect(html).toContain(restart);
    expect(html.indexOf(cta)).toBeLessThan(html.indexOf(restart));
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
    expect(list.split(copy('badge_correct'))).toHaveLength(5);
    // Two lines before a stem is cut; the whole stem stays in the DOM either way.
    expect(list).toContain('line-clamp-2');
    expect(list).not.toContain('truncate');
    // A record, not a destination: no link, no button, no hover in the list.
    expect(list).not.toContain('href=');
    expect(list).not.toContain('<button');
    expect(list).not.toContain('hover:');
  });

  it('resolves the stems from the locale it renders in, not from the finished attempt', () => {
    const html = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: 'en', messages: en },
        createElement(ResultProbe, { value: demo('pl', 'all'), locale: 'en' }),
      ),
    );
    const list = html.match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? '';

    for (const subject of DEMO_QUESTION_ORDER) {
      expect(list).toContain(QUIZ_QUESTION_FIXTURES.en[subject].stem);
      expect(list).not.toContain(QUIZ_QUESTION_FIXTURES.pl[subject].stem);
    }
  });

  it('keeps all four rows when three questions were skipped, marked quieter', () => {
    const html = renderedResult('skipped');
    const list = html.match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? '';

    expect(list.match(/<li /g)).toHaveLength(4);
    expect(list.split(copy('no_answer'))).toHaveLength(5);
    expect(list).toContain('text-muted-foreground');
    expect(list).not.toContain(copy('badge_correct'));
  });
});
