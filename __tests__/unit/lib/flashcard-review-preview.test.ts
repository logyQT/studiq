import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlashcardReviewPreview } from '@/components/marketing/previews/flashcard-review-preview';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * The preview is the product's own review card behind fixtures, not a drawing of
 * one. These pin the pieces a lookalike would have to fake: the flip card's
 * focusable fieldset, the four rating buttons with their shortcut attributes, and
 * copy that belongs to the same locale as the fixture.
 */
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

    expect(html).toContain('Z kim się dziś uczysz?');
    expect(html).toContain('Ze StudiQ');
    // `FlashcardFlip`'s own contract: a focusable fieldset that Enter/Space flips.
    expect(html).toContain('aria-keyshortcuts="Enter Space"');
    expect(html).toContain('aria-label="Fiszka. Naciśnij Enter lub spację, aby ją odwrócić."');
  });

  it('renders the four rating buttons the study session renders', () => {
    const html = render('pl');
    const shortcuts = [...html.matchAll(/aria-keyshortcuts="([1-4])"/g)].map((match) => match[1]);

    expect(shortcuts).toEqual(['1', '3', '2', '4']);
    for (const label of ['Nie pamiętam', 'Dobrze', 'Trudne', 'Łatwe']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Kliknij, aby odkryć odpowiedź');
    expect(html.match(/<button/g)).toHaveLength(4);
    // The visitor starts on the question side: the ratings are not yet usable and
    // the `?` watermark is decoration, not part of the card a screen reader reads.
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(4);
    expect(html).toContain('aria-hidden="true"');
  });

  it('never mixes locales: the English page gets English cards and labels', () => {
    const html = render('en');

    expect(html).toContain('study buddy?');
    expect(html).toContain('StudiQ');
    expect(html).toContain('Again');
    expect(html).not.toContain('Z kim się dziś uczysz?');
    expect(html).not.toContain('Nie pamiętam');
  });
});
