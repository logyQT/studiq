import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse, type StreamCallbacks } from './LLMProvider';
import type { ModelsConfig } from '@/server/config/models.config';

const LOG_PREFIX = '[OpenCodeProvider]';

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
    console.log(`${LOG_PREFIX} Initialized: baseUrl=${this.baseUrl}, model=${this.modelName}`);
  }

  async generateFlashcardsFromChunk(chunk: string, language: string): Promise<GeneratedFlashcard[]> {
    const prompt = FLASHCARD_PROMPT
      .replace('{language}', language)
      .replace('{chunk}', chunk);
    const chunkPreview = chunk.slice(0, 100).replace(/\n/g, ' ');

    console.log(`${LOG_PREFIX} Generating flashcards: language=${language}, chunkLength=${chunk.length}, preview="${chunkPreview}..."`);
    console.log(`${LOG_PREFIX} POST ${this.baseUrl} model=${this.modelName}`);

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
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      console.error(`${LOG_PREFIX} Request failed: status=${res.status}, body=${text}`);
      throw new Error(`OpenCode request failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`${LOG_PREFIX} Raw response length=${content.length}, preview="${content.slice(0, 200)}..."`);

    return parseJsonResponse(content);
  }

  async generateChat(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`OpenCode request failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateChatStreaming(prompt: string, systemPrompt: string | undefined, callbacks: StreamCallbacks): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(this.baseUrl, {
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
      throw new Error(`OpenCode request failed: ${res.status} ${text}`);
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

    return fullContent;
  }
}
