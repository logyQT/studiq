import { notFound } from 'next/navigation';
import SessionClient from './session-client';

const VALID_TYPES = ['review', 'learn', 'cram'] as const;

interface Props {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SessionTypePage({ params, searchParams }: Props) {
  const { type } = await params;
  const sp = await searchParams;

  if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    notFound();
  }

  return (
    <SessionClient
      type={type}
      studyMode={sp.studyMode as string}
      deckId={sp.deckId as string}
      topics={sp.topics as string}
      decks={sp.decks as string}
      target={sp.target as string}
      limit={sp.limit as string}
      newOnly={sp.newOnly as string}
    />
  );
}
