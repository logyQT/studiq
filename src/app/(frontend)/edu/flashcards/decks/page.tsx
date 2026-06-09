import { cookies } from 'next/headers';
import EduDecksClient from './decks-client';

export default async function EduDecksPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const res = await fetch(`${baseUrl}/api/v1/flashcards/decks`, {
    headers: { Cookie: cookieHeader },
    cache: 'no-store',
  });

  const decks = res.ok ? (await res.json()).data ?? [] : [];

  return <EduDecksClient decks={decks} />;
}
