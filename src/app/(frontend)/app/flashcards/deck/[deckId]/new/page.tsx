import NewCardClient from './new-card-client';

export default async function NewCardPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  return <NewCardClient deckId={deckId} />;
}
