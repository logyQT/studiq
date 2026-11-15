'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards/screens/deck-management-screen';

export default function EduDecksClient() {
  const t = useTranslations('EduFlashcardDecksPage');

  return <DeckManagementScreen basePath="/edu/flashcards" t={t} />;
}
