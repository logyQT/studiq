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
 * Rating changes the card key, as the session's row id does: the rated card exits
 * before the next fixture mounts, so the incoming card starts on its question
 * side. A constant key would instead animate the faces down from the outgoing
 * card's opacity while their content already held the next fixture, showing an
 * answer before its question. The band cannot move either way — the card box is a
 * fixed height per breakpoint (the wrapper below).
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
    /*
     * The card's box, owned by the marketing band rather than by the component.
     * The study session's card is a fixed 22rem so its queue never moves; that
     * box was sized for a queue of real course answers. These fixtures are a
     * line or two, so the band sets the height its content actually needs — one
     * selector on the flip card's own `fieldset` root, no change to the product
     * component. The height steps with the column width so the card stays
     * landscape: tallest at md, where the stacked preview takes the whole page.
     */
    <div className="flex flex-col gap-6 [&_fieldset]:h-48 sm:[&_fieldset]:h-64 md:[&_fieldset]:h-72 lg:[&_fieldset]:h-56">
      <FlashcardReview
        cardKey={card.id}
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
