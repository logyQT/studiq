'use client';

import { useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export interface QuestionData {
  id: string;
  question: string;
  options?: { label: string; value: string }[];
  answered?: boolean;
}

export interface PlanStep {
  index: number;
  action: string;
  rationale: string;
  dependsOn?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thought' | 'tool_call' | 'plan';
  content: string;
  result?: { type: string; data: unknown; deckName?: string };
  status: 'sending' | 'streaming' | 'thinking' | 'complete' | 'error' | 'running';
  error?: string;
  file?: { name: string; mimeType: string; data: string };
  thinkingTraces: string[];
  question?: QuestionData;
  plan?: PlanStep[];
  planCompleted?: boolean;
  step?: number;
  reasoning?: string;
  agent?: string;
  toolName?: string;
  label?: string;
  subTask?: string;
  subToolCount?: number;
  args?: unknown;
  toolResult?: unknown;
  durationMs?: number;
}

export interface UsageInfo {
  current: number;
  limit: number;
  plan: string;
  resetsAt: string;
}

export interface UseAiChatReturn {
  messages: ChatMessage[];
  usage: UsageInfo | null;
  isStreaming: boolean;
  sendMessage: (text: string, file?: File, context?: string) => Promise<void>;
  sendLocalResponse: (userText: string, assistantText: string) => void;
  clearChat: () => void;
  abort: () => void;
}

export function useAiChat(): UseAiChatReturn {
  const chatResult = (useChat as any)({
    transport: new DefaultChatTransport({ api: '/api/v1/ai/chat' }),
  });
  const { messages: uiMessages = [], sendMessage: sendChatMessage, stop, status } = chatResult;

  const messages: ChatMessage[] = uiMessages.map((m: any) => {
    const textContent = m.parts?.find((p: any) => p.type === 'text')?.text || m.content || '';
    return {
      id: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      content: textContent,
      status: m.role === 'user' ? 'complete' : status === 'streaming' ? 'streaming' : 'complete',
      thinkingTraces: [],
    };
  });

  const handleSend = useCallback(
    async (text: string, _file?: File, _context?: string) => {
      await sendChatMessage({ text });
    },
    [sendChatMessage],
  );

  const sendLocalResponse = useCallback((_userText: string, _assistantText: string) => {}, []);

  const clearChat = useCallback(() => {}, []);

  return {
    messages,
    usage: null,
    isStreaming: status === 'streaming',
    sendMessage: handleSend,
    sendLocalResponse,
    clearChat,
    abort: stop,
  };
}
