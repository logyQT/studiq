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

/** A plain header token: no control characters, no non-Latin-1, bounded length. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * `Headers.set` throws on control characters and non-ByteString values, so the
 * conversation id cannot be trusted in a header: the chat route seeds it from
 * `messages[0].id`, which the client controls. Anything that is not a plain
 * token becomes a stable FNV-1a digest — still one id per conversation, but a
 * newline (or a non-ASCII id) can no longer fail the request.
 */
function toSessionId(raw: string | undefined): string {
  if (!raw) return processSessionId;
  if (SESSION_ID_PATTERN.test(raw)) return raw;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `studiq-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

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
    headers.set('x-opencode-session', toSessionId(conversationStorage.getStore()?.conversationId));
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
