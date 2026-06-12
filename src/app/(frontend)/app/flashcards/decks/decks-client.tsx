'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards/deck-management-screen';

export default function DecksClient() {
  const t = useTranslations('AppFlashcardDecksPage');
  const navT = useTranslations('AppFlashcardsPage');

  return (
    <DeckManagementScreen
      apiBase="/api/v1/flashcards"
      basePath="/app/flashcards"
      t={t}
      breadcrumbs={[
        { label: navT('title'), href: '/app/flashcards' },
        { label: navT('decks_title'), href: '/app/flashcards/decks' },
      ]}
    />
  );
}
