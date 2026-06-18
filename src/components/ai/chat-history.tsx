'use client';

import { ChatMessage } from './chat-message';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  return (
    <div className="space-y-6">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
    </div>
  );
}
