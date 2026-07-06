'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards';

export default function DecksClient() {
  const t = useTranslations('AppFlashcardDecksPage');

  return <DeckManagementScreen apiBase="/api/v1/flashcards" basePath="/app/flashcards" t={t} />;
}
