'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards';

interface EduDeckClientProps {
  deckId: string;
}

export default function EduDeckClient({ deckId }: EduDeckClientProps) {
  const t = useTranslations('EduDeckViewPage');

  return (
    <DeckDetailScreen
      deckId={deckId}
      basePath="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
    />
  );
}
