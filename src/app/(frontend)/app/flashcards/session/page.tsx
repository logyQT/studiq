import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import SessionClient from './session-client';

interface SessionPageProps {
  searchParams: Promise<{
    mode?: string;
    studyMode?: string;
    deckId?: string;
    topics?: string;
    decks?: string;
    target?: string;
    limit?: string;
  }>;
}

export default async function SessionPage({ searchParams }: SessionPageProps) {
  const params = await searchParams;
  const mode = params.mode || 'study';
  const studyMode = params.studyMode || 'endless';
  const isPractice = mode === 'practice';
  const isQuick = mode === 'quick';
  const deckId = params.deckId;
  const topicsStr = params.topics;
  const decksStr = params.decks;
  const targetCount = parseInt(params.target || '10');
  const batchSize = isQuick ? parseInt(params.limit || '5', 10) : 20;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  let initialCards: Array<{ id: string; front: string; back: string }> = [];

  if (isPractice && deckId) {
    const res = await fetch(`${baseUrl}/api/v1/flashcards?deckIds=${deckId}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const body = await res.json();
      initialCards = (body.data ?? []).map((fc: { id: string; front: string; back: string }) => ({
        id: fc.id,
        front: fc.front,
        back: fc.back,
      }));
    }
  } else if (!isPractice) {
    const fetchUrl = new URL(`${baseUrl}/api/v1/flashcards/practice/due`);
    if (topicsStr) fetchUrl.searchParams.set('topicIds', topicsStr);
    if (decksStr) fetchUrl.searchParams.set('deckIds', decksStr);
    fetchUrl.searchParams.set('limit', String(batchSize));

    const res = await fetch(fetchUrl.toString(), {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const body = await res.json();
      initialCards = (body.data ?? []).map((fc: { id: string; front: string; back: string }) => ({
        id: fc.id,
        front: fc.front,
        back: fc.back,
      }));
    }
  }

  if (initialCards.length === 0) {
    if (isQuick) redirect('/app');
    if (isPractice) redirect('/app/flashcards/practice');
    redirect('/app/flashcards/study');
  }

  return (
    <SessionClient
      initialCards={initialCards}
      mode={mode}
      studyMode={studyMode}
      targetCount={targetCount}
      hasMore={!isPractice && initialCards.length >= batchSize}
    />
  );
}
