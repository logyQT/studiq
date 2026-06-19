import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/zod', () => {
  const zod = require('zod');
  return { z: zod, registry: { register: vi.fn() } };
});

import { FlashcardAgent } from '@/server/agents/flashcard.agent';
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

describe('FlashcardAgent', () => {
  describe('class properties', () => {
    it('has name "flashcard"', () => {
      const agent = new FlashcardAgent();
      expect(agent.name).toBe('flashcard');
    });

    it('has a non-empty system prompt', () => {
      const agent = new FlashcardAgent();
      expect(agent.systemPrompt).toBeTruthy();
      expect(agent.systemPrompt.length).toBeGreaterThan(50);
    });

    it('has all 5 flashcard tools', () => {
      const agent = new FlashcardAgent();
      const names = agent['tools'].map((t: Tool) => t.name).sort();
      expect(names).toEqual([
        'brainstorm_concepts',
        'finish',
        'flashcard_create',
        'flashcard_review',
        'flashcard_revise',
      ]);
    });

    it('has maxIterations set to 10', () => {
      const agent = new FlashcardAgent();
      expect(agent['maxIterations']).toBe(10);
    });

    it('extends BaseAgent', () => {
      const agent = new FlashcardAgent();
      expect(agent.execute).toBeInstanceOf(Function);
    });
  });

  describe('execution flow', () => {
    it('calls flashcard_create when concepts are in context', async () => {
      const agent = new FlashcardAgent();
      agent.maxIterations = 5;

      const createExecute = vi.fn().mockResolvedValue({
        deckName: 'Test Deck',
        flashcards: [{ front: 'Q', back: 'A' }],
      });

      const finishExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'Test Deck',
        flashcards: [{ front: 'Q', back: 'A' }],
      });

      agent['tools'] = [
        mockTool({ name: 'brainstorm_concepts' }),
        mockTool({ name: 'flashcard_create', description: 'Create flashcards', execute: createExecute }),
        mockTool({ name: 'flashcard_review' }),
        mockTool({ name: 'flashcard_revise' }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'I have concepts, creating flashcards.',
          toolCalls: [{ function: { name: 'flashcard_create', arguments: JSON.stringify({ concepts: [{ term: 'X', definition: 'Y' }], deckName: 'Deck' }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Done.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
        });

      const ctx = mockContext({
        stateOverrides: {
          concepts: [{ term: 'X', definition: 'Y' }],
        },
        callLLM,
      });

      const result = await agent.execute('Create flashcards about X', ctx);

      expect(createExecute).toHaveBeenCalled();
      expect(result.type).toBe('flashcards');
    });

    it('calls brainstorm_concepts first when no concepts provided', async () => {
      const agent = new FlashcardAgent();
      agent.maxIterations = 5;

      const brainstormExecute = vi.fn().mockResolvedValue({ concepts: [{ term: 'X', definition: 'Y' }] });
      const createExecute = vi.fn().mockResolvedValue({ deckName: 'Deck', flashcards: [] });
      const finishExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'Deck',
        flashcards: [],
      });

      agent['tools'] = [
        mockTool({ name: 'brainstorm_concepts', description: 'Brainstorm', execute: brainstormExecute }),
        mockTool({ name: 'flashcard_create', description: 'Create', execute: createExecute }),
        mockTool({ name: 'flashcard_review' }),
        mockTool({ name: 'flashcard_revise' }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'No concepts provided, brainstorming first.',
          toolCalls: [{ function: { name: 'brainstorm_concepts', arguments: JSON.stringify({ topic: 'photosynthesis', count: 15 }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Now creating flashcards.',
          toolCalls: [{ function: { name: 'flashcard_create', arguments: JSON.stringify({ concepts: [{ term: 'X', definition: 'Y' }], deckName: 'Photosynthesis' }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Done.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
        });

      const ctx = mockContext({ callLLM });

      const result = await agent.execute('Create flashcards about photosynthesis', ctx);

      expect(brainstormExecute).toHaveBeenCalled();
      expect(createExecute).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('gracefully finishes with empty flashcards on failure', async () => {
      const agent = new FlashcardAgent();
      agent.maxIterations = 3;

      const finishExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: '',
        flashcards: [],
      });

      agent['tools'] = [
        mockTool({ name: 'brainstorm_concepts' }),
        mockTool({ name: 'flashcard_create' }),
        mockTool({ name: 'flashcard_review' }),
        mockTool({ name: 'flashcard_revise' }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'I cannot do this.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
        });

      const ctx = mockContext({ callLLM });

      const result = await agent.execute('Do something', ctx);

      expect(finishExecute).toHaveBeenCalled();
      expect(result.type).toBe('flashcards');
    });
  });

  describe('return type', () => {
    it('returns AgentResult with type flashcards on success', async () => {
      const agent = new FlashcardAgent();
      agent.maxIterations = 3;

      const finishExecute = vi.fn().mockResolvedValue({
        type: 'flashcards' as const,
        deckName: 'Quantum Physics',
        flashcards: [{ front: 'Q', back: 'A' }],
      });

      agent['tools'] = [
        mockTool({ name: 'brainstorm_concepts' }),
        mockTool({ name: 'flashcard_create' }),
        mockTool({ name: 'flashcard_review' }),
        mockTool({ name: 'flashcard_revise' }),
        mockTool({ name: 'finish', description: 'Finish', execute: finishExecute }),
      ];

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'Done.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
        });

      const ctx = mockContext({ callLLM });

      const result = await agent.execute('test', ctx);

      expect(result.type).toBe('flashcards');
      if (result.type === 'flashcards') {
        expect(result.deckName).toBe('Quantum Physics');
        expect(result.flashcards).toHaveLength(1);
      }
    });
  });
});
