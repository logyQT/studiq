import { cookies } from 'next/headers';
import DeckClient from './deck-client';

export default async function DeckViewPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const [deckRes, flashcardsRes, topicsRes, allDecksRes] = await Promise.all([
    fetch(`${baseUrl}/api/v1/flashcards/decks/${deckId}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards?deckIds=${deckId}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards/topics`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards/decks`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  const deck = deckRes.ok ? (await deckRes.json()).data ?? null : null;
  const flashcards = flashcardsRes.ok ? (await flashcardsRes.json()).data ?? [] : [];
  const topics = topicsRes.ok ? (await topicsRes.json()).data ?? [] : [];
  const allDecks = allDecksRes.ok ? (await allDecksRes.json()).data ?? [] : [];

  if (!deck) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="text-lg">Deck not found</p>
      </div>
    );
  }

  return (
    <DeckClient
      deck={deck}
      flashcards={flashcards}
      topics={topics}
      allDecks={allDecks.filter((d: { id: string }) => d.id !== deckId)}
    />
  );
}
