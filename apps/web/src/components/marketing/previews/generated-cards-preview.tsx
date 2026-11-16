'use client';

import { useLocale, useTranslations } from 'next-intl';
import { GeneratedCards } from '@/components/ai/generated-cards';
import {
  GENERATED_CARD_FIXTURES,
  type GeneratedCardsLocale,
} from '@/components/marketing/previews/generated-cards-fixtures';

/**
 * The chat's generated-cards block as a page shows it: the product's own tiles,
 * the product's own count line, a fixture instead of a generation.
 *
 * The count line is the chat's (`Wygenerowano 4 fiszki`), not marketing copy:
 * the block's label is part of what the block is, and a second wording here
 * would be a second claim about the same thing.
 */
export function GeneratedCardsPreview() {
  const locale: GeneratedCardsLocale = useLocale() === 'en' ? 'en' : 'pl';
  const t = useTranslations('AiChatPage');
  const cards = GENERATED_CARD_FIXTURES[locale];

  return (
    <GeneratedCards cards={cards} label={t('flashcards_generated', { count: cards.length })} />
  );
}
