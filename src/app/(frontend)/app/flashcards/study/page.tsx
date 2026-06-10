import { cookies } from 'next/headers';
import StudyClient from './study-client';

export default async function StudyPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const [topicsRes, decksRes, dueBreakdownRes] = await Promise.all([
    fetch(`${baseUrl}/api/v1/flashcards/topics`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards/decks`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards/practice/due/breakdown`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  const topics = topicsRes.ok ? (await topicsRes.json()).data ?? [] : [];
  const decks = decksRes.ok ? (await decksRes.json()).data ?? [] : [];
  const dueBreakdown = dueBreakdownRes.ok
    ? (await dueBreakdownRes.json()).data ?? { total: 0, byTopic: {}, byDeck: {} }
    : { total: 0, byTopic: {}, byDeck: {} };

  return <StudyClient topics={topics} decks={decks} dueBreakdown={dueBreakdown} />;
}
