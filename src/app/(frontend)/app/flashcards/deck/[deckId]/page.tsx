import DeckClient from './deck-client';

export default async function DeckViewPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;

  return <DeckClient deckId={deckId} />;
}
