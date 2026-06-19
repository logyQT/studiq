'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useAuth } from '@/components/providers';
import { cn } from '@/lib/utils';
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
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const isActive = messages.length > 0 || isStreaming;

  const firstName = user?.user_metadata?.name?.split(' ')[0] ?? user?.email?.split('@')[0];

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    shouldAutoScrollRef.current = true;
    setIsAtBottom(true);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsAtBottom(atBottom);
    shouldAutoScrollRef.current = atBottom;
  }, []);

  // Auto-scroll to bottom when new messages arrive and user is at bottom
  useEffect(() => {
    if (shouldAutoScrollRef.current && messages.length > 0) {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages]);

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
    <div className="flex flex-1 flex-col">
      {isActive && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          <div className="mx-auto max-w-3xl px-4 py-6">
            <ChatHistory messages={messages} onAnswer={handleAnswer} />
          </div>
        </div>
      )}

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {!isAtBottom && isActive && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            onClick={scrollToBottom}
            className="fixed bottom-32 right-6 z-50 rounded-full border bg-background shadow-lg p-2 hover:bg-muted transition-colors"
          >
            <ChevronDown className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>

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
