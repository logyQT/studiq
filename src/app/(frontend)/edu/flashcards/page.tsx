import { cookies } from 'next/headers';
import EduFlashcardsClient from './flashcards-client';

export default async function EduFlashcardsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const [topicsRes, decksRes] = await Promise.all([
    fetch(`${baseUrl}/api/v1/flashcards/topics`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards/decks`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  const topics = topicsRes.ok ? ((await topicsRes.json()).data ?? []) : [];
  const decks = decksRes.ok ? ((await decksRes.json()).data ?? []) : [];

  return <EduFlashcardsClient deckCount={decks.length} topicCount={topics.length} />;
}
