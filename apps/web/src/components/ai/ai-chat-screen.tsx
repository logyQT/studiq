'use client';

import { Skeleton } from '@studiq/ui';
import { AnimatePresence } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { AiChatGreeting } from '@/components/ai/ai-chat-greeting';
import { AiChatInput } from '@/components/ai/ai-chat-input';
import { AiChatLockedState } from '@/components/ai/ai-chat-locked-state';
import { ChatErrorAlert } from '@/components/ai/chat-error-alert';
import { ChatHistory } from '@/components/ai/chat-history';
import { UsageBadge } from '@/components/ai/usage-badge';
import { useAuth } from '@/components/providers/AuthProvider';

import { ScrollBackToBar } from '@/components/shared/scroll-back-to-bar';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useFeature } from '@/hooks/use-feature';
import { useFeatures } from '@/hooks/use-features';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';

/** Shown while the feature set resolves, so entitled users never flash the lock. */
function AiChatSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-4">
        <Skeleton className="mx-auto h-10 w-2/3" />
        <Skeleton className="mx-auto h-4 w-1/2" />
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function AiChatScreen() {
  // Same query pair the settings page uses (`useFeature()` + `useFeatures()`)
  // to keep a provisional `false` from rendering the locked card mid-flight.
  const feature = useFeature();
  const { isPending: featuresPending } = useFeatures();
  const canChat = feature('ai.chat');

  const {
    messages,
    usage,
    isStreaming,
    sendMessage,
    sendLocalResponse,
    abort,
    errorCode,
    hasError,
    clearError,
    retry,
  } = useAiChat({ enabled: canChat });
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

  // Plan gate (#375): `ai.chat` is the same entitlement the sidebar uses, so a
  // direct `/app/ai` must not render a composer every send would 429 on. Both
  // returns sit below every hook so the hook order is stable when `canChat`
  // flips once the features query settles.
  if (featuresPending) return <AiChatSkeleton />;
  if (!canChat) return <AiChatLockedState />;

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {isActive && (
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" onScroll={handleScroll}>
            <div className="mx-auto max-w-3xl px-4 py-6">
              <ChatHistory messages={messages} onAnswer={handleAnswer} />
              <div className="pt-4">
                {hasError && (
                  <div className="mb-2">
                    <ChatErrorAlert errorCode={errorCode} onRetry={retry} onDismiss={clearError} />
                  </div>
                )}
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

            {hasError && (
              <div className="mb-2">
                <ChatErrorAlert errorCode={errorCode} onRetry={retry} onDismiss={clearError} />
              </div>
            )}

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
      )}
    </div>
  );
}
