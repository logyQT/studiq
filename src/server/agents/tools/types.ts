import type { z } from '@/lib/zod';
import type { AgentLLMConfig } from '@/server/ai/ai.types';
import type { AgentTraceService } from '@/server/services/agent-trace.service';
import type { ExtractedTerm, FlashcardItem } from '@/server/services/ai-utils';

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  trace: AgentTraceService;
  state: AgentState;
  callbacks: AgentCallbacks;
  agentRegistry: {
    get(name: string): unknown;
    getAll(): string[];
  };
  callLLM: (
    req: {
      prompt: string;
      systemPrompt?: string;
      tools?: unknown[];
      toolChoice?: unknown;
      maxTokens?: number;
      onToken?: (token: string) => void;
      onReasoning?: (token: string) => void;
    } & AgentLLMConfig,
  ) => Promise<{
    content: string;
    reasoning?: string;
    toolCalls?: Array<{ function: { name: string; arguments: string } }>;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
}

export interface AgentState {
  text: string;
  file?: { data: string; mimeType: string };
  conversationId?: string;
  material?: string;
  concepts?: ExtractedTerm[];
  results: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface PlanStep {
  index: number;
  action: string;
  rationale: string;
  dependsOn?: string[];
}

export interface AgentCallbacks {
  onThinking?: (text: string) => void;
  onQuestion?: (question: AgentQuestion) => void;
  onThought?: (data: { reasoning: string; step: number; agent: string }) => void;
  onToken?: (token: string) => void;
  onToolCall?: (data: { id: string; tool: string; args: unknown }) => void;
  onToolResult?: (data: { id: string; tool: string; result: unknown }) => void;
  onFlashcards?: (data: { deckName: string; flashcards: FlashcardItem[] }) => void;
  onPlan?: (steps: PlanStep[]) => void;
  onComplete?: (message: string) => void;
  onError?: (error: string) => void;
}

export interface AgentQuestion {
  id: string;
  question: string;
  options?: { label: string; value: string }[];
}

export type AgentResult =
  | { type: 'flashcards'; deckName: string; flashcards: FlashcardItem[] }
  | { type: 'chat'; content: string }
  | { type: 'question'; questions: AgentQuestion[] }
  | { type: 'error'; error: string };
