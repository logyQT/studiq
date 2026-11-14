'use client';

import { createTranslator, useLocale } from 'next-intl';
import { useMemo, useState } from 'react';
import { FlashcardReview } from '@/components/flashcards/flashcard-review';
import {
  FLASHCARD_REVIEW_FIXTURES,
  type FlashcardFixtureLocale,
} from '@/components/marketing/previews/flashcard-review-fixtures';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

const MESSAGES = { pl, en };

/**
 * The flashcard review loop as the marketing page shows it: the component the
 * student rates cards on, driven by three fixtures instead of a queue.
 *
 * It is interactive on purpose. The visitor flips a real study card and rates it
 * with the product's four confidence levels, and the next card comes up — the
 * mechanic rather than a picture of it. Picking a rating only advances the
 * fixture index: nothing is persisted and nothing is scheduled.
 *
 * The card key is constant, so rating a card swaps its content in place instead
 * of playing the session's exit animation; an animated exit is the one way the
 * band's height could move between fixtures.
 *
 * Copy is the study session's own, from the page's locale; the fixtures are
 * localised to match, never mixed.
 */
export function FlashcardReviewPreview() {
  const rawLocale = useLocale();
  const locale: FlashcardFixtureLocale = rawLocale === 'en' ? 'en' : 'pl';

  const t = useMemo(
    () =>
      createTranslator({
        locale,
        messages: MESSAGES[locale],
        namespace: 'AppFlashcardSessionPage',
      }),
    [locale],
  );

  const cards = FLASHCARD_REVIEW_FIXTURES[locale];
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const card = cards[index] ?? cards[0];

  return (
    <div className="flex flex-col gap-6">
      <FlashcardReview
        cardKey="flashcard-preview"
        front={card.front}
        back={card.back}
        isFlipped={isFlipped}
        onFlip={() => setIsFlipped((flipped) => !flipped)}
        ariaLabel={t('flashcard_aria')}
        hint={t('click_hint', { action: t('reveal_answer') })}
        reserveHint
        ratingLabels={{
          again: t('rating_again'),
          hard: t('rating_hard'),
          good: t('rating_good'),
          easy: t('rating_easy'),
        }}
        onRate={() => {
          setIndex((current) => (current + 1) % cards.length);
          setIsFlipped(false);
        }}
      />
    </div>
  );
}
