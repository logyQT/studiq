'use client';

import { AlertCircle, FileText } from 'lucide-react';
import { memo } from 'react';
import type { FlashcardData } from '@/components/ai/generated-cards';
import { type DeckTarget, FlashcardBlock } from '@/components/ai/flashcard-block';
import { QuestionBlock } from '@/components/ai/question-block';
import { ToolCallBlock } from '@/components/ai/tool-call-block';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  message: ChatMessageType;
  onAnswer?: (text: string) => void;
  deckTarget?: DeckTarget | null;
}

/** The chat payload is `unknown` until it has been shaped like a card. */
function isFlashcardData(value: unknown): value is FlashcardData {
  if (typeof value !== 'object' || value === null) return false;
  if (!('front' in value) || typeof value.front !== 'string') return false;
  if (!('back' in value) || typeof value.back !== 'string') return false;
  return true;
}

function toFlashcardData(value: unknown): FlashcardData[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.filter(isFlashcardData);
}

export const ChatMessage = memo(
  function ChatMessageContent({ message, onAnswer, deckTarget }: ChatMessageProps) {
    const isUser = message.role === 'user';
    const isToolCall = message.role === 'tool_call';

    if (
      isToolCall &&
      (message.toolName === 'finish' ||
        message.toolName === 'ask_user' ||
        message.toolName === 'generate_flashcards')
    ) {
      return null;
    }

    if (isToolCall) {
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%]">
            <ToolCallBlock
              toolName={message.toolName || ''}
              label={message.label || ''}
              status={message.status === 'running' ? 'running' : 'complete'}
              args={message.args}
              result={message.toolResult}
              durationMs={message.durationMs}
            />
          </div>
        </div>
      );
    }

    const isStreaming = message.status === 'streaming';
    const isError = message.status === 'error';

    const isFlashcardResult = message.result?.type === 'flashcards';
    const result = message.result;
    const flashcardCards = toFlashcardData(result?.data);
    const isComplete = message.status === 'complete';

    return (
      <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'max-w-[80%] space-y-2 rounded-2xl px-4 py-3 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-muted/30 text-foreground rounded-bl-md',
          )}
        >
          {message.file && (
            <div className="flex items-center gap-1.5 text-xs text-primary-foreground/80">
              <FileText className="h-3.5 w-3.5" />
              <span>{message.file.name}</span>
            </div>
          )}

          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : isStreaming ? (
            <div className="whitespace-pre-wrap break-words">
              {message.content}
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary" />
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}

          {isFlashcardResult &&
            result &&
            Array.isArray(result.data) &&
            (flashcardCards.length === 0 ? (
              <FlashcardBlock
                loading
                count={result.count}
                deckName={typeof result.deckName === 'string' ? result.deckName : undefined}
                readOnly={result.readOnly}
                targetDeck={deckTarget}
              />
            ) : (
              <FlashcardBlock
                flashcards={flashcardCards}
                deckName={typeof result.deckName === 'string' ? result.deckName : undefined}
                readOnly={result.readOnly}
                targetDeck={deckTarget}
              />
            ))}

          {message.question && isComplete && onAnswer && (
            <QuestionBlock question={message.question} onAnswer={onAnswer} />
          )}

          {message.result && !isFlashcardResult && !isStreaming && (
            <div className="mt-2 rounded-lg border bg-background/80 p-3 text-xs text-muted-foreground">
              {message.result.type === 'summary' && <span>Summary ready</span>}
              {message.result.type === 'quiz' && <span>Quiz questions ready</span>}
              {message.result.type === 'explain' && <span>Explanation ready</span>}
            </div>
          )}

          {isError && message.error && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{message.error}</span>
            </div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.onAnswer !== nextProps.onAnswer) return false;
    if (prevProps.deckTarget?.id !== nextProps.deckTarget?.id) return false;
    const a = prevProps.message;
    const b = nextProps.message;
    return (
      a.id === b.id &&
      a.content === b.content &&
      a.status === b.status &&
      a.role === b.role &&
      a.toolName === b.toolName &&
      a.label === b.label &&
      a.error === b.error &&
      a.question?.id === b.question?.id &&
      a.question?.question === b.question?.question &&
      a.question?.answered === b.question?.answered
    );
  },
);
