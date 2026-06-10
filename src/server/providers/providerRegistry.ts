import type { LLMProvider } from './LLMProvider';
import { OpenAIProvider } from './openaiProvider';
import { OllamaProvider } from './ollamaProvider';
import type { ModelsConfig } from '@/server/config/models.config';

export function getProvider(config: ModelsConfig): LLMProvider {
  const providerName = config.provider || 'openai';

  switch (providerName) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unsupported LLM provider: ${providerName}. Supported: openai, ollama`);
  }
}
