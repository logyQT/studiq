'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards/deck-management-screen';

export default function DecksClient() {
  const t = useTranslations('AppFlashcardDecksPage');

  return (
    <DeckManagementScreen
      backHref="/app/flashcards"
      apiBase="/api/v1/flashcards"
      basePath="/app/flashcards"
      t={t}
    />
  );
}
