import { cookies } from 'next/headers';
import TopicsClient from './topics-client';

export default async function TopicsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const [topicsRes, flashcardsRes] = await Promise.all([
    fetch(`${baseUrl}/api/v1/flashcards/topics`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcards`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  const topics = topicsRes.ok ? (await topicsRes.json()).data ?? [] : [];
  const flashcards = flashcardsRes.ok ? (await flashcardsRes.json()).data ?? [] : [];

  return <TopicsClient topics={topics} flashcards={flashcards} />;
}
