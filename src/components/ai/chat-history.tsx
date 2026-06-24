'use client';

import { memo } from 'react';
import { ChatMessage } from './chat-message';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
  onAnswer?: (text: string) => void;
}

export const ChatHistory = memo(function ChatHistory({ messages, onAnswer }: ChatHistoryProps) {
  return (
    <div className="space-y-6">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} onAnswer={onAnswer} />
      ))}
    </div>
  );
});
