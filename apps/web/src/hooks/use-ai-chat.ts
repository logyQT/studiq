'use client';

import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport } from 'ai';
import { useCallback, useMemo } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { parseAiChatErrorCode } from '@/lib/ai-chat-error';
import { aiKeys } from '@/lib/query-keys';

interface ChatPart {
  type: string;
  text?: string;
  toolCallId?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

interface UiMessageRaw {
  id: string;
  role: string;
  content?: string;
  parts?: ChatPart[];
}

interface UseChatResultRaw {
  messages: UiMessageRaw[];
  sendMessage: (data: { text: string }) => Promise<void>;
  setMessages: (updater: (prev: UiMessageRaw[]) => UiMessageRaw[]) => void;
  stop: () => void;
  status: string;
  error: Error | undefined;
  clearError: () => void;
  regenerate: () => Promise<void>;
}

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
  result?: { type: string; data: unknown; deckName?: string; count?: number; readOnly?: boolean };
  status: 'sending' | 'streaming' | 'thinking' | 'complete' | 'error' | 'running';
  error?: string;
  file?: { name: string; mimeType: string; data: string };
  thinkingTraces: string[];
  question?: QuestionData;
  plan?: PlanStep[];
  planCompleted?: boolean;
  completedSteps?: number[];
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
  /** App error code of the last failed send (`USAGE_LIMIT_EXCEEDED`, `RATE_LIMITED`, …). */
  errorCode: string | null;
  /** `true` whenever the last send failed, including errors without a parseable code. */
  hasError: boolean;
  clearError: () => void;
  /** Dismiss the error and re-send the last user message. */
  retry: () => void;
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

export function useAiChat({ enabled = true }: { enabled?: boolean } = {}): UseAiChatReturn {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Daily AI token budget (#379) — the server enforces this on
  // `POST /api/v1/ai/chat`; fetch it so `UsageBadge` can render it.
  // `staleTime: 0` + the global `refetchOnWindowFocus` keeps the number fresh
  // after a plan change or a tab focus; streaming completion invalidates it.
  const { data: usageData } = useApiQuery<UsageInfo>({
    queryKey: aiKeys.usage,
    url: '/api/v1/ai/usage',
    staleTime: 0,
    // Usage is resolved per user (and active org); fetching before
    // `/api/v1/auth/me` resolves would cache a 401 as the anonymous entry (#458).
    // A locked page (#375) never chats, so it must not spend a request either.
    enabled: enabled && !!user,
  });

  const chatResult = useChat({
    transport: new DefaultChatTransport({ api: '/api/v1/ai/chat' }),
    onFinish: () => {
      // The chat route awaits `trackTokenUsage` before the stream closes, so
      // refetching here reads the post-message totals (#379). The SDK calls
      // `onFinish` from a `finally`, so a rejected send refetches too.
      queryClient.invalidateQueries({ queryKey: aiKeys.usage });
    },
  }) as unknown as UseChatResultRaw;
  const {
    messages: uiMessages = [],
    sendMessage: sendChatMessage,
    setMessages,
    stop,
    status,
    error: chatError,
    clearError,
    regenerate,
  } = chatResult;

  const messages: ChatMessage[] = useMemo(() => {
    const mapped: ChatMessage[] = [];
    const isStreaming = status === 'streaming';
    const lastMsg = uiMessages[uiMessages.length - 1];
    const isLastAssistant = lastMsg?.role === 'assistant';
    let planMsgRef: ChatMessage | null = null;
    let totalPlanSteps = 0;
    const completedStepSet = new Set<number>();

    for (const m of uiMessages) {
      if (m.role === 'user') {
        mapped.push({
          id: m.id,
          role: 'user',
          content: m.parts?.find((p) => p.type === 'text')?.text || '',
          status: 'complete',
          thinkingTraces: [],
        });
        continue;
      }

      const parts = m.parts || [];
      let pendingCards: Array<Record<string, unknown>> | null = null;
      let pendingDeckName = 'Generated Flashcards';
      let finalFlashcardsProcessed = false;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (part.type === 'text') {
          const isLast = i === parts.length - 1;
          const isActiveStream = isStreaming && isLastAssistant && m === lastMsg && isLast;
          mapped.push({
            id: `${m.id}-text-${i}`,
            role: 'assistant',
            content: part.text || '',
            status: isActiveStream ? 'streaming' : 'complete',
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
          const tp = part;
          const toolName = part.type.slice(5);
          const state = tp.state || 'output-available';
          const toolStatus = toolStateToStatus(state);
          const input = tp.input;

          mapped.push({
            id: tp.toolCallId || `${m.id}-tool-${toolName}-${i}`,
            role: 'tool_call',
            content: '',
            toolName,
            label:
              toolStateToStatus(state) !== 'complete'
                ? toolLabel(toolName)
                : toolResultLabel(toolName, tp.output),
            args: input,
            toolResult: state === 'output-available' ? tp.output : undefined,
            status: toolStatus,
            thinkingTraces: [],
          });

          if (toolName === 'generate_flashcards') {
            if (state === 'output-error') {
              mapped.push({
                id: `${tp.toolCallId || `${m.id}-tool-${toolName}-${i}`}-error`,
                role: 'tool_call',
                content: '',
                toolName,
                label: `❌ ${toolName} failed`,
                status: 'error' as const,
                thinkingTraces: [],
              });
              continue;
            }

            const outputMap: Record<string, unknown> | undefined = tp.output;
            const inputMap: Record<string, unknown> | undefined = tp.input;
            const flashcardArray = Array.isArray(outputMap?.flashcards)
              ? (outputMap.flashcards as Array<Record<string, unknown>>)
              : [];
            const isComplete = state === 'output-available';

            if (process.env.NODE_ENV !== 'production') {
              console.info('tool-generate-flashcards', {
                state,
                hasOutput: !!outputMap,
                hasInput: !!inputMap,
                outputCards: flashcardArray.length,
                inputCount: inputMap?.count,
              });
            }

            if (isComplete) {
              pendingCards = flashcardArray;
              pendingDeckName = String(outputMap?.deckName ?? 'Generated Flashcards');
            }
          }

          if (state === 'output-available' && toolName === 'ask_user') {
            if (pendingCards && !finalFlashcardsProcessed) {
              mapped.push({
                id: `${m.id}-preview-${i}`,
                role: 'assistant',
                content: '',
                status: 'complete',
                thinkingTraces: [],
                result: {
                  type: 'flashcards',
                  data: pendingCards,
                  deckName: pendingDeckName,
                  count: pendingCards.length,
                  readOnly: true,
                },
              });
              pendingCards = null;
            }
            const outputMap: Record<string, unknown> | undefined = tp.output;
            if (outputMap?.type === 'question' && outputMap?.question) {
              const existing = mapped[mapped.length - 1];
              if (existing) {
                existing.question = outputMap.question as QuestionData;
              }
            }
          }

          if (state === 'output-available' && toolName === 'create_plan') {
            const outputMap: Record<string, unknown> | undefined = tp.output;
            if (outputMap?.steps) {
              const steps = outputMap.steps as Array<Record<string, unknown>>;
              const planMsg: ChatMessage = {
                id: `${m.id}-plan-${i}`,
                role: 'plan',
                content: '',
                status: 'complete',
                thinkingTraces: [],
                plan: steps.map((s: Record<string, unknown>, idx: number) => ({
                  index: idx,
                  action: String(s.action ?? ''),
                  rationale: String(s.rationale ?? ''),
                  dependsOn: s.dependsOn as string[] | undefined,
                })),
                planCompleted: false,
                completedSteps: [],
              };
              planMsgRef = planMsg;
              totalPlanSteps = steps.length;
              completedStepSet.clear();
              mapped.push(planMsg);
            }
          }

          if (
            planMsgRef &&
            state === 'output-available' &&
            !['create_plan', 'finish', 'ask_user'].includes(toolName)
          ) {
            const stepAction = planMsgRef.plan?.find((s) => s.action === toolName);
            if (stepAction !== undefined) {
              completedStepSet.add(stepAction.index);
            } else {
              const nextPending = [...Array(totalPlanSteps).keys()].find(
                (i) => !completedStepSet.has(i),
              );
              if (nextPending !== undefined) {
                completedStepSet.add(nextPending);
              }
            }
            planMsgRef.completedSteps = [...completedStepSet];
            planMsgRef.planCompleted = completedStepSet.size >= totalPlanSteps;
          }

          if (state === 'output-available' && toolName === 'finish') {
            if (planMsgRef) {
              for (let si = 0; si < totalPlanSteps; si++) {
                completedStepSet.add(si);
              }
              planMsgRef.completedSteps = [...completedStepSet];
              planMsgRef.planCompleted = true;
            }

            const outputMap: Record<string, unknown> | undefined = tp.output;
            if (outputMap?.type === 'flashcards') {
              const cards =
                pendingCards && pendingCards.length > 0
                  ? pendingCards
                  : Array.isArray(outputMap.flashcards)
                    ? (outputMap.flashcards as Array<Record<string, unknown>>)
                    : [];
              mapped.push({
                id: `${m.id}-cards-${i}`,
                role: 'assistant',
                content: '',
                status: 'complete',
                thinkingTraces: [],
                result: {
                  type: 'flashcards',
                  data: cards,
                  deckName: pendingDeckName,
                  count: cards.length,
                  readOnly: false,
                },
              });
              finalFlashcardsProcessed = true;
            }
            const text = outputMap?.type === 'chat' ? String(outputMap?.content ?? '') : '';
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

      if (pendingCards && !finalFlashcardsProcessed) {
        mapped.push({
          id: `${m.id}-buffered-cards`,
          role: 'assistant',
          content: '',
          status: 'complete',
          thinkingTraces: [],
          result: {
            type: 'flashcards',
            data: pendingCards,
            deckName: pendingDeckName,
            count: pendingCards.length,
            readOnly: false,
          },
        });
      }
    }

    return mapped;
  }, [uiMessages, status]);

  const handleSend = useCallback(
    async (text: string, _file?: File, _context?: string) => {
      await sendChatMessage({ text });
    },
    [sendChatMessage],
  );

  const sendLocalResponse = useCallback(
    (userText: string, assistantText: string) => {
      const stamp = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [
        ...prev,
        { id: `${stamp}-user`, role: 'user', parts: [{ type: 'text', text: userText }] },
        {
          id: `${stamp}-assistant`,
          role: 'assistant',
          parts: [{ type: 'text', text: assistantText }],
        },
      ]);
    },
    [setMessages],
  );

  const clearChat = useCallback(() => {
    if (status === 'streaming' || status === 'submitted') stop();
    setMessages(() => []);
  }, [status, stop, setMessages]);

  const retry = useCallback(() => {
    // `regenerate()` re-sends the last user message when the failed request
    // produced no assistant message, which is exactly the 429/rate-limit case.
    clearError();
    void regenerate();
  }, [clearError, regenerate]);

  return {
    messages,
    usage: usageData ?? null,
    isStreaming: status === 'streaming',
    sendMessage: handleSend,
    sendLocalResponse,
    clearChat,
    abort: stop,
    errorCode: parseAiChatErrorCode(chatError),
    hasError: chatError !== undefined,
    clearError,
    retry,
  };
}
