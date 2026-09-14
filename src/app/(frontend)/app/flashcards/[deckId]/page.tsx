'use client';

import { useParams } from 'next/navigation';
import DeckClient from '@/app/(frontend)/app/flashcards/[deckId]/deck-client';

export default function DeckViewPage() {
  const { deckId } = useParams<{ deckId: string }>();
  return <DeckClient deckId={deckId} />;
}
