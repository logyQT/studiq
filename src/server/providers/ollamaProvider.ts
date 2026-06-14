import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse, type StreamCallbacks } from './LLMProvider';
import type { ModelsConfig } from '@/server/config/models.config';

const LOG_PREFIX = '[OllamaProvider]';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private modelName: string;

  constructor(config: ModelsConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.modelName = config.modelName || 'phi3:mini';
    console.log(`${LOG_PREFIX} Initialized: baseUrl=${this.baseUrl}, model=${this.modelName}`);
  }

  async generateFlashcardsFromChunk(
    chunk: string,
    language: string,
  ): Promise<GeneratedFlashcard[]> {
    const prompt = FLASHCARD_PROMPT.replace('{language}', language).replace('{chunk}', chunk);
    const chunkPreview = chunk.slice(0, 100).replace(/\n/g, ' ');

    console.log(`${LOG_PREFIX} Generating flashcards: language=${language}, chunkLength=${chunk.length}, preview="${chunkPreview}..."`);

    const url = `${this.baseUrl}/api/generate`;
    console.log(`${LOG_PREFIX} POST ${url} model=${this.modelName}`);

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
      console.error(`${LOG_PREFIX} Request failed: status=${res.status}, body=${body}`);
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText} — ${body}`);
    }

    const data = await res.json();
    const text = (data.response || '').trim();
    console.log(`${LOG_PREFIX} Raw response length=${text.length}, start="${text.slice(0, 150)}...", end="...${text.slice(-200)}"`);

    return parseJsonResponse(text);
  }

  async generateChat(prompt: string, systemPrompt?: string): Promise<string> {
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

  async generateChatStreaming(prompt: string, systemPrompt: string | undefined, callbacks: StreamCallbacks): Promise<string> {
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

    return fullContent;
  }
}


