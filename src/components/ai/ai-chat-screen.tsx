'use client';

import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useAiChat } from '@/hooks/use-ai-chat';
import { useAuth } from '@/components/providers';
import { cn } from '@/lib/utils';
import { AiChatGreeting } from './ai-chat-greeting';
import { AiChatInput } from './ai-chat-input';
import { ChatHistory } from './chat-history';
import { UsageBadge } from './usage-badge';

export function AiChatScreen() {
  const { messages, usage, isStreaming, sendMessage, abort } = useAiChat();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);

  const isActive = messages.length > 0 || isStreaming;

  const firstName = user?.user_metadata?.name?.split(' ')[0] ?? user?.email?.split('@')[0];

  return (
    <div className="flex flex-1 flex-col">
      {isActive && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            <ChatHistory messages={messages} />
          </div>
        </div>
      )}

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
                onSuggestion={(text) => sendMessage(text)}
              />
            )}
          </AnimatePresence>

          <AiChatInput
            onSend={(text, f) => sendMessage(text, f)}
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
