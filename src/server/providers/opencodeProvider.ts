import { LLMProvider, GeneratedFlashcard, FLASHCARD_PROMPT, parseJsonResponse } from './LLMProvider';
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
}
