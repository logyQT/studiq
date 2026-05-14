import { cookies } from 'next/headers';
import FlashcardsClient from './flashcards-client';

export default async function FlashcardsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const [topicsRes, spacesRes] = await Promise.all([
    fetch(`${baseUrl}/api/v1/flashcard-topics`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/v1/flashcard-spaces`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  const topics = topicsRes.ok ? (await topicsRes.json()).data ?? [] : [];
  const spaces = spacesRes.ok ? (await spacesRes.json()).data ?? [] : [];

  return <FlashcardsClient topics={topics} spaces={spaces} />;
}
