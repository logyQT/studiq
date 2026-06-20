import { agentService } from '@/server/services/agent.service';
import type { RequestContext } from '@/lib/request-context';
import type { AgentCallbacks, AgentQuestion, AgentResult } from '@/server/agents/tools/types';

export interface AgentStreamCallbacks {
  onThought: (data: { reasoning: string; step: number; agent: string }) => void;
  onThinking: (text: string) => void;
  onToken: (token: string) => void;
  onToolCall: (data: { id: string; tool: string; label: string; args: unknown }) => void;
  onToolResult: (data: { id: string; tool: string; label: string; result: unknown }) => void;
  onFlashcards: (data: { deckName: string; flashcards: unknown[] }) => void;
  onQuestion: (data: AgentQuestion) => void;
  onComplete: (summary: string) => void;
  onError: (message: string) => void;
}

function generateToolCallLabel(tool: string, args: unknown): string {
  const a = args as Record<string, unknown>;
  switch (tool) {
    case 'create_plan': return '📋 Creating execution plan...';
    case 'ask_user': return '❓ Asking you a question...';
    case 'fetch_material':
      return `📝 Generating material${a.topic ? ` on "${a.topic as string}"` : ''}...`;
    case 'webfetch':
      return `🌐 Fetching content from ${(a.url as string)?.slice(0, 80)}...`;
    case 'extract_concepts': return '🔍 Extracting key concepts...';
    case 'evaluate_quality': return '✅ Evaluating quality...';
    case 'call_agent':
      return `🤖 Asking ${a.agent as string} agent...`;
    case 'finish': return '🏁 Finishing up...';
    case 'flashcard_create': return '📇 Creating flashcards...';
    case 'flashcard_review': return '🔎 Reviewing flashcards...';
    case 'flashcard_revise': return '✏️ Revising flashcards...';
    case 'brainstorm_concepts': return '💡 Brainstorming concepts...';
    default: return `🛠️ Using ${tool}...`;
  }
}

function generateToolResultLabel(tool: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  switch (tool) {
    case 'create_plan': {
      const steps = r.steps as Array<unknown> | undefined;
      return `📋 Created plan with ${steps?.length ?? 0} steps`;
    }
    case 'ask_user': return '❓ Question sent';
    case 'fetch_material':
      return `📝 Generated ${(r.length as number) ?? 0} characters of material`;
    case 'webfetch':
      return `🌐 Fetched ${(r.length as number) ?? 0} chars from ${(r.url as string)?.slice(0, 80) ?? 'url'}`;
    case 'extract_concepts': {
      const terms = r.terms as Array<unknown> | undefined;
      return `🔍 Found ${terms?.length ?? 0} key concepts`;
    }
    case 'evaluate_quality': return r.passed ? '✅ Quality check passed' : '❌ Quality check failed';
    case 'call_agent': return '🤖 Sub-agent completed';
    case 'finish': return '🏁 Task complete';
    case 'flashcard_create': {
      const cards = r.flashcards as Array<unknown> | undefined;
      return `📇 Created ${cards?.length ?? 0} flashcards`;
    }
    case 'flashcard_review': {
      const kept = r.kept as Array<unknown> | undefined;
      const dropped = r.dropped as Array<unknown> | undefined;
      return `🔎 Kept ${kept?.length ?? 0}/${(kept?.length ?? 0) + (dropped?.length ?? 0)} cards after review`;
    }
    case 'flashcard_revise': {
      const revised = r.revised as Array<unknown> | undefined;
      return `✏️ Revised ${revised?.length ?? 0} cards`;
    }
    case 'brainstorm_concepts': {
      const concepts = r.concepts as Array<unknown> | undefined;
      return `💡 Brainstormed ${concepts?.length ?? 0} concepts`;
    }
    default: return `🛠️ ${tool} completed`;
  }
}

export class AiAgentController {
  async process(
    text: string,
    file: { data: string; mimeType: string } | undefined,
    conversationId: string | undefined,
    ctx: RequestContext,
    callbacks: AgentStreamCallbacks,
  ): Promise<void> {
    try {
      const agentCallbacks: AgentCallbacks = {
        onThought: (data) => callbacks.onThought(data),
        onThinking: (text) => callbacks.onThinking(text),
        onToken: (token) => callbacks.onToken?.(token),
        onToolCall: (data) => callbacks.onToolCall({
          ...data,
          label: generateToolCallLabel(data.tool, data.args),
        }),
        onToolResult: (data) => callbacks.onToolResult({
          ...data,
          label: generateToolResultLabel(data.tool, data.result),
        }),
        onFlashcards: (data) => callbacks.onFlashcards(data),
        onQuestion: (q) => callbacks.onQuestion(q),
        onError: (err) => callbacks.onError(err),
      };

      const result: AgentResult = await agentService.process(
        { text, file, conversationId },
        ctx,
        agentCallbacks,
      );

      switch (result.type) {
        case 'chat':
          callbacks.onComplete(result.content);
          break;
        case 'flashcards':
          callbacks.onComplete('');
          break;
        case 'question':
          for (const q of result.questions) {
            callbacks.onQuestion(q);
          }
          callbacks.onComplete('');
          break;
        case 'error':
          callbacks.onError(result.error);
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error';
      callbacks.onError(msg);
    }
  }
}

export const aiAgentController = new AiAgentController();
