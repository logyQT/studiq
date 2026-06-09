import EduDeckClient from './deck-client';

export default async function EduDeckViewPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;

  return <EduDeckClient deckId={deckId} />;
}
