import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QUIZ_QUESTION_FIXTURES } from '@/components/marketing/previews/quiz-question-fixtures';
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

const TYPE_LABELS = {
  biology: t('type_mcq'),
  history: t('type_true_false'),
  language: t('type_open'),
} as const;

function renderFixture(subject: keyof typeof QUIZ_QUESTION_FIXTURES) {
  const question = QUIZ_QUESTION_FIXTURES[subject];

  return renderToStaticMarkup(
    createElement(QuizQuestionView, {
      question,
      labels: {
        questionOf: t('question_of', { current: question.position, total: question.total }),
        typeLabel: TYPE_LABELS[subject],
        previous: t('previous'),
        next: t('next'),
        submit: t('submit'),
        submitting: t('submitting'),
        answerPlaceholder: t('answer_placeholder'),
      },
    }),
  );
}

const radios = (html: string) => html.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];

describe('QuizQuestionView', () => {
  it('renders the chosen multiple-choice answer as a checked radio', () => {
    const html = renderFixture('biology');

    expect(html).toContain('Które organellum wytwarza większość ATP w komórce eukariotycznej?');
    expect(radios(html)).toHaveLength(4);

    const checked = radios(html).filter((radio) => radio.includes('aria-checked="true"'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="mitochondrium"');
  });

  it('renders true/false as two answer buttons and never as a radio group', () => {
    const html = renderFixture('history');

    expect(radios(html)).toHaveLength(0);
    expect(html).toContain('>Prawda</button>');
    expect(html).toContain('>Fałsz</button>');
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
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-valuemax="100"');
  });
});

describe('QuizQuestionPreview', () => {
  it('renders the biology fixture with the product copy, not a copy of the card', () => {
    const html = renderToStaticMarkup(createElement(QuizQuestionPreview));

    expect(html).toContain('Które organellum wytwarza większość ATP w komórce eukariotycznej?');
    expect(html).toContain('Pytanie 2 z 5');
    expect(radios(html)).toHaveLength(4);
  });
});
