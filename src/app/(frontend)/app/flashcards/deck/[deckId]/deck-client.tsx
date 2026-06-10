'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards/deck-detail-screen';

interface DeckClientProps {
  deckId: string;
}

export default function DeckClient({ deckId }: DeckClientProps) {
  const t = useTranslations('AppFlashcardDeckViewPage');

  return (
    <DeckDetailScreen
      deckId={deckId}
      backHref="/app/flashcards/decks"
      basePath="/app/flashcards"
      apiBase="/api/v1/flashcards"
      practiceHref="/app/flashcards/session?mode=practice&deckId="
      t={t}
    />
  );
}
