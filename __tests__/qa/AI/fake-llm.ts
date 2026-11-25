import { z } from 'zod';

/**
 * Client of the fake inference server (`scripts/fake-llm`, started by
 * `bun run mock:llm`). A spec resets it before each test, then reads the journal
 * to assert what the app sent to the model and what the model "answered".
 *
 * The URL is a constant: `scripts/fake-llm/server.ts` listens on this port by
 * default and the CI job passes no override, so there is nothing to configure.
 */
const FAKE_LLM_URL = 'http://127.0.0.1:4321';

const entrySchema = z.object({
  id: z.number(),
  outcome: z.string(),
  fixture: z.string().nullable(),
  conversation: z.string().nullable(),
  turn: z.number().nullable(),
  fault: z.string().nullable(),
  request: z.unknown(),
  /** The exact bytes the engine wrote to the app. */
  wire: z.string(),
});
export type JournalEntry = z.infer<typeof entrySchema>;

/** The shape of a chat-completions request that the specs look at. */
const requestSchema = z.object({
  stream: z.boolean().optional(),
  tools: z.array(z.unknown()).optional(),
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() }).passthrough()),
});

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${FAKE_LLM_URL}${path}`, init);
  if (!response.ok) throw new Error(`fake-llm ${path} -> ${response.status}`);
  const body: unknown = await response.json();
  return body;
}

export const fakeLlm = {
  /** Clears the journal and every per-conversation turn counter. */
  async reset(): Promise<void> {
    await call('/__admin/reset', { method: 'POST' });
  },

  /** Every request the app made since the last reset, oldest first. */
  async journal(): Promise<JournalEntry[]> {
    const body = z.object({ entries: z.array(entrySchema) }).parse(await call('/__admin/journal'));
    return body.entries;
  },

  /** The requests of one fixture, e.g. `STU-48:material-path`. */
  async requestsOf(fixture: string): Promise<JournalEntry[]> {
    return (await this.journal()).filter((entry) => entry.fixture === fixture);
  },
};

/** The roles of the messages the app sent in one request, in order. */
export function rolesOf(entry: JournalEntry): string[] {
  return requestSchema.parse(entry.request).messages.map((message) => message.role);
}

const toolCallDeltas = z.object({
  choices: z.array(
    z.object({
      delta: z.object({
        tool_calls: z
          .array(
            z.object({
              index: z.number(),
              function: z.object({ arguments: z.string().optional() }),
            }),
          )
          .optional(),
      }),
    }),
  ),
});

/**
 * The arguments of each tool call as the app received them, reassembled from the SSE
 * deltas of the journaled reply, in call order. A truncated call shows up here as a
 * string that is not valid JSON.
 */
export function toolArgumentsOf(entry: JournalEntry): string[] {
  const calls = new Map<number, string>();
  for (const frame of entry.wire.split('\n\n')) {
    const data = frame.replace(/^data: /, '');
    if (data === '' || data === '[DONE]') continue;
    const payload: unknown = JSON.parse(data);
    const parsed = toolCallDeltas.safeParse(payload);
    if (!parsed.success) continue;
    for (const choice of parsed.data.choices) {
      for (const toolCall of choice.delta.tool_calls ?? []) {
        calls.set(
          toolCall.index,
          (calls.get(toolCall.index) ?? '') + (toolCall.function.arguments ?? ''),
        );
      }
    }
  }
  return [...calls.entries()].toSorted(([a], [b]) => a - b).map(([, args]) => args);
}

/** Whether the app asked for a streamed reply. */
export function wasStreamed(entry: JournalEntry): boolean {
  return requestSchema.parse(entry.request).stream === true;
}
