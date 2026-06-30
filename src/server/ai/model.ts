import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const provider = process.env.LLM_PROVIDER || 'opencode';
const apiKey = process.env.LLM_API_KEY;
const modelName = process.env.LLM_MODEL_NAME || 'mimo-v2.5';
const baseURL = (process.env.LLM_BASE_URL || 'https://opencode.ai/zen/go/v1').replace(
  /\/chat\/completions\/?$/,
  '',
);

const rawEffort = process.env.LLM_REASONING_EFFORT || '';
export const reasoningEffort = ['low', 'medium', 'high'].includes(rawEffort)
  ? (rawEffort as 'low' | 'medium' | 'high')
  : undefined;

export const providerName = provider;
export const chatModel = createOpenAICompatible({ name: provider, baseURL, apiKey }).chatModel(
  modelName,
);
