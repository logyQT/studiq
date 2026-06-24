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

describe('Flashcard Pipeline', () => {
  it('handles simple flashcard intent: plan → generate_flashcards → evaluate → finish', async () => {
    const agent = new GeneralAgent();
    agent.maxIterations = 6;

    const planExecute = vi.fn().mockResolvedValue({
      steps: [{ action: 'call flashcard agent', rationale: 'user wants flashcards' }],
      estimatedComplexity: 'simple',
      needsClarification: false,
    });

    const generateFlashcardsExecute = vi.fn().mockResolvedValue({
      type: 'flashcards' as const,
      deckName: 'Photosynthesis',
      flashcards: [
        { front: 'What is photosynthesis?', back: 'Process by which plants convert light to energy' },
        { front: 'What is chlorophyll?', back: 'Green pigment that absorbs light' },
        { front: 'What are stomata?', back: 'Pores in leaves for gas exchange' },
        { front: 'What is the Calvin cycle?', back: 'Light-independent reactions in photosynthesis' },
        { front: 'What is photolysis?', back: 'Splitting of water molecules using light' },
      ],
    });

    const evaluateExecute = vi.fn().mockResolvedValue({
      passed: true,
      criteria: ['SPECIFICITY', 'CONCISENESS', 'CLARITY', 'ACCURACY', 'MEMORABILITY'],
      notes: 'All criteria passed.',
    });

    const finishExecute = vi.fn().mockResolvedValue({
      type: 'flashcards' as const,
      deckName: 'Photosynthesis',
      flashcards: [
        { front: 'What is photosynthesis?', back: 'Process by which plants convert light to energy' },
        { front: 'What is chlorophyll?', back: 'Green pigment that absorbs light' },
        { front: 'What are stomata?', back: 'Pores in leaves for gas exchange' },
        { front: 'What is the Calvin cycle?', back: 'Light-independent reactions in photosynthesis' },
        { front: 'What is photolysis?', back: 'Splitting of water molecules using light' },
      ],
    });

    agent['tools'] = [
      mockTool({ name: 'create_plan', execute: planExecute }),
      mockTool({ name: 'ask_user' }),
      mockTool({ name: 'fetch_material' }),
      mockTool({ name: 'webfetch' }),
      mockTool({ name: 'extract_concepts' }),
      mockTool({ name: 'evaluate_quality', execute: evaluateExecute }),
      mockTool({ name: 'generate_flashcards', execute: generateFlashcardsExecute }),
      mockTool({ name: 'finish', execute: finishExecute }),
    ];

    const callLLM = vi.fn()
      .mockResolvedValueOnce({
        content: 'I will plan first.',
        toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'call flashcard agent', rationale: 'user wants flashcards' }], estimatedComplexity: 'simple', needsClarification: false }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Delegating to flashcard agent.',
        toolCalls: [{ function: { name: 'generate_flashcards', arguments: JSON.stringify({ agent: 'flashcard', task: 'Create 5 flashcards about photosynthesis', count: 5 }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Evaluating quality.',
        toolCalls: [{ function: { name: 'evaluate_quality', arguments: JSON.stringify({}) } }],
      })
      .mockResolvedValueOnce({
        content: 'Done.',
        toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({ message: 'Created 5 flashcards' }) } }],
      });

    const ctx = mockContext({ callLLM });

    const result = await agent.execute('Create 5 flashcards about photosynthesis', ctx);

    expect(planExecute).toHaveBeenCalled();
    expect(generateFlashcardsExecute).toHaveBeenCalled();
    expect(evaluateExecute).toHaveBeenCalled();
    expect(finishExecute).toHaveBeenCalled();
    expect(result.type).toBe('flashcards');
    if (result.type === 'flashcards') {
      expect(result.flashcards).toHaveLength(5);
      expect(result.deckName).toBe('Photosynthesis');
    }
  });

  it('handles PDF upload: file context flows through pipeline', async () => {
    const agent = new GeneralAgent();
    agent.maxIterations = 6;

    const planExecute = vi.fn().mockResolvedValue({
      steps: [{ action: 'delegate to flashcard agent', rationale: 'file uploaded for flashcards' }],
      estimatedComplexity: 'moderate',
      needsClarification: false,
    });

    const generateFlashcardsExecute = vi.fn().mockResolvedValue({
      type: 'flashcards' as const,
      deckName: 'Uploaded Doc',
      flashcards: [
        { front: 'Key concept 1', back: 'Definition 1' },
        { front: 'Key concept 2', back: 'Definition 2' },
      ],
    });

    const evaluateExecute = vi.fn().mockResolvedValue({ passed: true, criteria: [], notes: 'OK' });

    const finishExecute = vi.fn().mockResolvedValue({
      type: 'flashcards' as const,
      deckName: 'Uploaded Doc',
      flashcards: [
        { front: 'Key concept 1', back: 'Definition 1' },
        { front: 'Key concept 2', back: 'Definition 2' },
      ],
    });

    agent['tools'] = [
      mockTool({ name: 'create_plan', execute: planExecute }),
      mockTool({ name: 'ask_user' }),
      mockTool({ name: 'fetch_material' }),
      mockTool({ name: 'webfetch' }),
      mockTool({ name: 'extract_concepts' }),
      mockTool({ name: 'evaluate_quality', execute: evaluateExecute }),
      mockTool({ name: 'generate_flashcards', execute: generateFlashcardsExecute }),
      mockTool({ name: 'finish', execute: finishExecute }),
    ];

    const callLLM = vi.fn()
      .mockResolvedValueOnce({
        content: 'Planning.',
        toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'delegate to flashcard agent', rationale: 'file uploaded for flashcards' }], estimatedComplexity: 'moderate', needsClarification: false }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Calling flashcard agent.',
        toolCalls: [{ function: { name: 'generate_flashcards', arguments: JSON.stringify({ agent: 'flashcard', task: 'Create flashcards from uploaded file' }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Evaluating.',
        toolCalls: [{ function: { name: 'evaluate_quality', arguments: JSON.stringify({}) } }],
      })
      .mockResolvedValueOnce({
        content: 'Done.',
        toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({}) } }],
      });

    const ctx = mockContext({
      callLLM,
      stateOverrides: {
        file: { data: 'mock-base64-content', mimeType: 'application/pdf' },
      },
    });

    const result = await agent.execute('Create flashcards from this PDF', ctx);

    expect(ctx.state.file).toBeDefined();
    expect(ctx.state.file?.mimeType).toBe('application/pdf');
    expect(result.type).toBe('flashcards');
    if (result.type === 'flashcards') {
      expect(result.flashcards).toHaveLength(2);
    }
  });

  it('returns question when request is ambiguous', async () => {
    const agent = new GeneralAgent();
    agent.maxIterations = 5;

    const planExecute = vi.fn().mockResolvedValue({
      steps: [{ action: 'ask user for clarification', rationale: 'ambiguous request' }],
      estimatedComplexity: 'simple',
      needsClarification: true,
    });

    const askUserExecute = vi.fn().mockResolvedValue({
      type: 'question' as const,
      question: { id: 'q_1', question: 'What topic would you like flashcards about?', options: [{ label: 'Biology', value: 'biology' }, { label: 'History', value: 'history' }] },
    });

    agent['tools'] = [
      mockTool({ name: 'create_plan', execute: planExecute }),
      mockTool({ name: 'ask_user', execute: askUserExecute }),
      mockTool({ name: 'fetch_material' }),
      mockTool({ name: 'webfetch' }),
      mockTool({ name: 'extract_concepts' }),
      mockTool({ name: 'evaluate_quality' }),
      mockTool({ name: 'generate_flashcards' }),
      mockTool({ name: 'finish' }),
    ];

    const callLLM = vi.fn()
      .mockResolvedValueOnce({
        content: 'Planning.',
        toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'ask user for clarification', rationale: 'ambiguous request' }], estimatedComplexity: 'simple', needsClarification: true }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Need to ask user.',
        toolCalls: [{ function: { name: 'ask_user', arguments: JSON.stringify({ question: 'What topic would you like flashcards about?', options: [{ label: 'Biology', value: 'biology' }, { label: 'History', value: 'history' }] }) } }],
      });

    const ctx = mockContext({ callLLM });

    const result = await agent.execute('Make flashcards', ctx);

    expect(planExecute).toHaveBeenCalled();
    expect(askUserExecute).toHaveBeenCalled();
    expect(result.type).toBe('question');
    if (result.type === 'question') {
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].question).toContain('topic');
      expect(result.questions[0].options).toHaveLength(2);
    }
  });

  it('handles webbased content: plan → webfetch → generate_flashcards → finish', async () => {
    const agent = new GeneralAgent();
    agent.maxIterations = 6;

    const planExecute = vi.fn().mockResolvedValue({
      steps: [
        { action: 'fetch from URL', rationale: 'user provided URL' },
        { action: 'delegate to flashcard agent', rationale: 'create flashcards from content' },
      ],
      estimatedComplexity: 'moderate',
      needsClarification: false,
    });

    const webfetchExecute = vi.fn().mockResolvedValue({
      content: 'Webpage content about the solar system with planets, orbits, and facts.',
      url: 'https://example.com/solar-system',
      length: 78,
    });

    const generateFlashcardsExecute = vi.fn().mockResolvedValue({
      type: 'flashcards' as const,
      deckName: 'Solar System',
      flashcards: [
        { front: 'How many planets?', back: '8' },
        { front: 'Largest planet?', back: 'Jupiter' },
      ],
    });

    const evaluateExecute = vi.fn().mockResolvedValue({ passed: true, criteria: [], notes: 'OK' });

    const finishExecute = vi.fn().mockResolvedValue({
      type: 'flashcards' as const,
      deckName: 'Solar System',
      flashcards: [
        { front: 'How many planets?', back: '8' },
        { front: 'Largest planet?', back: 'Jupiter' },
      ],
    });

    agent['tools'] = [
      mockTool({ name: 'create_plan', execute: planExecute }),
      mockTool({ name: 'ask_user' }),
      mockTool({ name: 'fetch_material' }),
      mockTool({ name: 'webfetch', execute: webfetchExecute }),
      mockTool({ name: 'extract_concepts' }),
      mockTool({ name: 'evaluate_quality', execute: evaluateExecute }),
      mockTool({ name: 'generate_flashcards', execute: generateFlashcardsExecute }),
      mockTool({ name: 'finish', execute: finishExecute }),
    ];

    const callLLM = vi.fn()
      .mockResolvedValueOnce({
        content: 'Planning.',
        toolCalls: [{ function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ action: 'fetch from URL', rationale: 'user provided URL' }, { action: 'delegate to flashcard agent', rationale: 'create flashcards from content' }], estimatedComplexity: 'moderate', needsClarification: false }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Fetching URL.',
        toolCalls: [{ function: { name: 'webfetch', arguments: JSON.stringify({ url: 'https://example.com/solar-system' }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Calling flashcard agent.',
        toolCalls: [{ function: { name: 'generate_flashcards', arguments: JSON.stringify({ agent: 'flashcard', task: 'Create flashcards from fetched content' }) } }],
      })
      .mockResolvedValueOnce({
        content: 'Evaluating.',
        toolCalls: [{ function: { name: 'evaluate_quality', arguments: JSON.stringify({}) } }],
      })
      .mockResolvedValueOnce({
        content: 'Done.',
        toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({ message: 'Created flashcards from web content' }) } }],
      });

    const ctx = mockContext({ callLLM });

    const result = await agent.execute('Go to https://example.com/solar-system and make flashcards', ctx);

    expect(planExecute).toHaveBeenCalled();
    expect(webfetchExecute).toHaveBeenCalled();
    expect(generateFlashcardsExecute).toHaveBeenCalled();
    expect(evaluateExecute).toHaveBeenCalled();
    expect(finishExecute).toHaveBeenCalled();
    expect(result.type).toBe('flashcards');
    if (result.type === 'flashcards') {
      expect(result.flashcards).toHaveLength(2);
      expect(result.deckName).toBe('Solar System');
    }
  });
});
