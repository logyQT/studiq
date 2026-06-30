import type { ModelsConfig } from '@/server/config/models.config';
import type { LLMProvider } from './LLMProvider';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';
import { OpenCodeProvider } from './opencodeProvider';

export function getProvider(config: ModelsConfig): LLMProvider {
  const providerName = config.provider || 'openai';

  switch (providerName) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'opencode':
      return new OpenCodeProvider(config);
    default:
      throw new Error(
        `Unsupported LLM provider: ${providerName}. Supported: openai, ollama, opencode`,
      );
  }
}
