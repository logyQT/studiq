import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FlashcardBlock } from '@/components/ai/flashcard-block';
import en from '@/i18n/messages/en.json';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/ai' }));

// #1212: no name from the model leaves the field to the localized default. A name that is present
// but blank must land there too: a whitespace-only name would reach `POST /api/v1/flashcards/decks`,
// whose schema trims it to empty and answers 422 at save time.

const cards = [{ front: 'Q', back: 'A' }];

function render(deckName: string | undefined) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        NextIntlClientProvider,
        { locale: 'en', messages: en, timeZone: 'UTC' },
        createElement(FlashcardBlock, { flashcards: cards, deckName }),
      ),
    ),
  );
}

describe('FlashcardBlock deck name field (#1212)', () => {
  const localized = `value="${en.AiChatPage.flashcard_deck_name}"`;

  it.each([
    ['no name', undefined],
    ['an empty name', ''],
    ['a whitespace-only name', '   '],
  ])('shows the localized default for %s', (_label, deckName) => {
    const html = render(deckName);

    expect(html).toContain(localized);
    expect(html).not.toContain('value="   "');
  });

  it('keeps a name the model chose', () => {
    const html = render('Układ Słoneczny');

    expect(html).toContain('value="Układ Słoneczny"');
    expect(html).not.toContain(localized);
  });
});
