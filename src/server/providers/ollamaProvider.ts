import { log } from '@/lib/logger';
import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse, type StreamCallbacks, type GenerateChatResult, type ProviderUsage } from './LLMProvider';
import type { ModelsConfig } from '@/server/config/models.config';
import type { ToolDefinition, ToolCall } from '@/server/ai/ai.types';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private modelName: string;

  constructor(config: ModelsConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.modelName = config.modelName || 'phi3:mini';
    log.providers.info(`Initialized: baseUrl=${this.baseUrl}, model=${this.modelName}`);
  }

  async generateFlashcardsFromChunk(
    chunk: string,
    language: string,
  ): Promise<GeneratedFlashcard[]> {
    const prompt = FLASHCARD_PROMPT.replace('{language}', language).replace('{chunk}', chunk);
    const chunkPreview = chunk.slice(0, 100).replace(/\n/g, ' ');

    log.providers.info('Generating flashcards', { metadata: { language, chunkLength: chunk.length, preview: chunkPreview } });

    const url = `${this.baseUrl}/api/generate`;
    log.providers.info(`POST ${url} model=${this.modelName}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        prompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      log.providers.error('Request failed', { metadata: { status: res.status, body } });
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText} — ${body}`);
    }

    const data = await res.json();
    const text = (data.response || '').trim();
    log.providers.info('Raw response', { metadata: { length: text.length, start: text.slice(0, 150), end: text.slice(-200) } });

    return parseJsonResponse(text);
  }

  async generateChat(
    prompt: string,
    systemPrompt?: string,
    _tools?: ToolDefinition[],
    _toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } },
    _maxTokens?: number,
  ): Promise<GenerateChatResult | string> {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        prompt: fullPrompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText} — ${body}`);
    }

    const data = await res.json();
    return (data.response || '').trim();
  }

  async generateChatStreaming(prompt: string, systemPrompt: string | undefined, callbacks: StreamCallbacks, _tools?: ToolDefinition[], _toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }, _maxTokens?: number, _reasoningEffort?: 'low' | 'medium' | 'high'): Promise<{ content: string; reasoning?: string; toolCalls?: ToolCall[]; usage?: ProviderUsage }> {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        prompt: fullPrompt,
        stream: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText} — ${body}`);
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
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const token = parsed.response || '';
          if (token) {
            fullContent += token;
            callbacks.onToken(token);
          }
          if (parsed.done) break;
        } catch {
          // skip malformed lines
        }
      }
    }

    return { content: fullContent };
  }
}
