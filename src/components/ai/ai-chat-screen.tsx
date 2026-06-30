'use client';

import { AnimatePresence } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { useAuth } from '@/components/providers';
import { ScrollBackToBar } from '@/components/shared/scroll-back-to-bar';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import { AiChatGreeting } from './ai-chat-greeting';
import { AiChatInput } from './ai-chat-input';
import { ChatHistory } from './chat-history';
import { UsageBadge } from './usage-badge';

export function AiChatScreen() {
  const { messages, usage, isStreaming, sendMessage, sendLocalResponse, abort } = useAiChat();
  const { user } = useAuth();
  const t = useTranslations('AiChatPage');
  const [file, setFile] = useState<File | null>(null);
  const [activeContext, setActiveContext] = useState<string | null>(null);
  const { containerRef: scrollRef, handleScroll, isAtBottom, scrollToBottom } = useScrollToBottom();

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

  const handleAnswer = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  const handleSend = async (text: string, f?: File) => {
    await sendMessage(text, f, activeContext ?? undefined);
    setActiveContext(null);
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {isActive && (
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" onScroll={handleScroll}>
            <div className="mx-auto max-w-3xl px-4 py-6">
              <ChatHistory messages={messages} onAnswer={handleAnswer} />
              <div className="pt-4">
                <AiChatInput
                  onSend={handleSend}
                  isStreaming={isStreaming}
                  onAbort={abort}
                  file={file}
                  onFileChange={setFile}
                />
                {usage && (
                  <div className="mt-2 flex justify-center">
                    <UsageBadge usage={usage} />
                  </div>
                )}
              </div>
            </div>
          </div>
          <ScrollBackToBar
            chevronDirection="down"
            barPosition="bottom"
            visible={!isAtBottom && isActive}
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-0 left-0 right-0"
          />
        </div>
      )}

      {!isActive && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-3xl px-4">
            <AnimatePresence>
              <AiChatGreeting userName={firstName} onSuggestion={handleSuggestion} />
            </AnimatePresence>

            <AiChatInput
              onSend={handleSend}
              isStreaming={isStreaming}
              onAbort={abort}
              file={file}
              onFileChange={setFile}
            />
          </div>
        </div>
      )}
    </div>
  );
}
