import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zod')>();
  return { ...actual, registry: { register: vi.fn() } };
});

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({ text: 'Generated material content' }),
  };
});

import { askUserTool } from '@studiq/server/agents/tools/generic/ask-user.tool';
import { createPlanTool } from '@studiq/server/agents/tools/generic/create-plan.tool';
import { evaluateQualityTool } from '@studiq/server/agents/tools/generic/evaluate-quality.tool';
import { extractConceptsTool } from '@studiq/server/agents/tools/generic/extract-concepts.tool';
import { fetchMaterialTool } from '@studiq/server/agents/tools/generic/fetch-material.tool';
import { finishTool } from '@studiq/server/agents/tools/generic/finish.tool';
import { webfetchTool } from '@studiq/server/agents/tools/generic/webfetch.tool';
import { generateText } from 'ai';

function mockCtx(overrides?: Record<string, unknown>) {
  return {
    trace: { log: vi.fn(), getByConversation: vi.fn(), getAll: vi.fn(), clear: vi.fn() },
    state: {
      text: 'test task',
      file: undefined,
      conversationId: undefined,
      material: 'test material content',
      concepts: undefined,
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
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('askUserTool', () => {
  it('returns a question object with generated id', async () => {
    const ctx = mockCtx();
    const result = await askUserTool.execute(
      { question: 'What topic?', options: [{ label: 'A', value: 'a' }] },
      ctx,
    );
    expect(result.type).toBe('question');
    expect(result.question.id).toMatch(/^q_\d+_/);
    expect(result.question.question).toBe('What topic?');
    expect(result.question.options).toEqual([{ label: 'A', value: 'a' }]);
  });

  it('does not call onQuestion directly — controller handles SSE event', async () => {
    const ctx = mockCtx();
    await askUserTool.execute({ question: 'What topic?' }, ctx);
    expect(ctx.callbacks.onQuestion).not.toHaveBeenCalled();
  });
});

describe('createPlanTool', () => {
  it('returns the plan as-is', async () => {
    const ctx = mockCtx();
    const plan = {
      steps: [{ action: 'fetch', rationale: 'need data' }],
      estimatedComplexity: 'simple',
      needsClarification: false,
    };
    const result = await createPlanTool.execute(plan, ctx);
    expect(result).toEqual(plan);
  });
});

describe('evaluateQualityTool', () => {
  it('returns assessment with passed: true by default', async () => {
    const ctx = mockCtx();
    const result = await evaluateQualityTool.execute({}, ctx);
    expect(result.passed).toBe(true);
    expect(result.criteria).toEqual([
      'SPECIFICITY',
      'CONCISENESS',
      'CLARITY',
      'ACCURACY',
      'MEMORABILITY',
    ]);
  });

  it('returns notes about content length when content provided', async () => {
    const ctx = mockCtx();
    const result = await evaluateQualityTool.execute({ content: 'Hello world' }, ctx);
    expect(result.notes).toContain('11 chars');
  });
});

describe('extractConceptsTool', () => {
  it('returns empty terms when no terms in args', async () => {
    const ctx = mockCtx();
    const result = await extractConceptsTool.execute({}, ctx);
    expect(result.terms).toBeUndefined();
  });

  it('returns terms passed in args', async () => {
    const ctx = mockCtx();
    const terms = [{ term: 'T1', definition: 'D1' }];
    const result = await extractConceptsTool.execute({ terms }, ctx);
    expect(result.terms).toHaveLength(1);
    expect(result.terms![0].term).toBe('T1');
  });

  it('returns empty array when terms is empty', async () => {
    const ctx = mockCtx();
    const result = await extractConceptsTool.execute({ terms: [] }, ctx);
    expect(result).toEqual({ terms: [] });
  });
});

describe('fetchMaterialTool', () => {
  it('calls generateText and returns content', async () => {
    const ctx = mockCtx();
    const result = await fetchMaterialTool.execute({ topic: 'History', depth: 'basic' }, ctx);
    expect(generateText).toHaveBeenCalledOnce();
    expect(result.content).toBe('Generated material content');
    expect(result.length).toBe('Generated material content'.length);
  });

  it('includes focus areas in prompt when provided', async () => {
    const ctx = mockCtx();
    await fetchMaterialTool.execute({ topic: 'Math', focusAreas: ['Algebra', 'Geometry'] }, ctx);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Algebra'),
      }),
    );
  });
});

describe('webfetchTool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches URL and returns content', async () => {
    const ctx = mockCtx();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('Webpage content about biology.'),
    });
    const result = await webfetchTool.execute({ url: 'https://example.com/biology' }, ctx);
    expect(result.content).toBe('Webpage content about biology.');
    expect(result.url).toBe('https://example.com/biology');
    expect(result.length).toBe(30);
  });

  it('returns error on HTTP failure', async () => {
    const ctx = mockCtx();
    (global.fetch as any).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    const result = await webfetchTool.execute({ url: 'https://example.com/missing' }, ctx);
    expect(result.error).toContain('HTTP 404');
    expect(result.content).toBe('');
  });

  it('returns error on network failure', async () => {
    const ctx = mockCtx();
    (global.fetch as any).mockRejectedValue(new Error('ENOTFOUND'));
    const result = await webfetchTool.execute({ url: 'https://invalid.example.com' }, ctx);
    expect(result.error).toContain('Fetch failed');
    expect(result.content).toBe('');
  });

  it('stores sourceUrl in result', async () => {
    const ctx = mockCtx();
    (global.fetch as any).mockResolvedValue({ ok: true, text: () => Promise.resolve('content') });
    const result = await webfetchTool.execute({ url: 'https://example.com/article' }, ctx);
    expect(result.url).toBe('https://example.com/article');
  });
});

describe('finishTool', () => {
  it('returns flashcards from input args', async () => {
    const ctx = mockCtx();
    const result = await finishTool.execute(
      {
        type: 'flashcards',
        flashcards: [{ front: 'Q', back: 'A' }],
        deckName: 'Test Deck',
        message: 'Done',
      },
      ctx,
    );
    expect(result.type).toBe('flashcards');
    expect(result.flashcards).toHaveLength(1);
    expect(result.deckName).toBe('Test Deck');
  });

  it('returns type chat with message when no flashcards', async () => {
    const ctx = mockCtx();
    const result = await finishTool.execute({ message: 'Hello' }, ctx);
    expect(result.type).toBe('chat');
    expect(result.content).toBe('Hello');
  });

  it('returns chat with empty content when no flashcards and no message', async () => {
    const ctx = mockCtx();
    const result = await finishTool.execute({}, ctx);
    expect(result.type).toBe('chat');
    expect(result.content).toBe('');
  });
});
