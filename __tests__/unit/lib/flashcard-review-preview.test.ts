import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FLASHCARD_REVIEW_FIXTURES } from '@/components/marketing/previews/flashcard-review-fixtures';
import { FlashcardReviewPreview } from '@/components/marketing/previews/flashcard-review-preview';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * The preview is the product's own review card behind fixtures, not a drawing of
 * one. These pin the pieces a lookalike would have to fake: the flip card's
 * focusable fieldset, the four rating buttons with their shortcut attributes, and
 * copy that belongs to the same locale as the fixture.
 *
 * Expected labels come from the locale catalogues, never from literals: the
 * assertion is that the card renders the session's copy for the page's locale,
 * so a copy edit must not turn this red.
 */
const CATALOGUES = { pl, en };

function card(locale: 'pl' | 'en') {
  return FLASHCARD_REVIEW_FIXTURES[locale][0];
}

function labels(locale: 'pl' | 'en') {
  return CATALOGUES[locale].AppFlashcardSessionPage;
}

function hint(locale: 'pl' | 'en') {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: 'AppFlashcardSessionPage',
  });
  return t('click_hint', { action: t('reveal_answer') });
}

/** `renderToStaticMarkup` escapes text, so a fixture with an apostrophe must be escaped too. */
function escaped(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

function render(locale: 'pl' | 'en') {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === 'pl' ? pl : en },
      createElement(FlashcardReviewPreview),
    ),
  );
}

describe('FlashcardReviewPreview', () => {
  it('renders the Polish fixture inside the product’s review card', () => {
    const html = render('pl');

    expect(html).toContain(escaped(card('pl').front));
    expect(html).toContain(escaped(card('pl').back));
    // `FlashcardFlip`'s own contract: a focusable fieldset that Enter/Space flips.
    expect(html).toContain('aria-keyshortcuts="Enter Space"');
    expect(html).toContain(`aria-label="${labels('pl').flashcard_aria}"`);
  });

  it('renders the four rating buttons the study session renders', () => {
    const html = render('pl');
    const shortcuts = [...html.matchAll(/aria-keyshortcuts="([1-4])"/g)].map((match) => match[1]);

    expect(shortcuts).toEqual(['1', '3', '2', '4']);
    for (const label of [
      labels('pl').rating_again,
      labels('pl').rating_good,
      labels('pl').rating_hard,
      labels('pl').rating_easy,
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(hint('pl'));
    expect(html.match(/<button/g)).toHaveLength(4);
    // The visitor starts on the question side: the ratings are not yet usable and
    // the `?` watermark is decoration, not part of the card a screen reader reads.
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(4);
    expect(html).toContain('aria-hidden="true"');
  });

  it('never mixes locales: the English page gets English cards and labels', () => {
    const html = render('en');

    expect(html).toContain(escaped(card('en').front));
    expect(html).toContain(escaped(card('en').back));
    expect(html).toContain(labels('en').rating_again);
    expect(html).not.toContain(escaped(card('pl').front));
    expect(html).not.toContain(labels('pl').rating_again);
  });

  it('gives every fixture its own card identity', () => {
    // Rating advances the card key, and that remount is what keeps the incoming
    // answer hidden: the freshly mounted card starts its answer face at zero
    // opacity. Two fixtures sharing an id would swap their faces in place
    // instead, fading the incoming answer in on a face that is still visible.
    for (const locale of ['pl', 'en'] as const) {
      const ids = FLASHCARD_REVIEW_FIXTURES[locale].map((fixture) => fixture.id);

      expect(new Set(ids).size, `${locale} fixture ids`).toBe(ids.length);
    }
  });
});
