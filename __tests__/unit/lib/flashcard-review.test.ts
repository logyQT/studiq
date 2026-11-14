import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FlashcardReview,
  type FlashcardReviewProps,
} from '@/components/flashcards/flashcard-review';

/**
 * The shared review block is the product's card and the landing band's card. The
 * three states pinned here are the ones that differ from a plain card: the
 * decorative watermark stays out of the accessibility tree, the reveal hint can
 * keep its line box while the answer is up, and the ratings are not usable
 * before the answer is.
 */
function render(overrides: Partial<FlashcardReviewProps> = {}) {
  return renderToStaticMarkup(
    createElement(FlashcardReview, {
      cardKey: 'card',
      front: 'Pytanie kontrolne',
      back: 'Odpowiedź kontrolna',
      isFlipped: false,
      onFlip: () => {},
      ariaLabel: 'Fiszka',
      hint: 'Kliknij, aby odkryć odpowiedź',
      ratingLabels: { again: 'Nie pamiętam', hard: 'Trudne', good: 'Dobrze', easy: 'Łatwe' },
      onRate: () => {},
      ...overrides,
    }),
  );
}

describe('FlashcardReview', () => {
  it('keeps the decorative watermark out of the accessibility tree', () => {
    const html = render();

    expect(html).toMatch(/<div aria-hidden="true"[^>]*pointer-events-none/);
    // 24 × 24 glyphs stay rendered for sighted visitors.
    expect(html.match(/\?/g)).toHaveLength(576);
  });

  it('reserves the hint’s line box while the answer is up, when asked', () => {
    const html = render({ isFlipped: true, reserveHint: true });

    expect(html).toContain('Kliknij, aby odkryć odpowiedź');
    expect(html).toMatch(/<p class="[^"]*invisible[^"]*">/);
  });

  it('drops the hint from the layout as the session always has', () => {
    const html = render({ isFlipped: true });

    expect(html).not.toContain('Kliknij, aby odkryć odpowiedź');
  });

  it('disables the ratings until the answer is revealed', () => {
    const unflipped = render();
    const flipped = render({ isFlipped: true });

    expect(unflipped.match(/<button[^>]*disabled=""/g)).toHaveLength(4);
    expect(flipped.match(/<button[^>]*disabled=""/g)).toBeNull();
    // The button's own disabled opacity would stack on the block's opacity-30
    // and fade the ratings further than they already are.
    expect(unflipped).toContain('disabled:opacity-100');
  });

  it('marks each rating with its own hue on the edge, not an inline glow', () => {
    const html = render({ isFlipped: true });
    const edges = [...html.matchAll(/border-(destructive|amber-600|orange-600|success)\/40/g)];

    // A glow is the one thing this block used to add inline; four distinct edges
    // are what replaced it.
    expect(html).not.toContain('box-shadow');
    expect(edges.map((match) => match[1])).toEqual([
      'destructive',
      'amber-600',
      'orange-600',
      'success',
    ]);
  });
});
