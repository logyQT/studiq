'use client';

import type { Deck } from '@studiq/server/models/flashcard-deck.model';
import { Button, Skeleton } from '@studiq/ui';
import { Layers } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { AiChatGreeting } from '@/components/ai/ai-chat-greeting';
import { AiChatInput } from '@/components/ai/ai-chat-input';
import { AiChatLockedState } from '@/components/ai/ai-chat-locked-state';
import { ChatErrorAlert } from '@/components/ai/chat-error-alert';
import { ChatHistory } from '@/components/ai/chat-history';
import type { DeckTarget } from '@/components/ai/flashcard-block';
import { UsageBadge } from '@/components/ai/usage-badge';
import { useAuth } from '@/components/providers/AuthProvider';

import { ScrollBackToBar } from '@/components/shared/scroll-back-to-bar';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { useFeatures } from '@/hooks/use-features';
import { usePermission } from '@/hooks/use-permission';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import { flashcardKeys } from '@/lib/query-keys';

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

/** Any UUID shape, including the non-RFC seed ids (`…-4000-8006-…`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AiChatScreenProps {
  /** Deck the chat was opened from (`?deckId=`), used as the save target. */
  deckId?: string;
}

export function AiChatScreen({ deckId }: AiChatScreenProps) {
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
  const router = useRouter();
  const pathname = usePathname();
  const permission = usePermission();
  const t = useTranslations('AiChatPage');
  const [file, setFile] = useState<File | null>(null);
  const [activeContext, setActiveContext] = useState<string | null>(null);
  const { containerRef: scrollRef, handleScroll, isAtBottom, scrollToBottom } = useScrollToBottom();

  const isActive = messages.length > 0 || isStreaming;

  const validDeckId = deckId && UUID_RE.test(deckId) ? deckId : undefined;
  const { data: deck } = useApiQuery<Deck>({
    queryKey: flashcardKeys.decks.detail(validDeckId ?? ''),
    url: validDeckId ? `/api/v1/flashcards/decks/${validDeckId}` : '',
    // A locked page must not fetch a deck it can never use (same rule as the
    // usage query in `useAiChat`).
    enabled: !!validDeckId && canChat,
  });

  // Mirrors the server check in `flashcardService.bulkCreate`; a read-only or
  // foreign deck simply yields no target and the chat keeps the new-deck flow.
  const canSaveToDeck =
    !!deck &&
    permission('deck.update', { createdBy: deck.created_by, orgId: deck.organization_id }) &&
    permission('flashcard.create', { createdBy: user?.id });

  const deckTarget = useMemo<DeckTarget | null>(
    () => (deck && canSaveToDeck ? { id: deck.id, name: deck.name } : null),
    [deck, canSaveToDeck],
  );

  const firstName = user?.user_metadata?.name?.split(' ')[0] ?? user?.email?.split('@')[0];

  // The URL is the single source of truth for the target, so a same-route
  // replace keeps the chat state and restores correctly on back/forward.
  const clearDeckTarget = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

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
      {deckTarget && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 text-xs">
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">{t('deck_context_target')}</span>
          <strong className="truncate font-medium text-foreground">{deckTarget.name}</strong>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 shrink-0 text-xs"
            onClick={clearDeckTarget}
          >
            {t('deck_context_new')}
          </Button>
        </div>
      )}

      {isActive && (
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" onScroll={handleScroll}>
            <div className="mx-auto max-w-3xl px-4 py-6">
              <ChatHistory messages={messages} onAnswer={handleAnswer} deckTarget={deckTarget} />
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
