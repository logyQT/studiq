import EditCardClient from './edit-card-client';

export default async function EditCardPage({
  params,
}: {
  params: Promise<{ deckId: string; cardId: string }>;
}) {
  const { deckId, cardId } = await params;
  return <EditCardClient deckId={deckId} cardId={cardId} />;
}
