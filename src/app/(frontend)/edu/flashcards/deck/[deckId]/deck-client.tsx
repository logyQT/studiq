'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards/deck-detail-screen';

interface EduDeckClientProps {
  deckId: string;
}

export default function EduDeckClient({ deckId }: EduDeckClientProps) {
  const t = useTranslations('EduDeckViewPage');

  return (
    <DeckDetailScreen
      deckId={deckId}
      backHref="/edu/flashcards/decks"
      basePath="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
    />
  );
}
