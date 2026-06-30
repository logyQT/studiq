'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useMemo } from 'react';
import { log } from '@/lib/logger';

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
  stop: () => void;
  status: string;
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
  const chatResult = useChat({
    transport: new DefaultChatTransport({ api: '/api/v1/ai/chat' }),
  }) as unknown as UseChatResultRaw;
  const { messages: uiMessages = [], sendMessage: sendChatMessage, stop, status } = chatResult;

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
              log.trace.debug('tool-generate-flashcards', {
                metadata: {
                  state,
                  hasOutput: !!outputMap,
                  hasInput: !!inputMap,
                  outputCards: flashcardArray.length,
                  inputCount: inputMap?.count,
                },
              });
            }

            mapped.push({
              id: `${m.id}-result-${i}`,
              role: 'assistant',
              content: '',
              status: isComplete ? 'complete' : 'running',
              thinkingTraces: [],
              result: {
                type: 'flashcards',
                data: isComplete ? flashcardArray : [],
                deckName: isComplete
                  ? String(outputMap?.deckName ?? 'Generated Flashcards')
                  : typeof inputMap?.deck_name === 'string'
                    ? inputMap.deck_name
                    : undefined,
                count: isComplete ? Number(outputMap?.count) || 6 : Number(inputMap?.count) || 6,
                readOnly: isComplete,
              },
            });
          }

          if (state === 'output-available' && toolName === 'ask_user') {
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
              const flashcardArray = Array.isArray(outputMap?.flashcards)
                ? (outputMap.flashcards as Array<Record<string, unknown>>)
                : [];
              mapped.push({
                id: `${m.id}-finish-cards-${i}`,
                role: 'assistant',
                content: '',
                status: 'complete',
                thinkingTraces: [],
                result: {
                  type: 'flashcards',
                  data: flashcardArray,
                  deckName: String(outputMap?.deckName ?? 'Consolidated Flashcards'),
                  count: flashcardArray.length,
                  readOnly: false,
                },
              });
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
    }

    return mapped;
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
