'use client';

import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import { FlashcardBlock } from './flashcard-block';
import { ThinkingBlock } from './thinking-block';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
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
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>
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

        {isFlashcardResult && (isComplete || isError) && Array.isArray(message.result!.data) && (
          <FlashcardBlock
            flashcards={message.result!.data as Array<{ front: string; back: string; topic?: string }>}
            deckName={message.result!.deckName as string | undefined}
          />
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
}
