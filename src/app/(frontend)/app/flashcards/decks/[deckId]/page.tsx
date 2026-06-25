'use client';

import { useParams } from 'next/navigation';
import DeckClient from './deck-client';

export default function DeckViewPage() {
  const { deckId } = useParams<{ deckId: string }>();
  return <DeckClient deckId={deckId} />;
}
