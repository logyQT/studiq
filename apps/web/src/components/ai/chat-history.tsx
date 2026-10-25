'use client';

import { memo } from 'react';
import { ChatMessage } from '@/components/ai/chat-message';
import type { DeckTarget } from '@/components/ai/flashcard-block';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
  onAnswer?: (text: string) => void;
  deckTarget?: DeckTarget | null;
}

export const ChatHistory = memo(function ChatHistory({
  messages,
  onAnswer,
  deckTarget,
}: ChatHistoryProps) {
  return (
    <div className="space-y-6">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} onAnswer={onAnswer} deckTarget={deckTarget} />
      ))}
    </div>
  );
});
