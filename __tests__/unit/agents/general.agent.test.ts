import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zod')>();
  return { ...actual, registry: { register: vi.fn() } };
});

import { GeneralAgent } from '@/server/agents/general.agent';
import type { Tool } from '@/server/agents/tools/types';

function mockTool(overrides: Partial<Tool>): Tool {
  return {
    name: 'mock',
    description: '',
    parameters: { toJSONSchema: () => ({}) } as any,
    execute: vi.fn(),
    ...overrides,
  };
}

function mockContext(overrides?: {
  stateOverrides?: Record<string, unknown>;
  callLLM?: ReturnType<typeof vi.fn>;
}) {
  return {
    trace: { log: vi.fn(), getByConversation: vi.fn(), getAll: vi.fn(), clear: vi.fn() },
    state: {
      text: 'test task',
      results: {},
      metadata: {},
      ...(overrides?.stateOverrides || {}),
    },
    callbacks: {
      onStep: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onThinking: vi.fn(),
      onComplete: vi.fn(),
      onQuestion: vi.fn(),
      onFlashcards: vi.fn(),
      onError: vi.fn(),
    },
    agentRegistry: {
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    },
    callLLM: (overrides?.callLLM || vi.fn().mockResolvedValue({ content: 'ok' })) as unknown as (
      req: unknown,
    ) => Promise<{ content: string; toolCalls?: Array<{ function: { name: string; arguments: string } }> }>,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GeneralAgent', () => {
  describe('class properties', () => {
    it('has name "general"', () => {
      const agent = new GeneralAgent();
      expect(agent.name).toBe('general');
    });

    it('has a non-empty system prompt', () => {
      const agent = new GeneralAgent();
      expect(agent.systemPrompt).toBeTruthy();
      expect(agent.systemPrompt.length).toBeGreaterThan(50);
    });

    it('has all 8 generic tools', () => {
      const agent = new GeneralAgent();
      const names = agent['tools'].map((t: Tool) => t.name).sort();
      expect(names).toEqual([
        'ask_user',
        'call_agents',
        'create_plan',
        'evaluate_quality',
        'extract_concepts',
        'fetch_material',
        'finish',
        'webfetch',
      ]);
    });

    it('has maxIterations set to 30', () => {
      const agent = new GeneralAgent();
      expect(agent['maxIterations']).toBe(30);
    });

    it('extends BaseAgent', () => {
      const agent = new GeneralAgent();
      expect(agent.execute).toBeInstanceOf(Function);
    });
  });

  describe('execution flow', () => {
    it('can execute a full pipeline: create_plan → fetch_material → finish', async () => {
      const agent = new GeneralAgent();
      agent.maxIterations = 5;

      const planExecute = vi.fn().mockResolvedValue({
        steps: [{ action: 'fetch material', rationale: 'need content' }],
        estimatedComplexity: 'simple',
        needsClarification: false,
      });

      const fetchExecute = vi.fn().mockResolvedValue({
        content: 'Educational content about topic X.',
        length: 35,
      });

      const finishExecute = vi.fn().mockResolvedValue({
        type: 'chat' as const,
        content: 'Done.',
      });

      agent['tools'] = [
        mockTool({ name: 'create_plan', description: 'Plan', execute: planExecute }),
        mockTool({ name: 'ask_user' }),
        mockTool({ name: 'fetch_material', description: 'Fetch', execute: fetchExecute }),
        mockTool({ name: 'extract_concepts' }),
        mockTool({ name: 'evaluate_quality' }),
        mockTool({ name: 'call_agents' }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'I will plan first.',
          toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'fetch material', rationale: 'need content' }], estimatedComplexity: 'simple', needsClarification: false }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Now fetching material.',
          toolCalls: [{ function: { name: 'fetch_material', arguments: JSON.stringify({ topic: 'topic X', depth: 'basic' }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Done.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({ message: 'Task complete' }) } }],
        });

      const ctx = mockContext({ callLLM });

      const result = await agent.execute('Create content about topic X', ctx);

      expect(planExecute).toHaveBeenCalled();
      expect(fetchExecute).toHaveBeenCalled();
      expect(finishExecute).toHaveBeenCalled();
      expect(result.type).toBe('chat');
    });

    it('can delegate to a sub-agent via call_agents', async () => {
      const agent = new GeneralAgent();
      agent.maxIterations = 5;

      const planExecute = vi.fn().mockResolvedValue({
        steps: [{ action: 'delegate to flashcard agent', rationale: 'need flashcards' }],
        estimatedComplexity: 'moderate',
        needsClarification: false,
      });

      const callAgentsExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'History Deck',
        flashcards: [{ front: 'Q', back: 'A' }],
      });

      const finishExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'History Deck',
        flashcards: [{ front: 'Q', back: 'A' }],
      });

      agent['tools'] = [
        mockTool({ name: 'create_plan', description: 'Plan', execute: planExecute }),
        mockTool({ name: 'ask_user' }),
        mockTool({ name: 'fetch_material' }),
        mockTool({ name: 'extract_concepts' }),
        mockTool({ name: 'evaluate_quality' }),
        mockTool({ name: 'call_agents', description: 'Call agents', execute: callAgentsExecute }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'I will plan first.',
          toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'delegate to flashcard agent', rationale: 'need flashcards' }], estimatedComplexity: 'moderate', needsClarification: false }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Delegating to flashcard agent.',
          toolCalls: [{ function: { name: 'call_agents', arguments: JSON.stringify({ agent: 'flashcard', task: 'Create 10 flashcards about history', count: 10 }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Done.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
        });

      const ctx = mockContext({ callLLM });

      const result = await agent.execute('Create 10 flashcards about history', ctx);

      expect(planExecute).toHaveBeenCalled();
      expect(callAgentsExecute).toHaveBeenCalled();
      expect(finishExecute).toHaveBeenCalled();
      expect(result.type).toBe('flashcards');
    });
  });

  describe('return type', () => {
    it('returns AgentResult with type flashcards on successful flashcard generation', async () => {
      const agent = new GeneralAgent();
      agent.maxIterations = 3;

      const planExecute = vi.fn().mockResolvedValue({
        steps: [{ action: 'call flashcard agent', rationale: 'make cards' }],
        estimatedComplexity: 'simple',
        needsClarification: false,
      });

      const callAgentsExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'Science',
        flashcards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }],
      });

      const finishExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'Science',
        flashcards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }],
      });

      agent['tools'] = [
        mockTool({ name: 'create_plan', description: 'Plan', execute: planExecute }),
        mockTool({ name: 'ask_user' }),
        mockTool({ name: 'fetch_material' }),
        mockTool({ name: 'extract_concepts' }),
        mockTool({ name: 'evaluate_quality' }),
        mockTool({ name: 'call_agents', description: 'Call agents', execute: callAgentsExecute }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'Planning...',
          toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'call flashcard agent', rationale: 'make cards' }], estimatedComplexity: 'simple', needsClarification: false }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Calling flashcard agent.',
          toolCalls: [{ function: { name: 'call_agents', arguments: JSON.stringify({ agent: 'flashcard', task: 'Create flashcards' }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Done.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
        });

      const ctx = mockContext({ callLLM });

      const result = await agent.execute('Create flashcards about science', ctx);

      expect(result.type).toBe('flashcards');
      if (result.type === 'flashcards') {
        expect(result.flashcards).toHaveLength(2);
        expect(result.deckName).toBe('Science');
      }
    });
  });
});
