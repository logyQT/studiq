'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import { useAuth } from '@/components/providers';
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
    <div className="flex flex-1 flex-col min-h-0">
      {isActive && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
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
      )}

      {/* Glassmorphism scroll-to-bottom bar */}
      <AnimatePresence>
        {!isAtBottom && isActive && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-0 left-0 right-0 z-50 h-24 bg-gradient-to-t from-background/95 via-background/50 to-transparent backdrop-blur-sm [mask-image:linear-gradient(to_top,black_35%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_35%,transparent_100%)] flex items-end justify-center pb-3"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-center">
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                onClick={() => scrollToBottom(true)}
                className="text-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-10 w-10" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isActive && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-3xl px-4">
            <AnimatePresence>
              <AiChatGreeting
                userName={firstName}
                onSuggestion={handleSuggestion}
              />
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
