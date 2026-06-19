'use client';

import { useState, useCallback, useRef } from 'react';

export interface QuestionData {
  id: string;
  question: string;
  options?: { label: string; value: string }[];
  answered?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thought' | 'tool_call';
  content: string;
  result?: { type: string; data: unknown; deckName?: string };
  status: 'sending' | 'streaming' | 'thinking' | 'complete' | 'error' | 'running';
  error?: string;
  file?: { name: string; mimeType: string; data: string };
  thinkingTraces: string[];
  question?: QuestionData;
  step?: number;
  reasoning?: string;
  agent?: string;
  toolName?: string;
  label?: string;
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

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useAiChat(): UseAiChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string>(generateUUID());
  const fileSentRef = useRef<boolean>(false);
  const toolStartTimesRef = useRef<Map<string, number>>(new Map());

  const sendMessage = useCallback(async (text: string, file?: File, context?: string) => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    const userMsg: ChatMessage = {
      id: generateUUID(),
      role: 'user',
      content: text,
      status: 'complete',
      file: file ? { name: file.name, mimeType: file.type, data: '' } : undefined,
      thinkingTraces: [],
    };

    const assistantMsg: ChatMessage = {
      id: generateUUID(),
      role: 'assistant',
      content: '',
      status: context === 'flashcards' ? 'thinking' : 'sending',
      thinkingTraces: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => m.id !== assistantMsg.id && m.id !== userMsg.id)
        .filter((m) => m.content.length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

      const body: Record<string, unknown> = { text };
      if (context) body.context = context;
      body.conversationId = conversationIdRef.current;
      if (history.length > 0) body.messages = history;

      if (file && !fileSentRef.current) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        body.file = { data: btoa(binary), mimeType: file.type };
        fileSentRef.current = true;
      }

      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'UNKNOWN' }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, status: 'error', error: err.error || `HTTP ${res.status}` }
              : m,
          ),
        );
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, status: 'error', error: 'Response body is not readable' }
              : m,
          ),
        );
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let sseBuffer = '';

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, status: 'streaming' } : m,
        ),
      );

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6).trim();
          } else if (line === '' && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData);

              switch (currentEvent) {
                case 'token': {
                  const token = parsed.text || parsed.token || '';
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, content: m.content + token }
                        : m,
                    ),
                  );
                  break;
                }
                case 'thinking': {
                  const trace = parsed.text || parsed.message || '';
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? {
                            ...m,
                            status: 'thinking',
                            thinkingTraces: [...m.thinkingTraces, trace],
                          }
                        : m,
                    ),
                  );
                  break;
                }
                case 'thought': {
                  const thoughtMsg: ChatMessage = {
                    id: generateUUID(),
                    role: 'thought',
                    content: '',
                    status: 'complete',
                    step: parsed.step,
                    reasoning: parsed.reasoning,
                    agent: parsed.agent,
                    thinkingTraces: [],
                  };
                  setMessages((prev) => [...prev, thoughtMsg]);
                  break;
                }
                case 'tool_call': {
                  const toolCallMsg: ChatMessage = {
                    id: generateUUID(),
                    role: 'tool_call',
                    content: '',
                    status: 'running',
                    toolName: parsed.tool,
                    label: parsed.label,
                    args: parsed.args,
                    thinkingTraces: [],
                  };
                  toolStartTimesRef.current.set(parsed.id, Date.now());
                  setMessages((prev) => [...prev, toolCallMsg]);
                  break;
                }
                case 'tool_result': {
                  const startTime = toolStartTimesRef.current.get(parsed.id);
                  const duration = startTime ? Date.now() - startTime : undefined;
                  toolStartTimesRef.current.delete(parsed.id);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.role === 'tool_call' && m.toolName === parsed.tool && m.status === 'running'
                        ? {
                            ...m,
                            status: 'complete',
                            toolResult: parsed.result,
                            label: parsed.label,
                            durationMs: duration,
                          }
                        : m,
                    ),
                  );
                  break;
                }
                case 'flashcards': {
                  const deckName = parsed.deckName || 'AI Generated Flashcards';
                  const cards = Array.isArray(parsed.flashcards) ? parsed.flashcards : Array.isArray(parsed) ? parsed : [];
                  const mappedCards = cards.map((c: Record<string, unknown>) => ({
                    front: String(c.front ?? c.question ?? ''),
                    back: String(c.back ?? c.answer ?? ''),
                    topic: String(c.topic ?? c.suggestedTopic ?? '') || undefined,
                  }));
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, result: { type: 'flashcards', data: mappedCards, deckName } }
                        : m,
                    ),
                  );
                  break;
                }
                case 'result': {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, result: { type: parsed.type, data: parsed.data } }
                        : m,
                    ),
                  );
                  break;
                }
                case 'question':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, question: parsed }
                        : m,
                    ),
                  );
                  break;
                case 'complete':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, status: 'complete', content: m.content || parsed.message || '' }
                        : m,
                    ),
                  );
                  break;
                case 'usage':
                  setUsage({
                    current: parsed.current ?? 0,
                    limit: parsed.limit ?? 0,
                    plan: parsed.plan ?? '',
                    resetsAt: parsed.resetsAt ?? '',
                  });
                  break;
                case 'error':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, status: 'error', error: parsed.message || 'Request failed' }
                        : m,
                    ),
                  );
                  break;
              }
            } catch {
              // skip malformed events
            }

            currentEvent = '';
            currentData = '';
          }
        }
      }

      // If we exited the loop without a 'complete' event, mark as complete
      setMessages((prev) => {
        const found = prev.find((m) => m.id === assistantMsg.id);
        if (found && found.status === 'streaming') {
          return prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, status: 'complete' } : m,
          );
        }
        return prev;
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        setIsStreaming(false);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, status: 'error', error: error instanceof Error ? error.message : 'Network error' }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, [messages]);

  const sendLocalResponse = useCallback((userText: string, assistantText: string) => {
    const userMsg: ChatMessage = {
      id: generateUUID(),
      role: 'user',
      content: userText,
      status: 'complete',
      thinkingTraces: [],
    };
    const assistantMsg: ChatMessage = {
      id: generateUUID(),
      role: 'assistant',
      content: assistantText,
      status: 'complete',
      thinkingTraces: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setUsage(null);
    setIsStreaming(false);
    conversationIdRef.current = generateUUID();
    fileSentRef.current = false;
    toolStartTimesRef.current.clear();
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, usage, isStreaming, sendMessage, sendLocalResponse, clearChat, abort };
}
