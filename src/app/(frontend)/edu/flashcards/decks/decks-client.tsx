'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards';

export default function EduDecksClient() {
  const t = useTranslations('EduFlashcardDecksPage');

  return <DeckManagementScreen apiBase="/api/v1/flashcards" basePath="/edu/flashcards" t={t} />;
}
