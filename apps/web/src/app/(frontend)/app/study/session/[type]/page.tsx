import { notFound } from 'next/navigation';
import SessionClient from '@/app/(frontend)/app/study/session/[type]/session-client';

const VALID_TYPES = ['review', 'new', 'cram'] as const;

type SessionType = (typeof VALID_TYPES)[number];

function isSessionType(value: string): value is SessionType {
  // Widening to `readonly string[]` keeps `includes` callable without narrowing a union.
  return (VALID_TYPES as readonly string[]).includes(value);
}

/** `searchParams` values are `string | string[] | undefined`; the session URLs only set singles. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface Props {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SessionTypePage({ params, searchParams }: Props) {
  const { type } = await params;
  const sp = await searchParams;

  if (!isSessionType(type)) {
    notFound();
  }

  return (
    <SessionClient
      type={type}
      studyMode={firstValue(sp.studyMode)}
      deckId={firstValue(sp.deckId)}
      topics={firstValue(sp.topics)}
      decks={firstValue(sp.decks)}
      target={firstValue(sp.target)}
      limit={firstValue(sp.limit)}
    />
  );
}
