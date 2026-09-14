import EduDeckClient from '@/app/(frontend)/edu/flashcards/[deckId]/deck-client';

export default async function EduDeckViewPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;

  return <EduDeckClient deckId={deckId} />;
}
