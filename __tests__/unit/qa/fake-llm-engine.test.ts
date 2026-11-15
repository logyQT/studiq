import { beforeAll, describe, expect, it } from 'vitest';
import {
  type FakeLlmApi,
  type FakeLlmModules,
  type FixtureShape,
  loadFakeLlm,
} from '#test/unit/qa/fake-llm-load';
import {
  chunksOf,
  completionSchema,
  errorFrameSchema,
  frames,
  requestSchema,
  toolDeltas,
} from '#test/unit/qa/fake-llm-wire';

let modules: FakeLlmModules;
beforeAll(async () => {
  modules = await loadFakeLlm();
});

const fixture = (
  name: string,
  turns: FixtureShape['turns'],
  extra: Partial<FixtureShape> = {},
): FixtureShape => ({
  key: `T:${name}`,
  case: 'T',
  match: { firstUserContains: name },
  turns,
  ...extra,
});

const user = (text: string) => ({ role: 'user', content: text });
const tools = [{ type: 'function', function: { name: 'lookup', parameters: {} } }];

function post(llm: FakeLlmApi, body: unknown): Promise<Response> {
  return llm.handle(
    new Request('http://fake/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) }),
  );
}

const ask = (llm: FakeLlmApi, text: string, extra: Record<string, unknown> = {}) =>
  post(llm, { model: 'qa-fake', stream: true, messages: [user(text)], tools, ...extra });

/** The non-streaming completion of a request, parsed. */
async function completion(llm: FakeLlmApi, text: string, extra: Record<string, unknown> = {}) {
  const response = await ask(llm, text, { stream: false, ...extra });
  return completionSchema.parse(await response.json());
}

const outcomeOf = (response: Response) => response.headers.get('x-fake-llm-outcome');

/** A fresh engine with one fixture whose only turn replies "same". */
const replayOf = (name: string) => new modules.FakeLlm([fixture(name, [{ content: 'same' }])]);

const runFault = async (
  name: string,
  turn: FixtureShape['turns'][number],
  extra: Record<string, unknown> = {},
) => {
  const llm = new modules.FakeLlm([fixture(name, [turn])]);
  const response = await ask(llm, name, extra);
  return { llm, response, text: await response.text() };
};

describe('fake-llm routing', () => {
  it('answers the ops endpoints and rejects unknown routes', async () => {
    const llm = new modules.FakeLlm([fixture('a', [{ content: 'x' }])]);
    const call = (path: string, method = 'GET') =>
      llm.handle(new Request(`http://fake${path}`, { method }));

    expect(await (await call('/healthz')).json()).toEqual({ status: 'ok', fixtures: 1 });
    const models: unknown = await (await call('/v1/models')).json();
    expect(models).toMatchObject({ object: 'list', data: [{ id: 'qa-fake' }] });
    expect((await call('/nope')).status).toBe(404);
    expect((await call('/v1/chat/completions')).status).toBe(404);
  });

  it('rejects a body that is not a chat request', async () => {
    const llm = new modules.FakeLlm([fixture('a', [{ content: 'x' }])]);
    expect((await post(llm, { prompt: 'no messages' })).status).toBe(400);
    const notJson = new Request('http://fake/v1/chat/completions', { method: 'POST', body: '{' });
    expect((await llm.handle(notJson)).status).toBe(400);
  });
});

describe('fake-llm scenario selection', () => {
  it('picks the fixture by the most specific match', async () => {
    const llm = new modules.FakeLlm([
      fixture('alpha', [{ content: 'broad' }]),
      fixture('alpha', [{ content: 'narrow' }], {
        key: 'T:alpha-narrow',
        match: { firstUserContains: 'alpha', hasToolResult: true },
      }),
    ]);
    expect((await completion(llm, 'alpha please')).choices[0].message.content).toBe('broad');

    const withResult = await post(llm, {
      stream: false,
      messages: [user('alpha please'), { role: 'tool', tool_call_id: 'c1', content: '{}' }],
    });
    const narrow = completionSchema.parse(await withResult.json());
    expect(narrow.choices[0].message.content).toBe('narrow');
  });

  it('fails loudly when nothing matches or two fixtures tie', async () => {
    const llm = new modules.FakeLlm([
      fixture('dup', [{ content: 'one' }]),
      fixture('dup', [{ content: 'two' }], { key: 'T:dup-twin' }),
    ]);

    const unmatched = await ask(llm, 'something else');
    expect(unmatched.status).toBe(500);
    expect(outcomeOf(unmatched)).toBe('unmatched');

    expect(outcomeOf(await ask(llm, 'dup'))).toBe('ambiguous');
    expect(llm.journal.list().map((entry) => entry.outcome)).toEqual(['unmatched', 'ambiguous']);
  });

  it('answers a request without tools with 400, so a nested call does not retry', async () => {
    const llm = new modules.FakeLlm([fixture('a', [{ content: 'x' }])]);
    expect((await post(llm, { messages: [user('b')] })).status).toBe(400);
  });

  it('serves the turns in order and repeats the last one', async () => {
    const llm = new modules.FakeLlm([fixture('seq', [{ content: 'first' }, { content: 'rest' }])]);
    const texts: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      texts.push((await completion(llm, 'seq')).choices[0].message.content);
    }
    expect(texts).toEqual(['first', 'rest', 'rest']);
  });

  it('keeps a separate counter per conversation', async () => {
    const llm = new modules.FakeLlm([
      {
        ...fixture('x', [{ content: 'first' }, { content: 'rest' }]),
        match: { systemContains: 'shared' },
      },
    ]);
    const send = async (first: string) => {
      const response = await post(llm, {
        stream: false,
        messages: [{ role: 'system', content: 'shared' }, user(first)],
      });
      return completionSchema.parse(await response.json()).choices[0].message.content;
    };
    expect([await send('one'), await send('two'), await send('one')]).toEqual([
      'first',
      'first',
      'rest',
    ]);
  });

  it('stops a runaway conversation at maxTurns', async () => {
    const llm = new modules.FakeLlm([fixture('loop', [{ content: 'again' }], { maxTurns: 2 })]);
    expect((await ask(llm, 'loop')).status).toBe(200);
    expect((await ask(llm, 'loop')).status).toBe(200);
    const third = await ask(llm, 'loop');
    expect(third.status).toBe(500);
    expect(outcomeOf(third)).toBe('overrun');
  });

  it('treats a turn guard as an assertion, not a selector', async () => {
    const llm = new modules.FakeLlm([
      fixture('guard', [{ content: 'x', match: { hasToolResult: true } }]),
    ]);
    expect(outcomeOf(await ask(llm, 'guard'))).toBe('turn-mismatch');

    const streamGuard = new modules.FakeLlm([fixture('g2', [{ content: 'x', stream: false }])]);
    expect(outcomeOf(await ask(streamGuard, 'g2'))).toBe('turn-mismatch');
  });
});

describe('fake-llm streaming replies', () => {
  it('streams role, reasoning, content, finish, usage and [DONE] in order', async () => {
    const llm = new modules.FakeLlm([
      fixture('s', [{ reasoning: 'hm', content: ['a', 'b'], usage: { input: 3, output: 2 } }]),
    ]);
    const response = await ask(llm, 's');
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const text = await response.text();

    const chunks = chunksOf(text);
    expect(chunks[0]?.choices[0]?.delta).toEqual({ role: 'assistant', content: '' });
    expect(chunks.slice(1, 4).map((chunk) => chunk.choices[0]?.delta)).toEqual([
      { reasoning_content: 'hm' },
      { content: 'a' },
      { content: 'b' },
    ]);
    expect(chunks[4]?.choices[0]).toMatchObject({ delta: {}, finish_reason: 'stop' });
    // usage arrives after the finish chunk, on a chunk with no choices
    expect(chunks[5]).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
    expect(frames(text).at(-1)).toBe('[DONE]');
  });

  it('is byte-identical on a replay and uses numbered ids', async () => {
    const first = await (await ask(replayOf('r'), 'r')).text();
    const second = await (await ask(replayOf('r'), 'r')).text();
    expect(first).toBe(second);
    expect(first).toContain('"id":"chatcmpl-qa-1"');
  });

  it('splits tool-call arguments over several deltas that reassemble', async () => {
    const args = { city: 'Gdańsk', note: 'a long enough argument to need several pieces' };
    const llm = new modules.FakeLlm([
      fixture('t', [{ toolCalls: [{ id: 'call_1', name: 'lookup', arguments: args }] }]),
    ]);
    const chunks = chunksOf(await (await ask(llm, 't')).text());
    const deltas = toolDeltas(chunks);

    expect(deltas[0]?.name).toBe('lookup');
    expect(deltas.length).toBeGreaterThan(3);
    expect(JSON.parse(deltas.map((delta) => delta.arguments).join(''))).toEqual(args);
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe('tool_calls');
  });

  it('sends a raw-string argument verbatim, which is how garbage is expressed', async () => {
    const llm = new modules.FakeLlm([
      fixture('raw', [{ toolCalls: [{ id: 'c', name: 'lookup', arguments: '{not json' }] }]),
    ]);
    expect(await (await ask(llm, 'raw')).text()).toContain('{not json');
  });
});

describe('fake-llm faults', () => {
  it('truncateArgumentsAt cuts the serialized arguments by bytes', async () => {
    const { text } = await runFault('trunc', {
      toolCalls: [{ id: 'c', name: 'lookup', arguments: { city: 'Gdańsk' } }],
      truncateArgumentsAt: 9,
    });
    const sent = toolDeltas(chunksOf(text))
      .map((delta) => delta.arguments)
      .join('');
    expect(sent).toBe('{"city":"');
  });

  it('errorFrameAt replaces the rest of the stream with an error frame', async () => {
    const { text } = await runFault('err', { content: ['one', 'two', 'three'], errorFrameAt: 3 });
    const all = frames(text);
    expect(all).toHaveLength(4);
    expect(errorFrameSchema.parse(all.at(-1)).error.type).toBe('fake_error');
    expect(text).not.toContain('[DONE]');
  });

  it('closeWithoutFinish drops both the finish reason and [DONE]', async () => {
    const { text } = await runFault('eof', { content: 'half', closeWithoutFinish: true });
    expect(text).toContain('half');
    expect(text).not.toContain('finish_reason":"stop"');
    expect(text).not.toContain('[DONE]');
  });

  it('omitDone keeps the finish reason and the usage but drops [DONE]', async () => {
    const { text } = await runFault('nodone', {
      content: 'whole',
      usage: { input: 1, output: 1 },
      omitDone: true,
    });
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain('total_tokens');
    expect(text).not.toContain('[DONE]');
  });

  it('finish: null keeps [DONE] but sends no finish reason', async () => {
    const { text } = await runFault('nofinish', { content: 'half', finish: null });
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(text).toContain('[DONE]');
  });

  it('destroyAfter fails the body read after the given frames', async () => {
    const llm = new modules.FakeLlm([
      fixture('boom', [{ content: ['a', 'b', 'c'], destroyAfter: 2 }]),
    ]);
    const response = await ask(llm, 'boom');
    await expect(response.text()).rejects.toThrow(/destroyed/);
    expect(llm.journal.list()[0]?.wire.split('\n\n').filter(Boolean)).toHaveLength(2);
  });

  it('delay paces the frames', async () => {
    const started = performance.now();
    await runFault('slow', { content: ['a', 'b'], delay: { chunkMs: 20 } });
    // role frame + two chunks + finish + [DONE] = five frames, 20 ms before each
    expect(performance.now() - started).toBeGreaterThanOrEqual(80);
  });

  it('http answers with the status and body instead of a completion', async () => {
    const { response, llm } = await runFault('http', {
      http: { status: 429, body: { error: { message: 'slow down' } } },
    });
    expect(response.status).toBe(429);
    expect(llm.journal.list()[0]).toMatchObject({ outcome: 'http-fault', fault: 'http' });
  });

  it('does not treat a switched-off flag as a stream fault', async () => {
    const llm = new modules.FakeLlm([fixture('off', [{ content: 'x', omitDone: false }])]);
    const response = await ask(llm, 'off', { stream: false });
    expect(response.status).toBe(200);
    expect(outcomeOf(response)).toBeNull();
  });

  it('writes nothing once the reader cancelled while the first frame was pending', async () => {
    const llm = new modules.FakeLlm([
      fixture('cut', [{ content: ['a', 'b'], delay: { chunkMs: 40 } }]),
    ]);
    const response = await ask(llm, 'cut');
    // the pull that waits out the delay of the first frame is already running
    await response.body?.cancel();
    // ... and must not resume to journal a frame nobody received
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(llm.journal.list()[0]?.wire).toBe('');
  });
  it('refuses a stream-only fault on a non-streaming request', async () => {
    const llm = new modules.FakeLlm([fixture('ns', [{ content: 'x', destroyAfter: 1 }])]);
    expect(outcomeOf(await ask(llm, 'ns', { stream: false }))).toBe('fault-not-applicable');
  });
});

describe('fake-llm non-streaming replies', () => {
  it('serves a completion object with tool calls and usage', async () => {
    const llm = new modules.FakeLlm([
      fixture('ns', [
        {
          toolCalls: [{ id: 'c1', name: 'lookup', arguments: { a: 1 } }],
          usage: { input: 4, output: 1 },
        },
      ]),
    ]);
    const body = await completion(llm, 'ns');
    expect(body.choices[0].message.content).toBeNull();
    expect(body.choices[0].message.tool_calls?.[0]?.function.arguments).toBe('{"a":1}');
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.usage).toEqual({ prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 });
  });

  it('omits usage when the turn declares none', async () => {
    const llm = new modules.FakeLlm([fixture('nu', [{ content: 'x' }])]);
    expect((await completion(llm, 'nu')).usage).toBeUndefined();
  });
});

describe('fake-llm journal', () => {
  it('records the request, the outcome and the bytes written, and resets', async () => {
    const llm = new modules.FakeLlm([
      fixture('j', [{ content: 'hi', usage: { input: 1, output: 1 } }]),
    ]);
    const body = {
      model: 'qa-fake',
      stream: true,
      stream_options: { include_usage: true },
      messages: [user('j')],
      tools,
    };
    const text = await (await post(llm, body)).text();

    const [entry] = llm.journal.list();
    expect(entry).toMatchObject({ id: 1, outcome: 'ok', fixture: 'T:j', turn: 0, fault: null });
    expect(requestSchema.parse(entry?.request).stream_options).toEqual({ include_usage: true });
    expect(entry?.wire).toBe(text);
    expect(entry?.conversation).toMatch(/^[0-9a-f]{16}$/);

    expect(llm.journal.get(1)).toBe(entry);
    const admin = await llm.handle(new Request('http://fake/__admin/journal'));
    expect(await admin.json()).toMatchObject({ entries: [{ id: 1 }] });
    expect((await llm.handle(new Request('http://fake/__admin/journal/9'))).status).toBe(404);

    await llm.handle(new Request('http://fake/__admin/reset', { method: 'POST' }));
    expect(llm.journal.list()).toHaveLength(0);
    // counters are reset too: the first turn is served again
    await ask(llm, 'j');
    expect(llm.journal.list()[0]).toMatchObject({ id: 1, turn: 0 });
  });
});

describe('fake-llm fixture validation', () => {
  const valid = {
    key: 'C-1:ok',
    case: 'C-1',
    match: { firstUserContains: 'x' },
    turns: [{ content: 'a' }],
  };
  const bad = (patch: Record<string, unknown>) => () =>
    modules.parseFixture({ ...valid, ...patch }, 'f.json');

  it('accepts a minimal fixture', () => {
    expect(modules.parseFixture(valid, 'f.json').key).toBe('C-1:ok');
  });

  it.each([
    ['a typo in a field name', bad({ turnz: [] }), /unknown field/],
    ['a key without the case prefix', bad({ key: 'ok' }), /<CASE>:<slug>/],
    ['a case that differs from the key prefix', bad({ case: 'C-2' }), /key prefix/],
    ['an empty match that would catch everything', bad({ match: {} }), /empty match/],
    ['no turns', bad({ turns: [] }), /non-empty array/],
    ['an unknown finish reason', bad({ turns: [{ finish: 'done' }] }), /finish/],
    ['an unknown turn field', bad({ turns: [{ contnet: 'x' }] }), /unknown field/],
    [
      'two stream faults on one turn',
      bad({ turns: [{ content: 'x', destroyAfter: 1, omitDone: true }] }),
      /at most one stream fault/,
    ],
    [
      'a stream fault on a non-streaming turn',
      bad({ turns: [{ content: 'x', stream: false, destroyAfter: 1 }] }),
      /needs a streaming reply/,
    ],
    [
      'an http fault mixed with content',
      bad({ turns: [{ content: 'x', http: { status: 500 } }] }),
      /replaces the whole reply/,
    ],
    [
      'an http status that is not an error',
      bad({ turns: [{ http: { status: 200 } }] }),
      /4xx or 5xx/,
    ],
    [
      'truncation without tool calls',
      bad({ turns: [{ content: 'x', truncateArgumentsAt: 2 }] }),
      /needs toolCalls/,
    ],
    [
      'non-object tool arguments',
      bad({ turns: [{ toolCalls: [{ id: 'a', name: 'n', arguments: 5 }] }] }),
      /raw string/,
    ],
  ])('rejects %s', (_label, parse, message) => {
    expect(parse).toThrow(message);
  });

  it('accepts a switched-off stream fault on a non-streaming turn', () => {
    const turn = { content: 'x', stream: false, omitDone: false };
    expect(() => modules.parseFixture({ ...valid, turns: [turn] }, 'f.json')).not.toThrow();
  });

  it('still counts a numeric stream fault of zero', () => {
    const turn = { content: 'x', stream: false, errorFrameAt: 0 };
    expect(() => modules.parseFixture({ ...valid, turns: [turn] }, 'f.json')).toThrow(
      /needs a streaming reply/,
    );
  });

  it('names the file and the path of the problem', () => {
    expect(bad({ match: { lastUserContains: 3 } })).toThrow(/f\.json: \$\.match\.lastUserContains/);
  });
});
