import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/zod', () => {
  const zod = require('zod');
  return { z: zod, registry: { register: vi.fn() } };
});

const z = require('zod');
import { BaseAgent, zodToJsonSchema } from '@/server/agents/core';
import type { Tool, ToolContext, AgentResult, AgentCallbacks, ToolDefinition } from '@/server/agents/tools/types';

class TestAgent extends BaseAgent {
  readonly name = 'test_agent';
  readonly systemPrompt = 'You are a test agent.';

  constructor(tools: Tool[]) {
    super();
    this.tools = tools;
  }
}

function createMockCallbacks(): AgentCallbacks {
  return {
    onThought: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onThinking: vi.fn(),
    onComplete: vi.fn(),
    onQuestion: vi.fn(),
    onFlashcards: vi.fn(),
    onError: vi.fn(),
  };
}

function createMockContext(overrides?: {
  callLLMResult?: { content: string; toolCalls?: Array<{ function: { name: string; arguments: string } }> };
  stateOverrides?: Partial<Record<string, unknown>>;
}): ToolContext {
  const callbacks = createMockCallbacks();
  const callLLM = vi.fn().mockResolvedValue(
    overrides?.callLLMResult || { content: 'Test thinking.' },
  );

  return {
    trace: { log: vi.fn(), getByConversation: vi.fn(), getAll: vi.fn(), clear: vi.fn() },
    state: {
      text: 'test task',
      results: {},
      metadata: {},
      ...(overrides?.stateOverrides as Record<string, unknown> || {}),
    },
    callbacks,
    agentRegistry: {
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    },
    callLLM: callLLM as ToolContext['callLLM'],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('zodToJsonSchema', () => {
  it('converts a simple string schema', () => {
    const result = zodToJsonSchema(z.string());
    expect(result).toEqual({ type: 'string' });
  });

  it('converts a number schema with constraints', () => {
    const result = zodToJsonSchema(z.number().min(1).max(100));
    expect(result.type).toBe('number');
    expect(result.minimum).toBe(1);
    expect(result.maximum).toBe(100);
  });

  it('converts an object schema', () => {
    const result = zodToJsonSchema(z.object({
      name: z.string(),
      age: z.number().optional(),
    }));
    expect(result.type).toBe('object');
    expect(result.properties).toBeDefined();
    expect(result.required).toEqual(['name']);
    expect(result.additionalProperties).toBe(false);
  });

  it('converts an enum schema', () => {
    const result = zodToJsonSchema(z.enum(['a', 'b', 'c']));
    expect(result).toEqual({ type: 'string', enum: ['a', 'b', 'c'] });
  });

  it('converts an array schema', () => {
    const result = zodToJsonSchema(z.array(z.string()));
    expect(result.type).toBe('array');
    expect((result.items as Record<string, unknown>).type).toBe('string');
  });

  it('strips $schema key from output', () => {
    const result = zodToJsonSchema(z.string());
    expect(result).not.toHaveProperty('$schema');
  });
});

describe('BaseAgent', () => {
  describe('tool call execution', () => {
    it('executes a tool and continues the loop when the tool returns', async () => {
      const fakeExecute = vi.fn().mockResolvedValue({ output: 'done' });
      const fakeTool: Tool = {
        name: 'fake_tool',
        description: 'A test tool',
        parameters: z.object({ input: z.string() }),
        execute: fakeExecute,
      };

      const agent = new TestAgent([fakeTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: 'I will use the tool.',
          toolCalls: [{ function: { name: 'fake_tool', arguments: JSON.stringify({ input: 'hello' }) } }],
        })
        .mockResolvedValueOnce({
          content: 'Task complete.',
          toolCalls: [{ function: { name: 'finish', arguments: JSON.stringify({ message: 'done' }) } }],
        });

      const callbacks = createMockCallbacks();
      const ctx = { ...createMockContext(), callbacks, callLLM: callLLM as ToolContext['callLLM'] };

      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish the task',
        parameters: z.object({ message: z.string().optional() }),
        execute: vi.fn().mockResolvedValue({
          type: 'flashcards' as const,
          deckName: 'Deck',
          flashcards: [{ front: 'Q', back: 'A' }],
        }),
      };

      agent.tools = [fakeTool, finishTool];

      const result = await agent.execute('test task', ctx);

      expect(fakeExecute).toHaveBeenCalledWith({ input: 'hello' }, expect.any(Object));
      expect(result.type).toBe('flashcards');
    });

    it('passes parsed arguments to the tool', async () => {
      const fakeExecute = vi.fn().mockResolvedValue({ ok: true });
      const tool: Tool = {
        name: 'my_tool',
        description: 'Tool',
        parameters: z.object({ name: z.string(), count: z.number() }),
        execute: fakeExecute,
      };

      const agent = new TestAgent([tool]);
      agent.maxIterations = 2;

      const callLLM = vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [{ function: { name: 'my_tool', arguments: JSON.stringify({ name: 'test', count: 42 }) } }],
      });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };
      agent.tools = [tool, {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'ok' }),
      }];

      await agent.execute('test', ctx);

      expect(fakeExecute).toHaveBeenCalledWith({ name: 'test', count: 42 }, expect.any(Object));
    });
  });

  describe('ask_user tool', () => {
    it('returns a question result when ask_user is called', async () => {
      const askUserTool: Tool = {
        name: 'ask_user',
        description: 'Ask the user',
        parameters: z.object({ question: z.string() }),
        execute: vi.fn().mockResolvedValue({
          question: { id: 'q1', question: 'What color?', options: [{ label: 'Red', value: 'red' }] },
        }),
      };

      const agent = new TestAgent([askUserTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [{ function: { name: 'ask_user', arguments: JSON.stringify({ question: 'What color?' }) } }],
      });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };
      agent.tools = [askUserTool];

      const result = await agent.execute('test', ctx);

      expect(result.type).toBe('question');
      if (result.type === 'question') {
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].question).toBe('What color?');
      }
    });
  });

  describe('chat tool', () => {
    it('returns the chat result directly', async () => {
      const chatTool: Tool = {
        name: 'chat',
        description: 'Chat',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat' as const, content: 'Hello!' }),
      };

      const agent = new TestAgent([chatTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [{ function: { name: 'chat', arguments: JSON.stringify({ text: 'Hello!' }) } }],
      });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };
      agent.tools = [chatTool];

      const result = await agent.execute('test', ctx);

      expect(result.type).toBe('chat');
      if (result.type === 'chat') {
        expect(result.content).toBe('Hello!');
      }
    });
  });

  describe('finish tool', () => {
    it('returns the finish result directly', async () => {
      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({
          type: 'flashcards' as const,
          deckName: 'My Deck',
          flashcards: [{ front: 'F', back: 'B' }],
        }),
      };

      const agent = new TestAgent([finishTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
      });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };
      agent.tools = [finishTool];

      const result = await agent.execute('test', ctx);

      expect(result.type).toBe('flashcards');
      if (result.type === 'flashcards') {
        expect(result.deckName).toBe('My Deck');
      }
    });
  });

  describe('unknown tool handling', () => {
    it('does not crash when the LLM calls an unknown tool', async () => {
      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'done' }),
      };

      const agent = new TestAgent([finishTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'nonexistent_tool', arguments: '{}' } }],
        })
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
        });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };
      agent.tools = [finishTool];

      const result = await agent.execute('test', ctx);

      expect(result.type).toBe('chat');
    });
  });

  describe('text-only response', () => {
    it('continues looping when LLM returns text without tool calls', async () => {
      const fakeTool: Tool = {
        name: 'fake_tool',
        description: 'A tool',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({}),
      };

      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'done' }),
      };

      const agent = new TestAgent([fakeTool, finishTool]);
      agent.maxIterations = 5;

      const callLLM = vi.fn()
        .mockResolvedValueOnce({ content: 'Thinking about what to do...' })
        .mockResolvedValueOnce({ content: 'Still thinking...' })
        .mockResolvedValueOnce({
          content: 'Now I will finish.',
          toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
        });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };

      const result = await agent.execute('test', ctx);

      expect(result).toBeDefined();
      expect(callLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe('max iterations', () => {
    it('stops after maxIterations and returns a result', async () => {
      const agent = new TestAgent([]);
      agent.maxIterations = 3;

      const callLLM = vi.fn().mockResolvedValue({ content: 'Still processing...' });
      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };

      const result = await agent.execute('test', ctx);

      expect(callLLM).toHaveBeenCalledTimes(3);
      expect(result.type).toBe('chat');
    });

    it('returns flashcards from state when max iterations reached', async () => {
      const agent = new TestAgent([]);
      agent.maxIterations = 2;

      const callLLM = vi.fn().mockResolvedValue({ content: 'Still working...' });
      const ctx = createMockContext({
        stateOverrides: { results: { flashcards: [{ front: 'Q', back: 'A' }], deckName: 'Saved' } },
      });

      const ctxWithLLM: ToolContext = { ...ctx, callLLM: callLLM as ToolContext['callLLM'] };

      const result = await agent.execute('test', ctxWithLLM);

      expect(result.type).toBe('flashcards');
      if (result.type === 'flashcards') {
        expect(result.flashcards).toHaveLength(1);
        expect(result.deckName).toBe('Saved');
      }
    });
  });

  describe('thought events', () => {
    it('fires onThought when LLM returns content', async () => {
      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'done' }),
      };

      const agent = new TestAgent([finishTool]);
      agent.maxIterations = 5;

      const callLLM = vi.fn()
        .mockResolvedValueOnce({ content: 'Thinking...' })
        .mockResolvedValueOnce({ content: 'Still thinking...' })
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
        });

      const callbacks = createMockCallbacks();
      const ctx = { ...createMockContext(), callbacks, callLLM: callLLM as ToolContext['callLLM'] };
      agent.tools = [finishTool];

      await agent.execute('test', ctx);

      expect(callbacks.onThought).toHaveBeenCalledTimes(2);
    });

    it('includes agent name, step number, and reasoning text', async () => {
      const agent = new TestAgent([]);
      agent.maxIterations = 2;

      const callLLM = vi.fn().mockResolvedValue({ content: 'ok' });
      const callbacks = createMockCallbacks();
      const ctx = { ...createMockContext(), callbacks, callLLM: callLLM as ToolContext['callLLM'] };

      await agent.execute('test', ctx);

      const thought1 = vi.mocked(callbacks.onThought).mock.calls[0][0];
      expect(thought1.agent).toBe('test_agent');
      expect(thought1.step).toBe(1);
      expect(thought1.reasoning).toBe('ok');

      const thought2 = vi.mocked(callbacks.onThought).mock.calls[1][0];
      expect(thought2.step).toBe(2);
    });
  });

  describe('tool definitions passed to LLM', () => {
    it('passes correctly formatted tool definitions', async () => {
      const tool: Tool = {
        name: 'my_tool',
        description: 'A test tool',
        parameters: z.object({ input: z.string() }),
        execute: vi.fn().mockResolvedValue({}),
      };

      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'ok' }),
      };

      const agent = new TestAgent([tool, finishTool]);
      agent.maxIterations = 2;

      const callLLM = vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
      });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };

      await agent.execute('test', ctx);

      const toolsArg = callLLM.mock.calls[0][0].tools as ToolDefinition[];
      expect(toolsArg).toHaveLength(2);

      const myToolDef = toolsArg.find((t) => t.function.name === 'my_tool')!;
      expect(myToolDef.type).toBe('function');
      expect(myToolDef.function.description).toBe('A test tool');
      expect(myToolDef.function.parameters.type).toBe('object');
      expect(myToolDef.function.parameters.properties).toBeDefined();
      expect((myToolDef.function.parameters.properties as Record<string, unknown>).input).toEqual({ type: 'string' });
    });
  });

  describe('callbacks invocation', () => {
    it('fires onToolCall and onToolResult for tool calls', async () => {
      const tool: Tool = {
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({ name: z.string() }),
        execute: vi.fn().mockResolvedValue({ greeting: 'Hello!' }),
      };

      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'done' }),
      };

      const agent = new TestAgent([tool, finishTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'greet', arguments: JSON.stringify({ name: 'World' }) } }],
        })
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
        });

      const callbacks = createMockCallbacks();
      const ctx = { ...createMockContext(), callbacks, callLLM: callLLM as ToolContext['callLLM'] };

      await agent.execute('test', ctx);

      expect(callbacks.onToolCall).toHaveBeenCalledWith({ id: 'tc-0-0', tool: 'greet', args: { name: 'World' } });
      expect(callbacks.onToolResult).toHaveBeenCalledWith({ id: 'tc-0-0', tool: 'greet', result: { greeting: 'Hello!' } });
    });
  });

  describe('invalid tool arguments JSON', () => {
    it('continues the loop when arguments cannot be parsed', async () => {
      const tool: Tool = {
        name: 'my_tool',
        description: 'Tool',
        parameters: z.object({}),
        execute: vi.fn(),
      };

      const finishTool: Tool = {
        name: 'finish',
        description: 'Finish',
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({ type: 'chat', content: 'done' }),
      };

      const agent = new TestAgent([tool, finishTool]);
      agent.maxIterations = 3;

      const callLLM = vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'my_tool', arguments: 'NOT VALID JSON' } }],
        })
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ function: { name: 'finish', arguments: '{}' } }],
        });

      const ctx = { ...createMockContext(), callLLM: callLLM as ToolContext['callLLM'] };

      const result = await agent.execute('test', ctx);

      expect(tool.execute).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});
