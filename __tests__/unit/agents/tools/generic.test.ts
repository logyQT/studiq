import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zod')>();
  return { ...actual, registry: { register: vi.fn() } };
});

import { askUserTool } from '@/server/agents/tools/generic/ask-user.tool';
import { callAgentTool } from '@/server/agents/tools/generic/call-agent.tool';
import { createPlanTool } from '@/server/agents/tools/generic/create-plan.tool';
import { evaluateQualityTool } from '@/server/agents/tools/generic/evaluate-quality.tool';
import { extractConceptsTool } from '@/server/agents/tools/generic/extract-concepts.tool';
import { fetchMaterialTool } from '@/server/agents/tools/generic/fetch-material.tool';
import { finishTool } from '@/server/agents/tools/generic/finish.tool';
import { webfetchTool } from '@/server/agents/tools/generic/webfetch.tool';
import { chatTool } from '@/server/agents/tools/generic/chat.tool';

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
    callLLM: vi.fn().mockResolvedValue({ content: 'ok' }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('askUserTool', () => {
  it('returns a question object with generated id', async () => {
    const ctx = mockCtx();
    const result = await askUserTool.execute({ question: 'What topic?', options: [{ label: 'A', value: 'a' }] }, ctx);
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

describe('callAgentTool', () => {
  it('returns error when agent not found', async () => {
    const ctx = mockCtx();
    ctx.agentRegistry.get = vi.fn().mockReturnValue(undefined);
    const result = await callAgentTool.execute({ agent: 'unknown', task: 'do stuff' }, ctx);
    expect(result).toEqual({ type: 'error', error: 'Agent "unknown" not found' });
  });

  it('calls sub-agent execute and returns its result', async () => {
    const ctx = mockCtx();
    const subAgent = { execute: vi.fn().mockResolvedValue({ type: 'flashcards', deckName: 'D', flashcards: [] }) };
    ctx.agentRegistry.get = vi.fn().mockReturnValue(subAgent);
    const result = await callAgentTool.execute({ agent: 'flashcard', task: 'make cards' }, ctx);
    expect(subAgent.execute).toHaveBeenCalledWith('make cards', expect.anything());
    expect(result).toEqual({ type: 'flashcards', deckName: 'D', flashcards: [] });
  });
});

describe('createPlanTool', () => {
  it('stores plan in metadata', async () => {
    const ctx = mockCtx();
    const plan = { steps: [{ action: 'fetch', rationale: 'need data' }], estimatedComplexity: 'simple', needsClarification: false };
    const result = await createPlanTool.execute(plan, ctx);
    expect(ctx.state.metadata['plan']).toEqual(plan);
    expect(result).toEqual(plan);
  });
});

describe('evaluateQualityTool', () => {
  it('returns assessment with passed: true by default', async () => {
    const ctx = mockCtx();
    const result = await evaluateQualityTool.execute({}, ctx);
    expect(result.passed).toBe(true);
    expect(result.criteria).toEqual(['SPECIFICITY', 'CONCISENESS', 'CLARITY', 'ACCURACY', 'MEMORABILITY']);
  });

  it('returns notes about content length when content provided', async () => {
    const ctx = mockCtx();
    const result = await evaluateQualityTool.execute({ content: 'Hello world' }, ctx);
    expect(result.notes).toContain('11 chars');
  });
});

describe('extractConceptsTool', () => {
  it('returns error when no material in args or state', async () => {
    const ctx = mockCtx({ material: undefined });
    const result = await extractConceptsTool.execute({}, ctx);
    expect(result).toEqual({ terms: [], error: 'No material provided' });
  });

  it('calls callLLM and parses terms from tool call', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ function: { name: 'extract_terms', arguments: JSON.stringify({ terms: [{ term: 'T1', definition: 'D1' }] }) } }],
    });
    const result = await extractConceptsTool.execute({ material: 'some content' }, ctx);
    expect(result.terms).toHaveLength(1);
    expect(ctx.state.concepts).toHaveLength(1);
  });

  it('returns empty terms when no tool call in response', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'no tool call' });
    const result = await extractConceptsTool.execute({ material: 'content' }, ctx);
    expect(result).toEqual({ terms: [] });
  });
});

describe('fetchMaterialTool', () => {
  it('calls callLLM and stores material in state', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'Generated material content' });
    const result = await fetchMaterialTool.execute({ topic: 'History', depth: 'basic' }, ctx);
    expect(ctx.state.material).toBe('Generated material content');
    expect(result.content).toBe('Generated material content');
    expect(result.length).toBe('Generated material content'.length);
  });

  it('includes focus areas in prompt when provided', async () => {
    const ctx = mockCtx();
    ctx.callLLM = vi.fn().mockResolvedValue({ content: 'focused content' });
    await fetchMaterialTool.execute({ topic: 'Math', focusAreas: ['Algebra', 'Geometry'] }, ctx);
    expect(ctx.callLLM).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Algebra'),
    }));
  });
});

describe('webfetchTool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches URL and stores material in state', async () => {
    const ctx = mockCtx();
    (global.fetch as any).mockResolvedValue({ ok: true, text: () => Promise.resolve('Webpage content about biology.') });
    const result = await webfetchTool.execute({ url: 'https://example.com/biology' }, ctx);
    expect(ctx.state.material).toBe('Webpage content about biology.');
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

  it('stores sourceUrl in results', async () => {
    const ctx = mockCtx();
    (global.fetch as any).mockResolvedValue({ ok: true, text: () => Promise.resolve('content') });
    await webfetchTool.execute({ url: 'https://example.com/article' }, ctx);
    expect(ctx.state.results['sourceUrl']).toBe('https://example.com/article');
  });
});

describe('chatTool', () => {
  it('returns chat result with provided text', async () => {
    const ctx = mockCtx();
    const result = await chatTool.execute({ text: 'Hello, how can I help?' }, ctx);
    expect(result).toEqual({ type: 'chat', content: 'Hello, how can I help?' });
  });
});

describe('finishTool', () => {
  it('returns flashcards from state results', async () => {
    const ctx = mockCtx({ results: { flashcards: [{ front: 'Q', back: 'A' }], deckName: 'Test Deck' } });
    const result = await finishTool.execute({ message: 'Done' }, ctx);
    expect(result.type).toBe('flashcards');
    expect(result.flashcards).toHaveLength(1);
    expect(result.deckName).toBe('Test Deck');
  });

  it('calls onFlashcards when flashcards exist', async () => {
    const ctx = mockCtx({ results: { flashcards: [{ front: 'Q', back: 'A' }] } });
    await finishTool.execute({}, ctx);
    expect(ctx.callbacks.onFlashcards).toHaveBeenCalled();
  });

  it('returns empty flashcards when none in state', async () => {
    const ctx = mockCtx();
    const result = await finishTool.execute({}, ctx);
    expect(result.flashcards).toEqual([]);
  });
});
