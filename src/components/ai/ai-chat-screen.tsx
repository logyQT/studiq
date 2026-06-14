'use client';

import { useTranslations } from 'next-intl';
import { useAiChat } from '@/hooks/use-ai-chat';
import { ChatHistory } from './chat-history';
import { ChatInput } from './chat-input';
import { UsageBadge } from './usage-badge';

export function AiChatScreen() {
  const t = useTranslations('AiChatPage');
  const { messages, usage, isStreaming, sendMessage, abort } = useAiChat();

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-xl border bg-background shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <UsageBadge usage={usage} />
      </div>

      {/* Messages */}
      <ChatHistory messages={messages} />

      {/* Input */}
      <ChatInput onSend={sendMessage} isStreaming={isStreaming} onAbort={abort} />
    </div>
  );
}
