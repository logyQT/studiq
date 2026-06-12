'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards/deck-detail-screen';

interface EduDeckClientProps {
  deckId: string;
}

export default function EduDeckClient({ deckId }: EduDeckClientProps) {
  const t = useTranslations('EduDeckViewPage');
  const navT = useTranslations('EduFlashcardsPage');

  return (
    <DeckDetailScreen
      deckId={deckId}
      basePath="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
      parentBreadcrumbs={[
        { label: navT('title'), href: '/edu/flashcards' },
        { label: navT('decks_title'), href: '/edu/flashcards/decks' },
      ]}
    />
  );
}
