import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient, mockUser } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { type FakeLlmApi, loadFakeLlm } from '#test/unit/qa/fake-llm-load';
import { POST as chatPost } from '@/app/(backend)/api/v1/ai/chat/route';

/**
 * The route against the real model client of the app, with the model replaced by the fake
 * inference server (`scripts/fake-llm`) running in this process. What the model receives is read
 * from the server's journal: a slash command becomes an instruction in the system prompt, and the
 * messages the model gets stay exactly what the user typed.
 */

// `model.ts` reads these when it is imported, which happens with the route below.
const FAKE_BASE_URL = vi.hoisted(() => {
  process.env.LLM_PROVIDER = 'fake';
  process.env.LLM_API_KEY = 'qa-fake-key';
  process.env.LLM_MODEL_NAME = 'qa-fake';
  process.env.LLM_BASE_URL = 'http://fake-llm.test/v1';
  return 'http://fake-llm.test/';
});

const sentSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
});

let teacher!: BeforeResult;
let llm!: FakeLlmApi;
const realFetch = globalThis.fetch;

/** Sends a transcript to the chat route and returns what the model was asked. */
async function ask(transcript: { role: 'user' | 'assistant'; text: string }[]) {
  mockUser(teacher.user);
  const response = await chatPost(
    createNextRequest(
      'http://localhost/api/v1/ai/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: transcript.map((entry, index) => ({
            id: `m${index}`,
            role: entry.role,
            parts: [{ type: 'text', text: entry.text }],
          })),
        }),
      },
      { active_org_id: teacher.orgId ?? '' },
    ),
  );
  // Reading the stream to its end lets the route finish (usage tracking runs in `onFinish`).
  const body = await response.text();

  const [entry] = llm.journal.list();
  const sent = sentSchema.parse(entry?.request);
  const system = sent.messages.find((message) => message.role === 'system')?.content;
  const users = sent.messages.filter((message) => message.role === 'user');
  return {
    status: response.status,
    body,
    system: typeof system === 'string' ? system : '',
    lastUser: users.at(-1)?.content,
    requests: llm.journal.list().length,
  };
}

describe('AI chat route: slash commands (#1150)', () => {
  beforeAll(async () => {
    const modules = await loadFakeLlm();
    llm = new modules.FakeLlm([
      {
        key: 'CMD:any',
        case: 'CMD',
        match: { hasTools: true },
        maxTurns: 50,
        turns: [{ content: 'A model answer.' }],
      },
    ]);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.url.startsWith(FAKE_BASE_URL) ? llm.handle(request) : realFetch(input, init);
    });

    teacher = await before({ role: 'educator', org: `ai-command-org-${Date.now()}` });
    // A finite daily AI budget, or the route answers USAGE_LIMIT_EXCEEDED before any model call.
    const { error } = await createServiceClient().rpc('apply_org_plan', {
      p_org_id: teacher.orgId ?? '',
      p_plan: 'hub',
    });
    if (error) throw new Error(`[setup] plan failed: ${error.message}`);
  });

  beforeEach(() => {
    llm.reset();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
  });

  it('gives the model the instruction of /explain and the message as typed', async () => {
    const result = await ask([{ role: 'user', text: '/explain photosynthesis' }]);

    expect(result.status).toBe(200);
    expect(result.body).toContain('A model answer.');
    expect(result.system).toContain('The user invoked the /explain command');
    expect(result.system).toContain('photosynthesis');
    // The base prompt is still there; the instruction is added to it.
    expect(result.system).toContain("StudiQ's built-in AI assistant");
    // The conversation the model sees is the user's own text, not the expanded instruction.
    expect(result.lastUser).toBe('/explain photosynthesis');
  });

  it('asks which concept when /explain has no argument', async () => {
    const result = await ask([{ role: 'user', text: '/explain' }]);

    expect(result.system).toContain('without naming a concept');
    expect(result.system).not.toContain('for this concept:');
  });

  it('treats a retry like the first send: the transcript is all the server needs', async () => {
    const result = await ask([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Hi! How can I help?' },
      { role: 'user', text: '/explain osmosis' },
    ]);

    expect(result.system).toContain('osmosis');
  });

  it.each([
    ['an ordinary message', [{ role: 'user' as const, text: 'explain photosynthesis' }]],
    ['a slash in the middle', [{ role: 'user' as const, text: 'what is 1/2 of 10' }]],
    ['an unknown command', [{ role: 'user' as const, text: '/nope photosynthesis' }]],
    [
      'the next message after a command',
      [
        { role: 'user' as const, text: '/explain osmosis' },
        { role: 'assistant' as const, text: 'Osmosis is ...' },
        { role: 'user' as const, text: 'thanks, and diffusion?' },
      ],
    ],
  ])('adds no instruction for %s', async (_label, transcript) => {
    const result = await ask(transcript);

    expect(result.status).toBe(200);
    expect(result.system).toContain("StudiQ's built-in AI assistant");
    expect(result.system).not.toContain('invoked the /explain command');
  });
});
