import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse, type StreamCallbacks, type GenerateChatResult } from './LLMProvider';
import type { ModelsConfig } from '@/server/config/models.config';
import type { ToolDefinition, ToolCall } from '@/server/ai/ai.types';

const LOG_PREFIX = '[OpenAIProvider]';

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private modelName: string;

  constructor(config: ModelsConfig) {
    if (!config.apiKey) {
      throw new Error('LLM_API_KEY is required for OpenAI provider');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.modelName = config.modelName || 'gpt-4o-mini';
    console.log(`${LOG_PREFIX} Initialized: baseUrl=${this.baseUrl}, model=${this.modelName}`);
  }

  async generateFlashcardsFromChunk(chunk: string, language: string): Promise<GeneratedFlashcard[]> {
    const prompt = FLASHCARD_PROMPT
      .replace('{language}', language)
      .replace('{chunk}', chunk);
    const chunkPreview = chunk.slice(0, 100).replace(/\n/g, ' ');

    console.log(`${LOG_PREFIX} Generating flashcards: language=${language}, chunkLength=${chunk.length}, preview="${chunkPreview}..."`);

    const url = `${this.baseUrl}/v1/chat/completions`;
    console.log(`${LOG_PREFIX} POST ${url} model=${this.modelName}`);

    const res = await fetch(url, {
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
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      console.error(`${LOG_PREFIX} Request failed: status=${res.status}, body=${text}`);
      throw new Error(`OpenAI request failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`${LOG_PREFIX} Raw response length=${content.length}, preview="${content.slice(0, 200)}..."`);

    return parseJsonResponse(content);
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

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`OpenAI request failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;

    if (message?.tool_calls?.length > 0) {
      const toolCalls: ToolCall[] = message.tool_calls.map((tc: Record<string, unknown>) => ({
        id: String(tc.id ?? ''),
        type: 'function' as const,
        function: {
          name: String((tc.function as Record<string, unknown>)?.name ?? ''),
          arguments: String((tc.function as Record<string, unknown>)?.arguments ?? ''),
        },
      }));
      return {
        content: message.content || '',
        toolCalls,
      };
    }

    return message?.content || '';
  }

  async generateChatStreaming(prompt: string, systemPrompt: string | undefined, callbacks: StreamCallbacks): Promise<{ content: string; reasoning?: string; toolCalls?: ToolCall[] }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`OpenAI request failed: ${res.status} ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

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
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            callbacks.onToken(delta);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    return { content: fullContent };
  }
}
