import { generateText, type LanguageModel, stepCountIs, streamText, tool } from 'ai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type FakeLlmApi, type FixtureShape, loadFakeLlm } from '#test/unit/qa/fake-llm-load';
import { requestSchema } from '#test/unit/qa/fake-llm-wire';

/**
 * What the app's model client (`@studiq/server/ai/model`, on `ai@7` and
 * `@ai-sdk/openai-compatible`) makes of each wire behaviour the fake server can
 * produce. The fixtures rely on these results, so an SDK bump that changes one
 * shows up here before it shows up in a Playwright spec.
 */

let model: LanguageModel;
let llm: FakeLlmApi;
let seenHeaders: Headers[] = [];
let makeLlm: (fixtures: FixtureShape[]) => FakeLlmApi;

beforeAll(async () => {
  const modules = await loadFakeLlm();
  makeLlm = (fixtures) => new modules.FakeLlm(fixtures);

  vi.stubEnv('LLM_PROVIDER', 'fake');
  vi.stubEnv('LLM_API_KEY', 'qa-fake-key');
  vi.stubEnv('LLM_MODEL_NAME', 'qa-fake');
  vi.stubEnv('LLM_BASE_URL', 'http://fake-llm.test/v1');
  vi.resetModules();
  // The app's own model factory, so the request shape under test is the real one.
  ({ chatModel: model } = await import('@studiq/server/ai/model'));

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seenHeaders.push(request.headers);
    return llm.handle(request);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const call = (args: string | Record<string, unknown>, name = 'get_weather') => ({
  id: 'call_1',
  name,
  arguments: args,
});

interface Outcome {
  types: string[];
  text: string;
  errors: unknown[];
  toolCalls: { name: string; invalid: boolean; input: unknown }[];
  /** Thrown out of the stream iteration itself, not reported as an `error` part. */
  thrown: unknown;
  requests: number;
  executed: unknown[];
  finishReason: string | undefined;
  totalUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
}

async function stream(turns: FixtureShape['turns'], steps = 1): Promise<Outcome> {
  const name = `sdk-${Math.random().toString(36).slice(2)}`;
  llm = makeLlm([
    { key: `S:${name}`, case: 'S', match: { firstUserContains: name }, turns, maxTurns: 10 },
  ]);
  seenHeaders = [];
  const executed: unknown[] = [];
  const result = streamText({
    model,
    prompt: name,
    maxRetries: 0,
    stopWhen: stepCountIs(steps),
    onError: () => undefined,
    tools: {
      get_weather: tool({
        description: 'weather of a city',
        inputSchema: z.object({ city: z.string() }),
        execute: (input) => {
          executed.push(input);
          return { temp: 20 };
        },
      }),
    },
  });

  const outcome: Outcome = {
    types: [],
    text: '',
    errors: [],
    toolCalls: [],
    thrown: null,
    requests: 0,
    executed,
    finishReason: undefined,
    totalUsage: undefined,
  };
  try {
    for await (const part of result.fullStream) {
      outcome.types.push(part.type);
      if (part.type === 'text-delta') outcome.text += part.text;
      if (part.type === 'error') outcome.errors.push(part.error);
      if (part.type === 'tool-call') {
        outcome.toolCalls.push({
          name: part.toolName,
          invalid: 'invalid' in part && part.invalid === true,
          input: part.input,
        });
      }
      if (part.type === 'finish') {
        outcome.finishReason = part.finishReason;
        outcome.totalUsage = part.totalUsage;
      }
    }
  } catch (error) {
    outcome.thrown = error;
  }
  outcome.requests = llm.journal.list().length;
  return outcome;
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : undefined);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);

describe('fake-llm against the app model client', () => {
  it('identifies the client and asks for a streamed reply without usage', async () => {
    await stream([{ content: 'hi' }]);
    const request = requestSchema.parse(llm.journal.list()[0]?.request);
    expect(request.stream).toBe(true);
    expect(request.tools).toHaveLength(1);
    // Pinned on purpose: the provider never opts into `include_usage`, so a
    // streamed turn meters zero tokens. A product change flips this assertion.
    expect(request.stream_options).toBeUndefined();
    expect(seenHeaders[0]?.get('user-agent')).toBe('studiq/0.1');
    expect(seenHeaders[0]?.get('x-opencode-session')).toBeTruthy();
  });

  it('streams text and captures the usage chunk that follows the finish chunk', async () => {
    const outcome = await stream([{ content: ['Hel', 'lo'], usage: { input: 5, output: 2 } }]);
    expect(outcome.text).toBe('Hello');
    expect(outcome.finishReason).toBe('stop');
    expect(outcome.totalUsage).toMatchObject({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
  });

  it('meters nothing when the provider sends no usage', async () => {
    const outcome = await stream([{ content: 'x' }]);
    expect(outcome.totalUsage?.inputTokens).toBeUndefined();
    expect(outcome.totalUsage?.totalTokens).toBeUndefined();
  });

  it('surfaces reasoning as its own parts', async () => {
    const outcome = await stream([{ reasoning: 'thinking', content: 'ok' }]);
    expect(outcome.types).toContain('reasoning-delta');
    expect(outcome.text).toBe('ok');
  });

  it('runs a valid tool call whose arguments were split over several deltas', async () => {
    const outcome = await stream(
      [
        { toolCalls: [call({ city: 'Gdańsk', note: 'long enough to need several pieces' })] },
        { match: { hasToolResult: true }, content: 'done' },
      ],
      2,
    );
    // `note` is not in the tool schema, so it is stripped before execute
    expect(outcome.executed).toEqual([{ city: 'Gdańsk' }]);
    expect(outcome.types.filter((type) => type === 'tool-input-delta').length).toBeGreaterThan(1);
    expect(outcome.text).toBe('done');
    const second = requestSchema.parse(llm.journal.list()[1]?.request);
    expect(second.messages.at(-1)?.role).toBe('tool');
  });

  it('strips unknown keys from tool arguments and still runs the call', async () => {
    const outcome = await stream([{ toolCalls: [call({ city: 'x', extra: 1 })] }]);
    expect(outcome.executed).toEqual([{ city: 'x' }]);
  });

  it('turns truncated arguments into an invalid call plus a tool error, and never executes', async () => {
    const outcome = await stream([
      { toolCalls: [call({ city: 'Gdańsk' })], truncateArgumentsAt: 8 },
    ]);
    expect(outcome.toolCalls).toEqual([{ name: 'get_weather', invalid: true, input: '{"city":' }]);
    expect(outcome.types).toContain('tool-error');
    expect(outcome.executed).toEqual([]);
    expect(outcome.requests).toBe(1);
  });

  it.each([
    ['an unknown tool', { toolCalls: [call({ city: 'x' }, 'no_such_tool')] }],
    ['a wrong argument type', { toolCalls: [call({ city: 5 })] }],
    ['a missing required argument', { toolCalls: [call({})] }],
  ])('turns %s into a tool error', async (_label, turn) => {
    const outcome = await stream([turn]);
    expect(outcome.types).toContain('tool-error');
    expect(outcome.executed).toEqual([]);
  });

  it('reports a stream that ends without a finish reason, keeping the text so far', async () => {
    const outcome = await stream([{ content: 'par', closeWithoutFinish: true }]);
    expect(errorName(outcome.errors[0])).toBe('AI_InvalidResponseDataError');
    expect(errorMessage(outcome.errors[0])).toMatch(/without a finish reason/);
    expect(outcome.text).toBe('par');
  });

  it('accepts a stream that ends without [DONE] once the finish reason arrived', async () => {
    const outcome = await stream([
      { content: 'whole', usage: { input: 2, output: 1 }, omitDone: true },
    ]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.text).toBe('whole');
    expect(outcome.finishReason).toBe('stop');
    expect(outcome.totalUsage?.totalTokens).toBe(3);
  });

  it('treats [DONE] without a finish reason the same way', async () => {
    const outcome = await stream([{ content: 'par', finish: null }]);
    expect(errorName(outcome.errors[0])).toBe('AI_InvalidResponseDataError');
  });

  it('reports a mid-stream provider error, keeps the partial text and does not retry', async () => {
    const outcome = await stream([{ content: ['part', 'ial'], errorFrameAt: 3 }]);
    expect(errorName(outcome.errors[0])).toBe('AI_StreamProviderError');
    expect(errorMessage(outcome.errors[0])).toContain('fake provider error');
    expect(outcome.text).toBe('partial');
    expect(outcome.requests).toBe(1);
  });

  it('throws out of the stream when the connection is destroyed', async () => {
    const outcome = await stream([{ content: ['part', 'ial'], destroyAfter: 3 }]);
    expect(errorName(outcome.thrown)).toBe('AI_APICallError');
    expect(outcome.text).toBe('partial');
  });

  it.each([
    [500, 'fake provider error'],
    [400, 'bad request body'],
  ])('reports an http %i as a provider error', async (status, message) => {
    const outcome = await stream([{ http: { status, body: { error: { message } } } }]);
    expect(errorName(outcome.errors[0])).toBe('AI_APICallError');
    expect(errorMessage(outcome.errors[0])).toBe(message);
    expect(outcome.requests).toBe(1);
  });

  it('stops a loop of valid tool calls at the step cap, without an error', async () => {
    const outcome = await stream([{ toolCalls: [call({ city: 'x' })] }], 3);
    expect(outcome.requests).toBe(3);
    expect(outcome.executed).toHaveLength(3);
    expect(outcome.finishReason).toBe('tool-calls');
    expect(outcome.types).not.toContain('error');
  });

  it('serves a nested, non-streaming call with text and usage', async () => {
    const name = 'sdk-nested';
    llm = makeLlm([
      {
        key: 'S:nested',
        case: 'S',
        match: { firstUserContains: name },
        turns: [{ content: 'material text', usage: { input: 3, output: 4 } }],
      },
    ]);
    const result = await generateText({ model, prompt: name, maxRetries: 0 });
    expect(result.text).toBe('material text');
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 4 });
    expect(requestSchema.parse(llm.journal.list()[0]?.request).stream).toBeUndefined();
  });
});
