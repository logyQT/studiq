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
    newOnly?: string;
  }>;
}

export default async function SessionPage({ searchParams }: SessionPageProps) {
  const params = await searchParams;
  const mode = params.mode || 'review';
  const studyMode = params.studyMode || 'endless';
  const isCram = mode === 'cram';
  const isQuick = mode === 'quick';
  const deckId = params.deckId;
  const topicsStr = params.topics;
  const decksStr = params.decks;
  const targetCount = parseInt(params.target || '10');
  const newOnly = params.newOnly === 'true';
  const batchSize = isQuick ? parseInt(params.limit || '5', 10) : 20;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  let initialCards: Array<{
    id: string; front: string; back: string;
    createdAt: string | null;
    deckName: string | null;
    topicNames: string[];
    reviewState: {
      easinessFactor: number; intervalDays: number; repetitions: number;
      nextReviewAt: string; lastReviewedAt: string | null; lastQuality: number | null;
      learningState?: string; learningStep?: number; lapseCount?: number; isLeech?: boolean;
    } | null;
  }> = [];

  if (isCram && deckId) {
    const res = await fetch(`${baseUrl}/api/v1/flashcards/practice/prepare?deckIds=${deckId}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const body = await res.json();
      initialCards = (body.data ?? []).map((fc: {
        id: string; front: string; back: string;
        createdAt?: string | null;
        deckName?: string | null;
        topicNames?: string[];
        reviewState?: Record<string, unknown> | null;
      }) => ({
        id: fc.id,
        front: fc.front,
        back: fc.back,
        createdAt: fc.createdAt ?? null,
        deckName: fc.deckName ?? null,
        topicNames: fc.topicNames ?? [],
        reviewState: fc.reviewState ?? null,
      }));
    }
  } else if (!isCram) {
    const fetchUrl = new URL(`${baseUrl}/api/v1/flashcards/practice/due`);
    if (topicsStr) fetchUrl.searchParams.set('topicIds', topicsStr);
    if (decksStr) fetchUrl.searchParams.set('deckIds', decksStr);
    fetchUrl.searchParams.set('limit', String(batchSize));
    if (newOnly) fetchUrl.searchParams.set('newOnly', 'true');

    const res = await fetch(fetchUrl.toString(), {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const body = await res.json();
      initialCards = (body.data ?? []).map((fc: {
        id: string; front: string; back: string;
        createdAt?: string | null;
        deckName?: string | null;
        topicNames?: string[];
        reviewState?: Record<string, unknown> | null;
      }) => ({
        id: fc.id,
        front: fc.front,
        back: fc.back,
        createdAt: fc.createdAt ?? null,
        deckName: fc.deckName ?? null,
        topicNames: fc.topicNames ?? [],
        reviewState: fc.reviewState ?? null,
      }));
    }
  }

  if (initialCards.length === 0) {
    if (isQuick) redirect('/app');
    redirect('/app/flashcards/study');
  }

  const deckIds = deckId
    ? [deckId]
    : decksStr
      ? decksStr.split(',').filter(Boolean)
      : [];

  const topicIds = topicsStr
    ? topicsStr.split(',').filter(Boolean)
    : [];

  return (
    <SessionClient
      initialCards={initialCards}
      mode={mode}
      studyMode={studyMode}
      targetCount={targetCount}
      hasMore={!isCram && initialCards.length > 0}
      deckIds={deckIds}
      topicIds={topicIds}
      newOnly={newOnly}
    />
  );
}
