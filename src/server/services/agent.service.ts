import { agentRegistry } from '@/server/agents/agent-registry';
import { callLLM as llmCallLLM } from '@/server/ai/llm-gateway';
import { agentTraceService } from '@/server/services/agent-trace.service';
import type { RequestContext } from '@/lib/request-context';
import type { AgentCallbacks, AgentResult, AgentState, ToolContext } from '@/server/agents/tools/types';
import type { LLMGatewayRequest } from '@/server/ai/ai.types';

export class AgentService {
  private conversationStates: Map<string, AgentState> = new Map();
  private readonly MAX_CACHED = 100;

  async process(
    body: { text: string; file?: { data: string; mimeType: string }; conversationId?: string },
    ctx: RequestContext,
    callbacks: AgentCallbacks,
  ): Promise<AgentResult> {
    const agent = agentRegistry.get('general');
    if (!agent) {
      return { type: 'error', error: 'General agent not found.' };
    }

    const modelConfig = agentRegistry.getModelConfig('general');
    const conversationId = body.conversationId || 'no-conversation';

    const existingState = conversationId !== 'no-conversation'
      ? this.conversationStates.get(conversationId)
      : undefined;

    let stateText: string;
    let stateFile: { data: string; mimeType: string } | undefined;

    if (existingState) {
      stateText = existingState.text + `\n\n[User responded: ${body.text}]`;
      stateFile = body.file || existingState.file;
    } else {
      stateText = body.text;
      stateFile = body.file;
    }

    const toolCtx: ToolContext = {
      trace: agentTraceService,
      state: existingState
        ? {
            ...existingState,
            text: stateText,
            file: stateFile,
            results: { ...existingState.results },
            metadata: { ...existingState.metadata, ...modelConfig },
          }
        : {
            text: body.text,
            file: body.file,
            conversationId,
            results: {},
            metadata: { ...modelConfig },
          },
      callbacks,
      agentRegistry: {
        get: (name: string) => agentRegistry.get(name),
        getAll: () => agentRegistry.getAll(),
      },
      callLLM: async (req) => {
        const promptPreview = req.prompt.slice(0, 500);
        const toolNames = ((req.tools as LLMGatewayRequest['tools']) || []).map((t) => t.function.name);

        await agentTraceService.log({
          conversationId,
          agentName: 'general',
          eventType: 'llm_request',
          label: `LLM call: ${toolNames.join(', ') || 'text'}`,
          data: { prompt: promptPreview, systemPrompt: req.systemPrompt?.slice(0, 200), tools: toolNames },
        });

        const resp = await llmCallLLM({
          prompt: req.prompt,
          systemPrompt: req.systemPrompt,
          tools: req.tools as LLMGatewayRequest['tools'],
          toolChoice: req.toolChoice as LLMGatewayRequest['toolChoice'],
          maxTokens: req.maxTokens,
          onReasoningToken: req.onReasoning,
          ...modelConfig,
          onRetry: async (attempt, maxRetries, delayMs) => {
            const msg = `LLM temporarily unavailable, retrying in ${delayMs / 1000}s (${attempt}/${maxRetries})...`;
            callbacks.onThinking?.(msg);
            await agentTraceService.log({
              conversationId,
              agentName: 'general',
              eventType: 'retry',
              label: msg,
              data: { attempt, maxRetries, delayMs },
            });
          },
        }, ctx);

        const toolCallsInfo = resp.toolCalls?.map((tc) => ({ name: tc.function.name, args: tc.function.arguments }));

        await agentTraceService.log({
          conversationId,
          agentName: 'general',
          eventType: 'llm_response',
          label: `LLM response: ${resp.content.slice(0, 80)}${toolCallsInfo ? ` + ${toolCallsInfo.length} tool call(s)` : ''}`,
          data: { content: resp.content.slice(0, 1000), toolCalls: toolCallsInfo },
        });

        return { content: resp.content, reasoning: resp.reasoning, toolCalls: resp.toolCalls };
      },
    };

    const result = await agent.execute(body.text, toolCtx);

    if (conversationId !== 'no-conversation') {
      this.conversationStates.set(conversationId, { ...toolCtx.state });
      if (this.conversationStates.size > this.MAX_CACHED) {
        const firstKey = this.conversationStates.keys().next().value;
        if (firstKey) this.conversationStates.delete(firstKey);
      }
    }

    return result;
  }
}

export const agentService = new AgentService();
