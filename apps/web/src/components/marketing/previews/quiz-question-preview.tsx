'use client';

import { createTranslator, useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
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
import { QuizQuestionView } from '@/components/quiz/quiz-question-view';
import { scoreSummaryLabels } from '@/components/quiz/quiz-review-labels';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * The quiz card as the marketing page shows it: the same component the student
 * answers on, driven by fixture data instead of a fetch.
 *
 * It is interactive on purpose — you can pick an answer, step forward and back
 * through four subjects (biology, history, driving theory, SQL), and finish on a
 * score graded from the answers you gave. That is the product doing its actual
 * job rather than a picture of it doing so, and it costs state, not a rendering
 * strategy: the card was already a client component.
 *
 * Both the fixtures and the card copy follow the page's locale. A Polish card on
 * an English page is the mixed-locale mistake DESIGN.md bans, and it is what the
 * first version shipped.
 */
const MESSAGES = { pl, en };

export function QuizQuestionPreview() {
  const rawLocale = useLocale();
  const locale: QuizFixtureLocale = rawLocale === 'en' ? 'en' : 'pl';
  const tLanding = useTranslations('LandingPage');
  const tReview = useTranslations('AppQuizReviewPage');

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizDemoResult | null>(null);

  const t = useMemo(
    () =>
      createTranslator({
        locale,
        messages: MESSAGES[locale],
        namespace: 'AppQuizTakingPage',
      }),
    [locale],
  );

  const key = DEMO_QUESTION_ORDER[index] ?? 'biology';
  const fixture = QUIZ_QUESTION_FIXTURES[locale][key];
  const position = index + 1;
  const total = DEMO_QUESTION_ORDER.length;

  const question = {
    ...fixture,
    // The fixtures carry their own numbering for their own screens; here the four
    // of them are one sequence, so the counter comes from the index.
    position,
    total,
    selectedOptionId: answers[`${key}:option`] ?? null,
    textAnswer: answers[`${key}:text`] ?? '',
  };

  /*
   * The fixtures are different shapes — four options, two buttons — so the card's
   * own height swings. A column flex box reserves the measured maximum and the
   * view grows into it, which pins the footer so stepping cannot move it or the
   * page. The result renders inside the same frame, so finishing does not move
   * the card either.
   *
   * The reservations are measured, not calculated, and they are a step function
   * of the card's width: each is the tallest of the four fixtures in the longer
   * locale at the narrowest card its band allows, plus the 76px of chrome above
   * the card (the counter line, the progress bar and their gaps), plus a few px
   * of headroom — 656 from 320 (646 + 10, the footer's buttons stack below 360),
   * 584 from 360 (576 + 8, the options still wrap in the full-width column), 520
   * from 640 (512 + 8), 492 from 860 (484 + 8, the widest option stops wrapping),
   * 584 from 1024 (576 + 8, the copy and the card split and the rail leaves the
   * card 347px) and 560 from 1280 (552 + 8, the 70rem container caps the card at
   * 387px for every wider viewport). The 1024 step is taller than the 860 one
   * because the two-column split narrows the card again. The first two steps are
   * arbitrary min-widths rather than `sm:` because the ladder has to sort upward:
   * a named variant emitted after an arbitrary one would win at every wider width.
   */
  return (
    <div className="flex min-h-[656px] flex-col min-[360px]:min-h-[584px] min-[640px]:min-h-[520px] min-[860px]:min-h-[492px] lg:min-h-[584px] xl:min-h-[560px]">
      {/*
       * Previous/Next swaps the card's contents without moving focus (the pressed
       * control stays under the pointer), so the new question is announced here.
       * The region is a sibling of the card and never wraps it: the answer controls
       * must not turn every option into an announcement.
       */}
      {!result && (
        <p aria-live="polite" className="sr-only">
          {`${t('question_of', { current: position, total })}: ${fixture.stem}`}
        </p>
      )}
      <QuizQuestionView
        question={question}
        labels={{
          // The reserved line above the bar reports the step while answering and
          // the finished attempt once the result replaces the card: the visitor is
          // no longer on question four, and the line stays so nothing moves.
          questionOf: result
            ? tLanding('quiz_end_finished')
            : t('question_of', { current: position, total }),
          typeLabel:
            fixture.type === 'true_false'
              ? t('type_true_false')
              : fixture.type === 'open'
                ? t('type_open')
                : t('type_mcq'),
          previous: t('previous'),
          next: t('next'),
          submit: t('submit'),
          submitting: t('submitting'),
          answerPlaceholder: t('answer_placeholder'),
        }}
        onSelectOption={(optionId) =>
          setAnswers((prev) => ({ ...prev, [`${key}:option`]: optionId }))
        }
        onTextChange={(text) => setAnswers((prev) => ({ ...prev, [`${key}:text`]: text }))}
        onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(total - 1, i + 1))}
        // The last card's action grades the four answers into the result the
        // visitor then sees; the demo has an answer key, so nothing is invented.
        onSubmit={() =>
          setResult(buildQuizDemoResult({ locale, answers, startedAt: new Date().toISOString() }))
        }
        result={
          result && (
            <QuizResultPreview
              result={result}
              locale={locale}
              labels={{ cta: tLanding('quiz_end_cta'), restart: tLanding('quiz_end_restart') }}
              scoreLabels={scoreSummaryLabels(tReview)}
              statusLabels={{
                correct: tReview('badge_correct'),
                wrong: tReview('badge_incorrect'),
                skipped: tReview('no_answer'),
              }}
              onRestart={() => {
                setAnswers({});
                setIndex(0);
                setResult(null);
              }}
            />
          )
        }
      />
    </div>
  );
}
