'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards/deck-management-screen';

export default function EduDecksClient() {
  const t = useTranslations('EduFlashcardDecksPage');
  const navT = useTranslations('EduFlashcardsPage');

  return (
    <DeckManagementScreen
      apiBase="/api/v1/flashcards"
      basePath="/edu/flashcards"
      t={t}
      breadcrumbs={[
        { label: navT('title'), href: '/edu/flashcards' },
        { label: navT('decks_title'), href: '/edu/flashcards/decks' },
      ]}
    />
  );
}
