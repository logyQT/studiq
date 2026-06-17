'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from './chat-message';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="space-y-6">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
