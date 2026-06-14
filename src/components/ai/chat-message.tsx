'use client';

import { Bot, User, FileText, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import { FlashcardBlock } from './flashcard-block';
import { ThinkingBlock } from './thinking-block';

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
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-0.5',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          'max-w-[75%] space-y-2 rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-md'
            : 'bg-muted/50 text-foreground rounded-tl-md',
        )}
      >
        {/* File attachment */}
        {message.file && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>{message.file.name}</span>
          </div>
        )}

        {/* Content */}
        {isSending && !message.content ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs italic">Thinking...</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">
            {message.content}
            {isStreaming && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse" />}
          </div>
        )}

        {/* Thinking traces (collapsible) */}
        {(isThinking || hasThinkingTraces) && (
          <ThinkingBlock traces={message.thinkingTraces} isComplete={isComplete || isError} />
        )}

        {/* Flashcard result */}
        {isFlashcardResult && (isComplete || isError) && Array.isArray(message.result!.data) && (
          <FlashcardBlock flashcards={message.result!.data as Array<{ front: string; back: string; topic?: string }>} />
        )}

        {/* Generic result block */}
        {message.result && !isFlashcardResult && !isStreaming && (
          <div className="rounded-lg border bg-background/80 p-3 text-xs text-muted-foreground mt-2">
            {message.result.type === 'summary' && <span>Summary ready</span>}
            {message.result.type === 'quiz' && <span>Quiz questions ready</span>}
            {message.result.type === 'explain' && <span>Explanation ready</span>}
          </div>
        )}

        {/* Error */}
        {isError && message.error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive mt-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{message.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
