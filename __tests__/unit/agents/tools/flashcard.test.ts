import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zod')>();
  return { ...actual, registry: { register: vi.fn() } };
});

import { brainstormConceptsTool } from '@/server/agents/tools/flashcard/brainstorm-concepts.tool';
import { flashcardCreateTool } from '@/server/agents/tools/flashcard/flashcard-create.tool';
import { flashcardReviewTool } from '@/server/agents/tools/flashcard/flashcard-review.tool';
import { flashcardReviseTool } from '@/server/agents/tools/flashcard/flashcard-revise.tool';

function mockCtx(overrides?: Record<string, unknown>) {
  return {
    trace: { log: vi.fn(), getByConversation: vi.fn(), getAll: vi.fn(), clear: vi.fn() },
    state: {
      text: 'test task',
      file: undefined,
      conversationId: undefined,
      material: 'test material content',
      concepts: [{ term: 'T1', definition: 'D1' }],
      results: {},
      metadata: {},
      ...(overrides as Record<string, unknown>),
    },
    callbacks: {
      onThinking: vi.fn(),
      onQuestion: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onFlashcards: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      onStep: vi.fn(),
    },
    agentRegistry: {
      get: vi.fn(),
      getAll: vi.fn(),
    },
    callLLM: vi.fn().mockResolvedValue({ content: 'ok' }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('brainstormConceptsTool', () => {
  it('calls callLLM and parses brainstorm results', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [
        {
          function: {
            name: 'brainstorm_output',
            arguments: JSON.stringify({ terms: [{ term: 'Atom', definition: 'Basic unit' }] }),
          },
        },
      ],
    });
    const result = await brainstormConceptsTool.execute({ topic: 'Chemistry', count: 10 }, ctx);
    expect(result.concepts).toHaveLength(1);
    expect(ctx.state.concepts).toHaveLength(1);
  });

  it('returns empty concepts when no tool call in LLM response', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'no tool call' });
    const result = await brainstormConceptsTool.execute({ topic: 'Physics' }, ctx);
    expect(result.concepts).toEqual([]);
  });
});

describe('flashcardCreateTool', () => {
  it('calls callLLM and stores flashcards in state', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [
        {
          function: {
            name: 'generate_flashcards',
            arguments: JSON.stringify({
              deck_name: 'Science',
              flashcards: [{ front: 'Q', back: 'A' }],
            }),
          },
        },
      ],
    });
    const result = await flashcardCreateTool.execute(
      { concepts: [{ term: 'T1', definition: 'D1' }], deckName: 'My Deck' },
      ctx,
    );
    expect(ctx.state.results.flashcards).toHaveLength(1);
    expect(ctx.state.results.deckName).toBe('Science');
    expect(result.deckName).toBe('Science');
  });

  it('returns fallback when no tool call in response', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'no tool call' });
    const result = await flashcardCreateTool.execute(
      { concepts: [{ term: 'T1', definition: 'D1' }] },
      ctx,
    );
    expect(result.flashcards).toEqual([]);
  });

  it('includes count line in prompt when count specified', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [{ function: { name: 'generate_flashcards', arguments: '{}' } }],
    });
    await flashcardCreateTool.execute(
      { concepts: [{ term: 'T1', definition: 'D1' }], count: 10 },
      ctx,
    );
    expect(ctx.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('10'),
      }),
    );
  });
});

describe('flashcardReviewTool', () => {
  it('keeps cards that pass review', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [
        { function: { name: 'review_cards', arguments: JSON.stringify({ kept: [0, 2] }) } },
      ],
    });
    const cards = [
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ];
    const result = await flashcardReviewTool.execute({ cards }, ctx);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(1);
    expect(ctx.state.results.flashcards).toHaveLength(2);
  });

  it('returns all cards as kept when no tool call in response', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'no tool call' });
    const cards = [{ front: 'Q1', back: 'A1' }];
    const result = await flashcardReviewTool.execute({ cards }, ctx);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });
});

describe('flashcardReviseTool', () => {
  it('returns revised flashcards from LLM', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [
        {
          function: {
            name: 'generate_flashcards',
            arguments: JSON.stringify({ flashcards: [{ front: 'Q1', back: 'A1 improved' }] }),
          },
        },
      ],
    });
    const cards = [{ front: 'Q1', back: 'A1' }];
    const result = await flashcardReviseTool.execute({ cards, feedback: 'Make it clearer' }, ctx);
    expect(result.revised).toHaveLength(1);
    expect(result.revised[0].back).toBe('A1 improved');
  });

  it('returns original cards when no tool call in response', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'no tool call' });
    const cards = [{ front: 'Q1', back: 'A1' }];
    const result = await flashcardReviseTool.execute({ cards, feedback: 'Improve' }, ctx);
    expect(result.revised).toEqual(cards);
  });
});
