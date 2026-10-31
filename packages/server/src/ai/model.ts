import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { conversationStorage } from '../lib/conversation-context';

const provider = process.env.LLM_PROVIDER || 'opencode-go';
const apiKey = process.env.LLM_API_KEY;
const modelName = process.env.LLM_MODEL_NAME || 'mimo-v2.6-flash';
const baseURL = (process.env.LLM_BASE_URL || 'https://opencode.ai/inference/go/openai/v1').replace(
  /\/chat\/completions\/?$/,
  '',
);

const rawEffort = process.env.LLM_REASONING_EFFORT || '';
export const reasoningEffort = ['low', 'medium', 'high'].includes(rawEffort)
  ? (rawEffort as 'low' | 'medium' | 'high')
  : undefined;

export const providerName = provider;

/**
 * Fallback routing id for inference calls made outside a chat request (a one-off
 * `generateText`, a test): OpenCode Go keys routing and prompt caching on a
 * stable `x-opencode-session`, so a process-scoped id is enough there.
 */
const processSessionId = `studiq-${crypto.randomUUID()}`;

/**
 * OpenCode Go rejects calls without `x-opencode-session` (`400 MissingSessionID`)
 * and asks clients to identify themselves instead of looking like a bare SDK.
 * The session id is the chat conversation when we have one (it is set in
 * AsyncLocalStorage by the chat route), so cache hits follow the conversation
 * rather than being shared across every user of the process.
 */
const sessionFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    headers.set(
      'x-opencode-session',
      conversationStorage.getStore()?.conversationId ?? processSessionId,
    );
    headers.set('user-agent', 'studiq/0.1');
    return fetch(input, { ...init, headers });
  },
  { preconnect: fetch.preconnect },
);

export const chatModel = createOpenAICompatible({
  name: provider,
  baseURL,
  apiKey,
  fetch: sessionFetch,
}).chatModel(modelName);
