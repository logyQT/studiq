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
  return (
    <SessionClient
      mode={params.mode}
      studyMode={params.studyMode}
      deckId={params.deckId}
      topics={params.topics}
      decks={params.decks}
      target={params.target}
      limit={params.limit}
      newOnly={params.newOnly}
    />
  );
}
