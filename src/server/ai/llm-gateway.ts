import { getProvider } from '@/server/providers/providerRegistry';
import { getModelsConfig } from '@/server/config/models.config';
import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import type { LLMGatewayRequest, LLMGatewayResponse, GatewayStreamCallbacks } from './ai.types';
import type { GenerateChatResult } from '@/server/providers/LLMProvider';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function callLLM(req: LLMGatewayRequest, _ctx: RequestContext): Promise<LLMGatewayResponse> {
  const config = getModelsConfig();
  const providerName = req.provider || config.provider || 'openai';
  const model = req.model || config.modelName || 'gpt-4o-mini';

  const providerConfig = { ...config, provider: providerName, modelName: model };
  let provider;
  try {
    provider = getProvider(providerConfig);
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE');
  }

  try {
    const result = await provider.generateChat(req.prompt, req.systemPrompt, req.tools, req.toolChoice);

    if (typeof result === 'string') {
      return {
        content: result,
        usage: {
          inputTokens: estimateTokens((req.systemPrompt || '') + req.prompt),
          outputTokens: estimateTokens(result),
          totalTokens: estimateTokens((req.systemPrompt || '') + req.prompt + result),
          provider: providerName,
          model,
        },
      };
    }

    const chatResult = result as GenerateChatResult;
    return {
      content: chatResult.content,
      toolCalls: chatResult.toolCalls,
      usage: {
        inputTokens: estimateTokens((req.systemPrompt || '') + req.prompt),
        outputTokens: estimateTokens(chatResult.content),
        totalTokens: estimateTokens((req.systemPrompt || '') + req.prompt + chatResult.content),
        provider: providerName,
        model,
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) {
      throw new AppError('UNAUTHORIZED');
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      throw new AppError('RATE_LIMITED');
    }
    if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('Failed to initialize')) {
      throw new AppError('SERVICE_UNAVAILABLE');
    }
    throw error;
  }
}

export async function callLLMStreaming(
  req: LLMGatewayRequest,
  _ctx: RequestContext,
  callbacks: GatewayStreamCallbacks,
): Promise<LLMGatewayResponse> {
  const config = getModelsConfig();
  const providerName = req.provider || config.provider || 'openai';
  const model = req.model || config.modelName || 'gpt-4o-mini';

  const providerConfig = { ...config, provider: providerName, modelName: model };
  let provider;
  try {
    provider = getProvider(providerConfig);
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE');
  }

  try {
    const result = await provider.generateChatStreaming(req.prompt, req.systemPrompt, callbacks);

    return {
      content: result,
      usage: {
        inputTokens: estimateTokens((req.systemPrompt || '') + req.prompt),
        outputTokens: estimateTokens(result),
        totalTokens: estimateTokens((req.systemPrompt || '') + req.prompt + result),
        provider: providerName,
        model,
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) {
      throw new AppError('UNAUTHORIZED');
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      throw new AppError('RATE_LIMITED');
    }
    if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('Failed to initialize')) {
      throw new AppError('SERVICE_UNAVAILABLE');
    }
    throw error;
  }
}
