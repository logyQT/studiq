import { log } from '@/lib/logger';
import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse, type StreamCallbacks, type GenerateChatResult } from './LLMProvider';
import type { ModelsConfig } from '@/server/config/models.config';
import type { ToolDefinition, ToolCall } from '@/server/ai/ai.types';

export class OpenCodeProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private modelName: string;

  constructor(config: ModelsConfig) {
    if (!config.apiKey) {
      throw new Error('LLM_API_KEY is required for OpenCode provider');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://opencode.ai/zen/go/v1/chat/completions';
    this.modelName = config.modelName || 'mimo-v2.5';
    log.providers.info(`Initialized: baseUrl=${this.baseUrl}, model=${this.modelName}`);
  }

  async generateFlashcardsFromChunk(chunk: string, language: string): Promise<GeneratedFlashcard[]> {
    const prompt = FLASHCARD_PROMPT
      .replace('{language}', language)
      .replace('{chunk}', chunk);
    const chunkPreview = chunk.slice(0, 100).replace(/\n/g, ' ');

    log.providers.info('Generating flashcards', { metadata: { language, chunkLength: chunk.length, preview: chunkPreview } });
    log.providers.info(`POST ${this.baseUrl} model=${this.modelName}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: 'You are a flashcard generator. Always respond with valid JSON.' },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        log.providers.error('Request failed', { metadata: { status: res.status, body: text } });
        throw new Error(`OpenCode request failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      log.providers.info('Raw response', { metadata: { length: content.length, preview: content.slice(0, 200) } });

      return parseJsonResponse(content);
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateChat(
    prompt: string,
    systemPrompt?: string,
    tools?: ToolDefinition[],
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } },
    maxTokens?: number,
  ): Promise<GenerateChatResult | string> {
    const messages: Array<Record<string, unknown>> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
    };

    if (maxTokens) body.max_tokens = maxTokens;

    if (tools && tools.length > 0) {
      body.tools = tools;
      if (toolChoice) body.tool_choice = toolChoice;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let data: Record<string, unknown>;
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`OpenCode request failed: ${res.status} ${text}`);
      }

      data = await res.json();
    } finally {
      clearTimeout(timeout);
    }
    const msg = (data as { choices?: Array<{ message: Record<string, unknown> }> }).choices?.[0]?.message as Record<string, unknown> | undefined;

    const reasoning = (msg?.reasoning as string | undefined) || undefined;

    const toolCallsRaw = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCallsRaw && toolCallsRaw.length > 0) {
      const toolCalls: ToolCall[] = toolCallsRaw.map((tc: Record<string, unknown>) => ({
        id: String(tc.id ?? ''),
        type: 'function' as const,
        function: {
          name: String((tc.function as Record<string, unknown>)?.name ?? ''),
          arguments: String((tc.function as Record<string, unknown>)?.arguments ?? ''),
        },
      }));
      return {
        content: (msg?.content as string) || '',
        reasoning,
        toolCalls,
      };
    }

    return (msg?.content as string) || '';
  }

  async generateChatStreaming(prompt: string, systemPrompt: string | undefined, callbacks: StreamCallbacks, tools?: ToolDefinition[], toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }, maxTokens?: number, reasoningEffort?: 'low' | 'medium' | 'high'): Promise<{ content: string; reasoning?: string; toolCalls?: ToolCall[] }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
      stream: true,
    };

    if (maxTokens) body.max_tokens = maxTokens;

    if (tools && tools.length > 0) {
      body.tools = tools;
      if (toolChoice) body.tool_choice = toolChoice;
    }

    if (reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`OpenCode request failed: ${res.status} ${text}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullReasoning = '';
      const streamedToolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              callbacks.onToken(delta.content);
            }
            if (delta?.reasoning) {
              fullReasoning += delta.reasoning;
              callbacks.onReasoning?.(delta.reasoning);
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  streamedToolCalls.push({
                    id: String(tc.id),
                    type: 'function',
                    function: {
                      name: String(tc.function?.name ?? ''),
                      arguments: String(tc.function?.arguments ?? ''),
                    },
                  });
                } else if (tc.function?.arguments && streamedToolCalls.length > 0) {
                  const last = streamedToolCalls[streamedToolCalls.length - 1];
                  last.function.arguments += tc.function.arguments;
                }
              }
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      return {
        content: fullContent,
        reasoning: fullReasoning || undefined,
        toolCalls: streamedToolCalls.length > 0 ? streamedToolCalls : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
