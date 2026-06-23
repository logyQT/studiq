import type { ToolDefinition } from '@/server/ai/ai.types';
import type { Tool, ToolContext, AgentState, AgentResult } from '../tools/types';
import { zodToJsonSchema } from './schema-helper';

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly systemPrompt: string;

  protected tools: Tool[] = [];
  protected maxIterations: number = 25;

  async execute(task: string, ctx: ToolContext): Promise<AgentResult> {
    const state: AgentState = {
      text: ctx.state.text,
      file: ctx.state.file,
      conversationId: ctx.state.conversationId,
      material: ctx.state.material,
      concepts: ctx.state.concepts,
      results: ctx.state.results,
      metadata: ctx.state.metadata,
    };

    state.metadata['agent'] = this.name;

    const mergedCtx: ToolContext = { ...ctx, state };

    return this.runLoop(mergedCtx);
  }

  private buildSystemMessage(): string {
    const descriptions = this.tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    return [
      this.systemPrompt,
      '',
      'Available tools:',
      descriptions,
      '',
      'Think naturally. Use tools only when they help. When done, call "finish" to return results.',
    ].join('\n');
  }

  private buildToolDefinitions(): ToolDefinition[] {
    return this.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
  }

  private buildPrompt(task: string, history: string[]): string {
    const parts = [`Task: ${task}`];
    if (history.length > 0) {
      parts.push('');
      parts.push('Previous steps:');
      parts.push(...history);
    }
    parts.push('');
    parts.push('What should you do next? Respond with a tool call or with your thoughts.');
    return parts.join('\n');
  }

  private async runLoop(ctx: ToolContext): Promise<AgentResult> {
    const toolDefinitions = this.buildToolDefinitions();
    const history: string[] = [];
    const conversationId = ctx.state.conversationId || 'no-conversation';
    const consecutiveToolCalls: Map<string, number> = new Map();
    const recentToolNames: string[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const stepNumber = iteration + 1;

      ctx.trace.log({
        conversationId,
        agentName: this.name,
        iteration: stepNumber,
        eventType: 'step',
        label: iteration === 0 ? 'Starting ReAct iteration' : `ReAct iteration ${stepNumber}`,
        data: { description: 'Continuing ReAct loop' },
      });

      const prompt = this.buildPrompt(ctx.state.text, history);
      const systemMsg = this.buildSystemMessage();

      ctx.callbacks?.onThinking?.(iteration === 0 ? 'Analyzing request...' : `Step ${stepNumber}: thinking...`);

      const result = await ctx.callLLM({
        prompt,
        systemPrompt: systemMsg,
        tools: toolDefinitions,
        toolChoice: 'auto',
        maxTokens: (ctx.state.metadata?.maxTokens as number) || 8192,
        model: ctx.state.metadata?.model as string | undefined,
        provider: ctx.state.metadata?.provider as string | undefined,
        onReasoning: ctx.callbacks?.onThinking,
        onToken: (token) => ctx.callbacks?.onToken?.(token),
      });

      ctx.trace.log({
        conversationId,
        agentName: this.name,
        iteration: stepNumber,
        eventType: 'llm_response',
        label: `LLM returned: content=${result.content?.length ?? 0}chars, reasoning=${result.reasoning?.length ?? 0}chars, toolCalls=${result.toolCalls?.length ?? 0}`,
        data: {
          hasContent: !!result.content,
          hasReasoning: !!result.reasoning,
          toolCallCount: result.toolCalls?.length ?? 0,
          toolNames: result.toolCalls?.map((tc) => tc.function.name) ?? [],
        },
      });

      const thinkingText = result.reasoning;
      const hasToolCalls = result.toolCalls && result.toolCalls.length > 0;
      const looksLikeToolCallJson = !hasToolCalls && thinkingText && (
        thinkingText.trimStart().startsWith('{') ||
        thinkingText.trimStart().startsWith('```json') ||
        thinkingText.includes('"tool"') && thinkingText.includes('"input"')
      );
      if (thinkingText && !looksLikeToolCallJson) {
        ctx.callbacks?.onThought?.({ reasoning: thinkingText, step: stepNumber, agent: this.name });
      }

      const toolCalls = result.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        for (let tci = 0; tci < toolCalls.length; tci++) {
          const toolCall = toolCalls[tci];
          const toolCallId = `tc-${iteration}-${tci}`;
          const tool = this.tools.find((t) => t.name === toolCall.function.name);

          if (!tool) {
            ctx.trace.log({
              conversationId,
              agentName: this.name,
              iteration: stepNumber,
              eventType: 'error',
              label: `Unknown tool: ${toolCall.function.name}`,
              data: { toolName: toolCall.function.name },
            });
            history.push(`[Action]: ${toolCall.function.name} — unknown tool.`);
            continue;
          }

          let args: unknown;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            ctx.trace.log({
              conversationId,
              agentName: this.name,
              iteration: stepNumber,
              eventType: 'error',
              label: `Invalid arguments for ${toolCall.function.name}`,
              data: { toolName: toolCall.function.name, rawArgs: toolCall.function.arguments },
            });
            history.push(`[Action]: ${toolCall.function.name} — invalid arguments.`);
            continue;
          }

          ctx.callbacks?.onToolCall?.({ id: toolCallId, tool: tool.name, args });

          ctx.trace.log({
            conversationId,
            agentName: this.name,
            iteration: stepNumber,
            eventType: 'tool_call',
            label: `Tool: ${tool.name}`,
            data: { toolName: tool.name, args: args as Record<string, unknown> },
          });

          let toolResult: unknown;
          try {
            toolResult = await tool.execute(args, ctx);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            ctx.trace.log({
              conversationId,
              agentName: this.name,
              iteration: stepNumber,
              eventType: 'error',
              label: `Tool ${tool.name} threw: ${errorMsg}`,
              data: { toolName: tool.name, error: errorMsg },
            });
            toolResult = { error: errorMsg };
          }

          ctx.callbacks?.onToolResult?.({ id: toolCallId, tool: tool.name, result: toolResult });

          ctx.trace.log({
            conversationId,
            agentName: this.name,
            iteration: stepNumber,
            eventType: 'tool_result',
            label: `Result from: ${tool.name}`,
            data: { toolName: tool.name, result: toolResult as Record<string, unknown> },
          });

          recentToolNames.push(tool.name);

          const lastCount = consecutiveToolCalls.get(tool.name) || 0;
          consecutiveToolCalls.set(tool.name, lastCount + 1);

          if (tool.name === 'ask_user') {
            const r = toolResult as { question?: { id: string; question: string; options?: Array<{ label: string; value: string }> } };
            if (r.question) {
              return { type: 'question', questions: [r.question] };
            }
            continue;
          }

          if (tool.name === 'finish') {
            return toolResult as AgentResult;
          }

          if (consecutiveToolCalls.get(tool.name)! >= 3) {
            ctx.trace.log({
              conversationId,
              agentName: this.name,
              iteration: stepNumber,
              eventType: 'error',
              label: `Loop detected: ${tool.name} called ${consecutiveToolCalls.get(tool.name)} times consecutively`,
              data: { toolName: tool.name, count: consecutiveToolCalls.get(tool.name) },
            });
            const flashcards = ctx.state.results?.['flashcards'];
            if (flashcards && Array.isArray(flashcards) && flashcards.length > 0) {
              return {
                type: 'flashcards',
                deckName: (ctx.state.results?.['deckName'] as string) || 'Generated Flashcards',
                flashcards,
              };
            }
            return { type: 'chat', content: 'I got stuck in a loop. Please try again.' };
          }

          if (result.content) {
            history.push(`[Thought]: ${result.content}`);
          }
          history.push(`[Action]: ${toolCall.function.name}(${toolCall.function.arguments})`);
          history.push(`[Result]: ${JSON.stringify(toolResult)}`);
        }
      } else {
        const directContent = result.content?.trim();
        if (directContent) {
          return { type: 'chat', content: directContent };
        }

        if (result.reasoning) {
          history.push(`[Thought]: ${result.reasoning}`);
        }

        if (recentToolNames.length >= 2) {
          const last2 = recentToolNames.slice(-2);
          if (last2[0] === last2[1]) {
            ctx.trace.log({
              conversationId,
              agentName: this.name,
              iteration: stepNumber,
              eventType: 'error',
              label: `No tool calls returned, agent appears stuck (last tool: ${last2[0]})`,
              data: { recentTools: recentToolNames },
            });
            const flashcards = ctx.state.results?.['flashcards'];
            if (flashcards && Array.isArray(flashcards) && flashcards.length > 0) {
              return {
                type: 'flashcards',
                deckName: (ctx.state.results?.['deckName'] as string) || 'Generated Flashcards',
                flashcards,
              };
            }
            return { type: 'chat', content: 'I got stuck in a loop. Please try again.' };
          }
        }
      }
    }

    const flashcards = ctx.state.results?.['flashcards'];
    if (flashcards && Array.isArray(flashcards) && flashcards.length > 0) {
      return {
        type: 'flashcards',
        deckName: (ctx.state.results?.['deckName'] as string) || 'Generated Flashcards',
        flashcards,
      };
    }

    return { type: 'chat', content: 'I reached the maximum number of iterations. Please try again with a simpler request.' };
  }
}
