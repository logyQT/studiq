'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards/deck-detail-screen';

interface DeckClientProps {
  deckId: string;
}

export default function DeckClient({ deckId }: DeckClientProps) {
  const t = useTranslations('AppFlashcardDeckViewPage');
  const navT = useTranslations('AppFlashcardsPage');

  return (
    <DeckDetailScreen
      deckId={deckId}
      basePath="/app/flashcards"
      apiBase="/api/v1/flashcards"
      practiceHref="/app/flashcards/session?mode=practice&deckId="
      t={t}
      parentBreadcrumbs={[
        { label: navT('title'), href: '/app/flashcards' },
        { label: navT('decks_title'), href: '/app/flashcards/decks' },
      ]}
    />
  );
}
