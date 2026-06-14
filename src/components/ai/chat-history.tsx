'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ChatMessage } from './chat-message';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  const t = useTranslations('AiChatPage');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2 text-center">
          <MessageSquare className="h-10 w-10 opacity-40" />
          <p className="text-sm">{t('empty_state')}</p>
          <p className="text-xs opacity-60">{t('empty_state_hint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
