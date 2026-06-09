import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse } from './LLMProvider';
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
}


