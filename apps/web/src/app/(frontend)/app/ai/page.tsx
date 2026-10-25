import { AiChatScreen } from '@/components/ai/ai-chat-screen';

interface Props {
  searchParams: Promise<{ deckId?: string | string[] }>;
}

export default async function AiChatPage({ searchParams }: Props) {
  const { deckId } = await searchParams;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <AiChatScreen deckId={typeof deckId === 'string' ? deckId : undefined} />
    </div>
  );
}
