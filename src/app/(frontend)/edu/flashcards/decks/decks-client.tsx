'use client';

import { useTranslations } from 'next-intl';
import { DeckManagementScreen } from '@/components/flashcards/deck-management-screen';

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface EduDecksClientProps {
  decks: Deck[];
}

export default function EduDecksClient({ decks }: EduDecksClientProps) {
  const t = useTranslations('EduFlashcardDecksPage');

  return (
    <DeckManagementScreen
      decks={decks}
      backHref="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      basePath="/edu/flashcards"
      t={t}
    />
  );
}
