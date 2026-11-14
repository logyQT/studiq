'use client';

import { createTranslator } from 'next-intl';
import { useLocale, useTranslations } from 'next-intl';
import { type KeyboardEvent, useMemo, useState } from 'react';
import {
  QUIZ_QUESTION_FIXTURES,
  QUIZ_SUBJECTS,
  type QuizFixtureLocale,
  type QuizSubject,
} from '@/components/marketing/previews/quiz-question-fixtures';
import { QuizPreviewEndPanel } from '@/components/marketing/previews/quiz-preview-end-panel';
import { QuizQuestionView } from '@/components/quiz/quiz-question-view';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * The quiz card as the marketing page shows it: the same component the student
 * answers on, driven by fixture data instead of a fetch.
 *
 * It is interactive on purpose — you can pick an answer and step forward and back
 * through five subjects (biology, history, driving theory, English, SQL). That is
 * the product doing its actual job rather than a picture of it doing so, and it
 * costs state, not a rendering strategy: the card was already a client component.
 *
 * Both the fixtures and the card copy follow the page's locale. A Polish card on
 * an English page is the mixed-locale mistake DESIGN.md bans, and it is what the
 * first version shipped.
 */
/*
 * Only the question types the product actually ships today. `language` is an
 * open-answer (fill-the-gap) fixture and stays out of the sequence: that type is
 * deferred, and putting it on the landing page would advertise a screen a student
 * cannot reach yet.
 */
const ORDER = QUIZ_SUBJECTS.filter((subject) => subject !== 'language') as readonly QuizSubject[];

const MESSAGES = { pl, en };

export function QuizQuestionPreview() {
  const rawLocale = useLocale();
  const locale: QuizFixtureLocale = rawLocale === 'en' ? 'en' : 'pl';
  const tLanding = useTranslations('LandingPage');

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [endOpen, setEndOpen] = useState(false);

  const t = useMemo(
    () =>
      createTranslator({
        locale,
        messages: MESSAGES[locale],
        namespace: 'AppQuizTakingPage',
      }),
    [locale],
  );

  const key = ORDER[index] ?? 'biology';
  const fixture = QUIZ_QUESTION_FIXTURES[locale][key];
  const position = index + 1;
  const total = ORDER.length;

  const question = {
    ...fixture,
    // The fixtures carry their own numbering for their own screens; here the five
    // of them are one sequence, so the counter comes from the index.
    position,
    total,
    selectedOptionId: answers[`${key}:option`] ?? null,
    textAnswer: answers[`${key}:text`] ?? '',
  };

  const endLabels = {
    title: tLanding('quiz_end_title'),
    body: tLanding('quiz_end_body'),
    cta: tLanding('quiz_end_cta'),
    dismiss: tLanding('quiz_end_dismiss'),
  };

  // Escape is handled here, on the frame that contains both the disclosure and
  // the panel, rather than on the document: the page keeps no global listener
  // for a control that only exists in this one card.
  const onFrameKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && endOpen) setEndOpen(false);
  };

  /*
   * The fixtures are different shapes — four options, two buttons, a textarea — so
   * the card's own height swings. A column flex box reserves the measured maximum
   * and the view grows into it, which pins the footer so stepping cannot move it or
   * the page.
   *
   * The reservations are measured in both locales at every breakpoint, not
   * calculated: 646px below 360 (options wrap to three lines), 576px from 360 up
   * once the options get room, 512px from 640 in the full-width column, 484px
   * from 860 where the widest option stops wrapping, 576px at 1024 where the card
   * is back in the rail but only 347px wide, and 512px from 1280. Each value is
   * the tallest of the four fixtures at that width plus the 76px of card chrome,
   * rounded up. The first two steps are arbitrary min-widths rather than `sm:`
   * because the ladder has to sort upward: a named variant emitted after an
   * arbitrary one would win at every wider width.
   */
  return (
    // The handler is scoped to this frame on purpose: Escape belongs to the demo,
    // not to the page, and there is no dialog here to listen for it. jsx-a11y
    // reads a key listener on a container as an interactive element; a frame
    // that only forwards a key to its own controls is the case it cannot tell
    // apart, so the finding is suppressed rather than answered with a role the
    // element does not have.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="flex min-h-[656px] flex-col min-[360px]:min-h-[584px] min-[640px]:min-h-[520px] min-[860px]:min-h-[492px] lg:min-h-[584px] xl:min-h-[520px]"
      onKeyDown={onFrameKeyDown}
    >
      {/*
       * Mounted for the whole life of the page so it can announce the panel's
       * title when it opens, and only then: the text is empty while the sample
       * is still asking questions. `sr-only` keeps it out of the layout.
       */}
      <output aria-live="polite" className="sr-only">
        {endOpen ? endLabels.title : ''}
      </output>
      <QuizQuestionView
        question={question}
        labels={{
          questionOf: t('question_of', { current: position, total }),
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
        onPrevious={() => {
          // Leaving the last question also retires its panel; otherwise question
          // 3 would open with its answers hidden behind a finished demo.
          setEndOpen(false);
          setIndex((i) => Math.max(0, i - 1));
        }}
        onNext={() => setIndex((i) => Math.min(total - 1, i + 1))}
        // The last card's action is the disclosure, not a submit: the sample has
        // nothing to grade, and a second press closes the panel again.
        onSubmit={() => setEndOpen((open) => !open)}
        endPanel={<QuizPreviewEndPanel labels={endLabels} onDismiss={() => setEndOpen(false)} />}
        endPanelOpen={endOpen}
      />
    </div>
  );
}
