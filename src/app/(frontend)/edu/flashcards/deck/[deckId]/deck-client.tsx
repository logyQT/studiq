'use client';

import { useTranslations } from 'next-intl';
import { DeckDetailScreen } from '@/components/flashcards/deck-detail-screen';

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  created_at?: string;
}

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface EduDeckClientProps {
  deck: Deck;
  flashcards: Flashcard[];
  topics: Topic[];
  allDecks: Deck[];
}

export default function EduDeckClient({ deck, flashcards, topics, allDecks }: EduDeckClientProps) {
  const t = useTranslations('EduDeckViewPage');

  return (
    <DeckDetailScreen
      deck={deck}
      flashcards={flashcards}
      topics={topics}
      allDecks={allDecks}
      backHref="/edu/flashcards/decks"
      basePath="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
    />
  );
}
