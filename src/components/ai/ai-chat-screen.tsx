'use client';

import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useAuth } from '@/components/providers';
import { cn } from '@/lib/utils';
import { AiChatGreeting } from './ai-chat-greeting';
import { AiChatInput } from './ai-chat-input';
import { ChatHistory } from './chat-history';
import { UsageBadge } from './usage-badge';

const CTA_CONTEXT_MAP: Record<string, string> = {};

export function AiChatScreen() {
  const { messages, usage, isStreaming, sendMessage, sendLocalResponse, abort } = useAiChat();
  const { user } = useAuth();
  const t = useTranslations('AiChatPage');
  const [file, setFile] = useState<File | null>(null);
  const [activeContext, setActiveContext] = useState<string | null>(null);

  const isActive = messages.length > 0 || isStreaming;

  const firstName = user?.user_metadata?.name?.split(' ')[0] ?? user?.email?.split('@')[0];

  const handleSuggestion = (text: string) => {
    const responses: Record<string, string> = {
      [t('suggestion_1')]: t('cta_response_study'),
      [t('suggestion_2')]: t('cta_response_flashcards'),
      [t('suggestion_3')]: t('cta_response_summarize'),
      [t('suggestion_4')]: t('cta_response_explain'),
    };
    const contextMap: Record<string, string> = {
      [t('suggestion_2')]: 'flashcards',
    };
    sendLocalResponse(text, responses[text] || t('cta_response_default'));
    setActiveContext(contextMap[text] || null);
  };

  const handleSend = async (text: string, f?: File) => {
    await sendMessage(text, f, activeContext ?? undefined);
    setFile(null);
    setActiveContext(null);
  };

  return (
    <div className="flex flex-1 flex-col">
      {isActive && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            <ChatHistory messages={messages} />
          </div>
        </div>
      )}

      <div
        className={cn(
          'flex flex-col items-center transition-all duration-300',
          isActive ? 'shrink-0 pb-6' : 'justify-center flex-1',
        )}
      >
        <div className="w-full max-w-3xl px-4">
          <AnimatePresence>
            {!isActive && (
              <AiChatGreeting
                userName={firstName}
                onSuggestion={handleSuggestion}
              />
            )}
          </AnimatePresence>

          <AiChatInput
            onSend={handleSend}
            isStreaming={isStreaming}
            onAbort={abort}
            file={file}
            onFileChange={setFile}
          />

          {isActive && (
            <div className="mt-2 flex justify-center">
              <UsageBadge usage={usage} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
