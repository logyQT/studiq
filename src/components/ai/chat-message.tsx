'use client';

import { AlertCircle, ChevronDown, ChevronRight, FileText, Loader2, Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import { cn } from '@/lib/utils';
import { FlashcardBlock } from './flashcard-block';
import { PlanBlock } from './plan-block';
import { QuestionBlock } from './question-block';
import { ThinkingBlock } from './thinking-block';
import { ToolCallBlock } from './tool-call-block';

interface ChatMessageProps {
  message: ChatMessageType;
  onAnswer?: (text: string) => void;
}

export const ChatMessage = memo(
  function ChatMessage({ message, onAnswer }: ChatMessageProps) {
    const isUser = message.role === 'user';
    const isThought = message.role === 'thought';
    const isToolCall = message.role === 'tool_call';
    const isPlan = message.role === 'plan';

    if (isThought) {
      return <ThoughtMessage message={message} />;
    }

    if (isPlan) {
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%] w-full">
            <PlanBlock
              steps={message.plan || []}
              isComplete={message.planCompleted ?? false}
              completedSteps={message.completedSteps}
            />
          </div>
        </div>
      );
    }

    if (
      isToolCall &&
      (message.toolName === 'create_plan' ||
        message.toolName === 'finish' ||
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
              status={message.status as 'running' | 'complete'}
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
    const isSending = message.status === 'sending';
    const isThinking = message.status === 'thinking';

    const hasThinkingTraces = message.thinkingTraces.length > 0;
    const isFlashcardResult = message.result?.type === 'flashcards';
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

          {isSending && !message.content ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs italic">Thinking...</span>
            </div>
          ) : isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : isStreaming ? (
            <div className="whitespace-pre-wrap break-words">
              {message.content}
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary" />
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}

          {(isThinking || hasThinkingTraces) && (
            <ThinkingBlock traces={message.thinkingTraces} isComplete={isComplete || isError} />
          )}

          {isFlashcardResult &&
            Array.isArray(message.result!.data) &&
            (message.result!.data.length === 0 ? (
              <FlashcardBlock
                loading
                count={message.result!.count}
                deckName={
                  typeof message.result!.deckName === 'string'
                    ? message.result!.deckName
                    : undefined
                }
                readOnly={message.result!.readOnly}
              />
            ) : (
              <FlashcardBlock
                flashcards={
                  message.result!.data as Array<{ front: string; back: string; topic?: string }>
                }
                deckName={
                  typeof message.result!.deckName === 'string'
                    ? message.result!.deckName
                    : undefined
                }
                readOnly={message.result!.readOnly}
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
      a.thinkingTraces?.length === b.thinkingTraces?.length
    );
  },
);

function ThoughtMessage({ message }: { message: ChatMessageType }) {
  const [open, setOpen] = useState(false);
  const isThinking = message.status === 'thinking';

  if (!message.content && !isThinking) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-md border border-border/50 bg-muted/10 text-xs">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="font-medium">{isThinking ? 'Thinking...' : 'Thought'}</span>
          {isThinking && (
            <span className="ml-auto flex gap-0.5">
              <span
                className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          )}
        </button>
        {open && message.content && (
          <div className="whitespace-pre-wrap px-3 pb-2 text-muted-foreground/80">
            {message.content}
            {isThinking && <span className="animate-pulse">▌</span>}
          </div>
        )}
      </div>
    </div>
  );
}
