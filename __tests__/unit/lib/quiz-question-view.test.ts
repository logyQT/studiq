import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  QUIZ_QUESTION_FIXTURES,
  type QuizSubject,
} from '@/components/marketing/previews/quiz-question-fixtures';
import { QuizQuestionPreview } from '@/components/marketing/previews/quiz-question-preview';
import { QuizQuestionView } from '@/components/quiz/quiz-question-view';
import pl from '@/i18n/messages/pl.json';

/**
 * The card is the product's own: one component behind the taking page and the
 * marketing preview. These pin the three answer shapes it renders and the
 * progress contract, so a fixture or a branch change cannot quietly ship a
 * marketing card that no student would ever see (DESIGN.md §Product imagery).
 */
const t = createTranslator({ locale: 'pl', messages: pl, namespace: 'AppQuizTakingPage' });

/** Same mapping the preview uses, derived from the fixture's own type. */
function typeLabelFor(type: string) {
  if (type === 'true_false') return t('type_true_false');
  if (type === 'open') return t('type_open');
  return t('type_mcq');
}

function renderFixture(subject: QuizSubject, result?: ReactNode) {
  const question = QUIZ_QUESTION_FIXTURES.pl[subject];

  return renderToStaticMarkup(
    createElement(QuizQuestionView, {
      question,
      labels: {
        questionOf: t('question_of', { current: question.position, total: question.total }),
        typeLabel: typeLabelFor(question.type),
        previous: t('previous'),
        next: t('next'),
        submit: t('submit'),
        submitting: t('submitting'),
        answerPlaceholder: t('answer_placeholder'),
      },
      result,
    }),
  );
}

const radios = (html: string) => html.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];

/**
 * The label rows, in document order. Each one has to contain its radio: a
 * `<label for>` naming a `button[role=radio]` is inert, which is exactly the
 * dead padding this pins shut.
 */
const optionRows = (html: string) =>
  html.match(/<label[^>]*class="[^"]*cursor-pointer[^"]*"[^>]*>[\s\S]*?<\/label>/g) ?? [];

describe('QuizQuestionView', () => {
  it('renders the chosen multiple-choice answer as a checked radio', () => {
    const html = renderFixture('biology');

    expect(html).toContain('Które organellum wytwarza większość ATP w komórce eukariotycznej?');
    expect(radios(html)).toHaveLength(4);

    const checked = radios(html).filter((radio) => radio.includes('aria-checked="true"'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="mitochondrium"');
  });

  it('makes each option row the label of its own radio, so the padding answers a click', () => {
    const html = renderFixture('biology');
    const rows = optionRows(html);

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.replace(/<[^>]+>/g, '').trim())).toEqual([
      'Mitochondrium',
      'Aparat Golgiego',
      'Rybosom',
      'Lizosom',
    ]);
    for (const row of rows) {
      expect(row.match(/<button[^>]*role="radio"/g), 'the row contains its radio').toHaveLength(1);
    }
    // `for=` would point the label at a button, which the browser will not activate.
    expect(html).not.toMatch(/<label[^>]*\sfor="/);
  });

  it('keeps the footer at the bottom of the height its caller reserves', () => {
    const html = renderFixture('biology');

    // Root `flex-1` → card `flex-1` → content `flex-1`: the slack lands above the footer.
    expect(html).toContain('flex flex-1 flex-col gap-6');
    expect(html).toMatch(/<div[^>]*data-slot="card"[^>]*class="[^"]*flex-1/);
    expect(html).toMatch(/<div[^>]*data-slot="card-content"[^>]*class="[^"]*flex-1/);
  });

  it('renders true/false as two answer buttons and never as a radio group', () => {
    const html = renderFixture('history');

    expect(radios(html)).toHaveLength(0);
    expect(html).toContain('Prawda');
    expect(html).toContain('Fałsz');
    expect(html).toMatch(/class="[^"]*grid grid-cols-2[^"]*"/);
  });

  it('renders an open question as a textarea and never as options', () => {
    const html = renderFixture('language');

    expect(radios(html)).toHaveLength(0);
    expect(html).toContain('<textarea');
    expect(html).toContain('Wpisz swoją odpowiedź…');
  });

  it('exposes the attempt position through the progressbar', () => {
    const html = renderFixture('biology');

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain('aria-valuemax="100"');
  });

  it('replaces the whole card body with the result and keeps the frame around it', () => {
    const question = QUIZ_QUESTION_FIXTURES.pl.biology;
    const html = renderFixture('biology', createElement('p', null, 'Wynik'));

    expect(html).toContain('Wynik');
    expect(html).not.toContain(question.stem);
    expect(html).not.toContain(question.options[0].label);
    // The counter and progress stay put, so the card cannot move on the swap.
    expect(html).toContain('Pytanie 1 z 5');
    expect(html).toContain('role="progressbar"');
  });
});

describe('QuizQuestionPreview', () => {
  it('renders the biology fixture with the product copy, not a copy of the card', () => {
    // The preview reads the active locale, so it needs the provider the app mounts.
    const html = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: 'pl', messages: pl },
        createElement(QuizQuestionPreview),
      ),
    );

    expect(html).toContain('Które organellum wytwarza większość ATP w komórce eukariotycznej?');
    // The preview runs its own sequence — four shipped question types, since the
    // open-answer card is deferred — so it opens on 1 of 4.
    expect(html).toContain('Pytanie 1 z 4');
    expect(radios(html)).toHaveLength(4);
  });
});
