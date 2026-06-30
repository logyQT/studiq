import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { getModelsConfig } from '@/server/config/models.config';
import type { LLMProvider, ProviderUsage } from '@/server/providers/LLMProvider';
import { getProvider } from '@/server/providers/providerRegistry';
import type {
  GatewayStreamCallbacks,
  LLMGatewayRequest,
  LLMGatewayResponse,
  TokenUsage,
} from './ai.types';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const DEFAULT_PROVIDER = 'opencode';
const DEFAULT_MODEL = 'mimo-v2.5';

const MAX_5XX_RETRIES = parseInt(process.env.LLM_RETRY_MAX || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.LLM_RETRY_DELAY_MS || '5000', 10);

function is5xxError(msg: string): boolean {
  return /\b5\d{2}\b/.test(msg);
}

function resolveProviderConfig(req: LLMGatewayRequest) {
  const envConfig = getModelsConfig();

  const providerName = req.provider || envConfig.provider || DEFAULT_PROVIDER;
  const model = req.model || envConfig.modelName || DEFAULT_MODEL;
  const apiKey = req.apiKey || envConfig.apiKey || '';
  const baseUrl = req.baseUrl || envConfig.baseUrl || '';

  return {
    provider: providerName,
    apiKey,
    baseUrl,
    modelName: model,
  };
}

async function generateStreamingWithRetry(
  provider: LLMProvider,
  req: LLMGatewayRequest,
): Promise<{
  content: string;
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage?: ProviderUsage;
}> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_5XX_RETRIES; attempt++) {
    try {
      const result = await provider.generateChatStreaming(
        req.prompt,
        req.systemPrompt,
        {
          onToken: (token) => req.onToken?.(token),
          onReasoning: req.onReasoningToken
            ? (token: string) => req.onReasoningToken!(token)
            : () => {},
        },
        req.tools,
        req.toolChoice,
        req.maxTokens,
        req.reasoningEffort,
      );
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = lastError.message;

      const isRetryable =
        is5xxError(msg) ||
        msg.includes('400') ||
        msg.includes('422') ||
        msg.includes('invalid_type') ||
        msg.includes('validation');

      if (isRetryable && attempt < MAX_5XX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * (attempt + 1);
        req.onRetry?.(attempt + 1, MAX_5XX_RETRIES, delayMs);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) {
        throw new AppError('UNAUTHORIZED');
      }
      if (msg.includes('429') || msg.includes('rate limit')) {
        throw new AppError('RATE_LIMITED');
      }
      if (
        msg.includes('fetch') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('Failed to initialize')
      ) {
        throw new AppError('SERVICE_UNAVAILABLE');
      }
      throw lastError;
    }
  }

  throw lastError || new AppError('SERVICE_UNAVAILABLE');
}

export async function callLLM(
  req: LLMGatewayRequest,
  _ctx: RequestContext,
): Promise<LLMGatewayResponse> {
  const providerConfig = resolveProviderConfig(req);
  const { modelName: model, provider: providerName } = providerConfig;

  let provider;
  try {
    provider = getProvider(providerConfig);
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE');
  }

  const result = await generateStreamingWithRetry(provider, req);

  const usage: TokenUsage = result.usage
    ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
        provider: providerName,
        model,
      }
    : {
        inputTokens: estimateTokens((req.systemPrompt || '') + req.prompt),
        outputTokens: estimateTokens(result.content),
        totalTokens: estimateTokens((req.systemPrompt || '') + req.prompt + result.content),
        provider: providerName,
        model,
      };

  log.ai.info('Streaming result', {
    metadata: {
      contentLength: result.content?.length ?? 0,
      reasoningLength: result.reasoning?.length ?? 0,
      toolCallCount: result.toolCalls?.length ?? 0,
      toolNames: result.toolCalls?.map((tc) => tc.function.name).join(', ') ?? '',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
  });

  return {
    content: result.content,
    reasoning: result.reasoning,
    toolCalls: result.toolCalls,
    usage,
  };
}

export async function callLLMStreaming(
  req: LLMGatewayRequest,
  _ctx: RequestContext,
  callbacks: GatewayStreamCallbacks,
): Promise<LLMGatewayResponse> {
  const providerConfig = resolveProviderConfig(req);
  const { modelName: model, provider: providerName } = providerConfig;

  let provider;
  try {
    provider = getProvider(providerConfig);
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE');
  }

  try {
    const result = await provider.generateChatStreaming(
      req.prompt,
      req.systemPrompt,
      callbacks,
      req.tools,
      req.toolChoice,
      req.maxTokens,
      req.reasoningEffort,
    );

    const usage: TokenUsage = result.usage
      ? {
          inputTokens: result.usage.prompt_tokens,
          outputTokens: result.usage.completion_tokens,
          totalTokens: result.usage.total_tokens,
          provider: providerName,
          model,
        }
      : {
          inputTokens: estimateTokens((req.systemPrompt || '') + req.prompt),
          outputTokens: estimateTokens(result.content),
          totalTokens: estimateTokens((req.systemPrompt || '') + req.prompt + result.content),
          provider: providerName,
          model,
        };

    return {
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      usage,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) {
      throw new AppError('UNAUTHORIZED');
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      throw new AppError('RATE_LIMITED');
    }
    if (
      msg.includes('fetch') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('Failed to initialize')
    ) {
      throw new AppError('SERVICE_UNAVAILABLE');
    }
    throw error;
  }
}
