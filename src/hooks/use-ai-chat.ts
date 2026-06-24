'use client';

import { useCallback, useMemo, useRef } from 'react';
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
  result?: { type: string; data: unknown; deckName?: string; count?: number };
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

function toolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    create_plan: '📋 Creating execution plan...',
    ask_user: '❓ Asking you a question...',
    fetch_material: '📝 Generating material...',
    webfetch: '🌐 Fetching content...',
    extract_concepts: '🔍 Extracting key concepts...',
    evaluate_quality: '✅ Evaluating quality...',
    generate_flashcards: '📇 Generating flashcards...',
    finish: '🏁 Finishing up...',
  };
  return labels[toolName] || `🛠️ Using ${toolName}...`;
}

function toolResultLabel(toolName: string, output: unknown): string {
  const o = output as Record<string, unknown> | undefined;
  switch (toolName) {
    case 'create_plan':
      return `📋 Created plan with ${(o?.steps as unknown[])?.length ?? 0} steps`;
    case 'fetch_material':
      return `📝 Generated ${(o?.length as number) ?? 0} characters of material`;
    case 'webfetch':
      return `🌐 Fetched ${(o?.length as number) ?? 0} chars`;
    case 'extract_concepts':
      return `🔍 Found ${(o?.terms as unknown[])?.length ?? 0} key concepts`;
    case 'evaluate_quality':
      return o?.passed ? '✅ Quality check passed' : '❌ Quality check failed';
    case 'generate_flashcards':
      return `📇 Generated ${(o?.flashcards as unknown[])?.length ?? 0} flashcards`;
    default:
      return `🏁 ${toolName} completed`;
  }
}

function toolStateToStatus(state: string): 'thinking' | 'running' | 'complete' {
  if (state === 'input-streaming') return 'thinking';
  if (state === 'input-available') return 'running';
  return 'complete';
}

export function useAiChat(): UseAiChatReturn {
  const chatResult = (useChat as any)({
    transport: new DefaultChatTransport({ api: '/api/v1/ai/chat' }),
  });
  const { messages: uiMessages = [], sendMessage: sendChatMessage, stop, status } = chatResult;

  const messagesRef = useRef<ChatMessage[]>([]);

  const messages: ChatMessage[] = useMemo(() => {
    const mapped: ChatMessage[] = [];
    const isStreaming = status === 'streaming';

    for (const m of uiMessages) {
      if (m.role === 'user') {
        mapped.push({
          id: m.id,
          role: 'user',
          content: m.parts?.find((p: any) => p.type === 'text')?.text || '',
          status: 'complete',
          thinkingTraces: [],
        });
        continue;
      }

      const parts = m.parts || [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (part.type === 'text') {
          const isLast = i === parts.length - 1;
          mapped.push({
            id: `${m.id}-text-${i}`,
            role: 'assistant',
            content: part.text || '',
            status: isLast && isStreaming ? 'streaming' : 'complete',
            thinkingTraces: [],
          });
          continue;
        }

        if (part.type === 'reasoning') {
          mapped.push({
            id: `${m.id}-thought-${i}`,
            role: 'thought',
            content: part.text || '',
            status: 'complete',
            thinkingTraces: [],
          });
          continue;
        }

        if (part.type?.startsWith?.('tool-')) {
          const toolName = part.type.slice(5);
          const state = part.state || 'output-available';
          const toolStatus = toolStateToStatus(state);
          const input = part.input;

          mapped.push({
            id: part.toolCallId || `${m.id}-tool-${toolName}-${i}`,
            role: 'tool_call',
            content: '',
            toolName,
            label:
              toolStateToStatus(state) !== 'complete'
                ? toolLabel(toolName)
                : toolResultLabel(toolName, part.output),
            args: input,
            toolResult: state === 'output-available' ? part.output : undefined,
            status: toolStatus,
            thinkingTraces: [],
          });

          if (toolName === 'generate_flashcards') {
            if (state === 'output-error') {
              mapped.push({
                id: `${part.toolCallId || `${m.id}-tool-${toolName}-${i}`}-error`,
                role: 'tool_call',
                content: '',
                toolName,
                label: `❌ ${toolName} failed`,
                status: 'error' as const,
                thinkingTraces: [],
              });
              continue;
            }

            const output = part.output as any;
            const inputData = input as any;
            const flashcards = output?.flashcards;
            const isComplete = state === 'output-available';

            console.log('[TRACE] tool-generate-flashcards', {
              state,
              hasOutput: !!output,
              hasInput: !!input,
              outputCards: flashcards?.length ?? -1,
              inputCount: inputData?.count,
              ts: Date.now(),
            });

            mapped.push({
              id: `${m.id}-result-${i}`,
              role: 'assistant',
              content: '',
              status: isComplete ? 'complete' : 'running',
              thinkingTraces: [],
              result: {
                type: 'flashcards',
                data: isComplete && flashcards?.length ? flashcards : [],
                deckName: isComplete
                  ? output?.deckName || 'Generated Flashcards'
                  : inputData?.deck_name || undefined,
                count: inputData?.count || 6,
              },
            });
          }

          if (state === 'output-available' && toolName === 'ask_user') {
            const output = part.output as any;
            if (output?.type === 'question' && output?.question) {
              const existing = mapped[mapped.length - 1];
              if (existing) {
                existing.question = output.question;
              }
            }
          }

          if (state === 'output-available' && toolName === 'create_plan') {
            const output = part.output as any;
            if (output?.steps) {
              mapped.push({
                id: `${m.id}-plan-${i}`,
                role: 'plan',
                content: '',
                status: 'complete',
                thinkingTraces: [],
                plan: output.steps.map((s: any, idx: number) => ({
                  index: idx,
                  action: s.action || '',
                  rationale: s.rationale || '',
                  dependsOn: s.dependsOn,
                })),
                planCompleted: true,
              });
            }
          }

          if (state === 'output-available' && toolName === 'finish') {
            const output = part.output as any;
            const text = output?.type === 'chat' ? output?.content : '';
            if (text) {
              mapped.push({
                id: `${m.id}-finish-${i}`,
                role: 'assistant',
                content: text,
                status: 'complete',
                thinkingTraces: [],
              });
            }
          }
        }
      }
    }

    // Stabilize: reuse previous objects for unchanged messages (content-based matching)
    const prev = messagesRef.current;
    const used = new Set<number>();
    const result = mapped.map((msg) => {
      const idx = prev.findIndex(
        (p, i) =>
          !used.has(i) &&
          p.role === msg.role &&
          p.content === msg.content &&
          p.status === msg.status &&
          p.toolName === msg.toolName &&
          p.label === msg.label,
      );
      if (idx !== -1) {
        used.add(idx);
        return prev[idx];
      }
      return msg;
    });
    const hasChanges = result.some((r, i) => r !== prev[i]);
    if (!hasChanges && result.length === prev.length) {
      return prev;
    }
    messagesRef.current = result;
    return result;
  }, [uiMessages, status]);

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
