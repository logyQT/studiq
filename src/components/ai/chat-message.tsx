'use client';

import { useState } from 'react';
import { FileText, Loader2, AlertCircle, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import { FlashcardBlock } from './flashcard-block';
import { ThinkingBlock } from './thinking-block';
import { QuestionBlock } from './question-block';
import { ToolCallBlock } from './tool-call-block';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';

interface ChatMessageProps {
  message: ChatMessageType;
  onAnswer?: (text: string) => void;
}

export function ChatMessage({ message, onAnswer }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isThought = message.role === 'thought';
  const isToolCall = message.role === 'tool_call';

  if (isThought) {
    return <ThoughtMessage message={message} />;
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
}

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
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="font-medium">
            {isThinking ? 'Thinking...' : 'Thought'}
          </span>
          {isThinking && (
            <span className="ml-auto flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '0ms' }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '150ms' }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </button>
        {(open || isThinking) && message.content && (
          <div className="whitespace-pre-wrap px-3 pb-2 text-muted-foreground/80">
            {message.content}
            {isThinking && <span className="animate-pulse">▌</span>}
          </div>
        )}
      </div>
    </div>
  );
}
