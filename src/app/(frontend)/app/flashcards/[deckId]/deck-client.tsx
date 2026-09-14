'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards';

interface DeckClientProps {
  deckId: string;
}

export default function DeckClient({ deckId }: DeckClientProps) {
  const t = useTranslations('AppFlashcardDeckViewPage');

  return (
    <DeckDetailScreen
      deckId={deckId}
      basePath="/app/flashcards"
      apiBase="/api/v1/flashcards"
      practiceHref="/app/study/session/cram?deckId="
      t={t}
    />
  );
}
