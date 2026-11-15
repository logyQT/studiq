import type { FinishReason, Turn } from './types';

/** Fixed so a replayed conversation is byte-identical from run to run. */
const CREATED = 1_700_000_000;

/** Arguments are sent in pieces this long, so a client has to reassemble them. */
const ARGUMENT_PIECE = 24;

const encoder = new TextEncoder();

export interface ReplyContext {
  id: string;
  model: string;
}

/** The frames of a streaming reply, and how the connection ends after them. */
export interface StreamPlan {
  frames: string[];
  ending: 'close' | 'destroy';
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

const asList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

/** `arguments` as the string that goes on the wire, truncated by a fault if asked. */
function serializeArguments(
  args: string | Record<string, unknown>,
  truncateAt: number | undefined,
): string {
  const full = typeof args === 'string' ? args : JSON.stringify(args);
  if (truncateAt === undefined) return full;
  const bytes = encoder.encode(full);
  if (truncateAt >= bytes.length) return full;
  // Cutting inside a multi-byte character yields U+FFFD, like a real cut stream.
  return new TextDecoder().decode(bytes.subarray(0, truncateAt));
}

function finishReasonOf(turn: Turn): FinishReason | null {
  if (turn.finish !== undefined) return turn.finish;
  return turn.toolCalls?.length ? 'tool_calls' : 'stop';
}

const usageBody = (usage: NonNullable<Turn['usage']>) => ({
  prompt_tokens: usage.input,
  completion_tokens: usage.output,
  total_tokens: usage.input + usage.output,
});

/** Name of the fault a turn carries, for the journal. */
export function faultOf(turn: Turn): string | null {
  if (turn.http) return 'http';
  if (turn.truncateArgumentsAt !== undefined) return 'truncateArgumentsAt';
  if (turn.errorFrameAt !== undefined) return 'errorFrameAt';
  if (turn.closeWithoutFinish) return 'closeWithoutFinish';
  if (turn.omitDone) return 'omitDone';
  if (turn.destroyAfter !== undefined) return 'destroyAfter';
  if (turn.delay) return 'delay';
  return null;
}

/** Builds the SSE frames of one turn. Pure: the same turn always gives the same bytes. */
export function planStream(turn: Turn, ctx: ReplyContext): StreamPlan {
  const chunk = (delta: Record<string, unknown>, finishReason: FinishReason | null = null) =>
    sse({
      id: ctx.id,
      object: 'chat.completion.chunk',
      created: CREATED,
      model: ctx.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });

  const body: string[] = [chunk({ role: 'assistant', content: '' })];
  for (const piece of asList(turn.reasoning)) body.push(chunk({ reasoning_content: piece }));
  for (const piece of asList(turn.content)) body.push(chunk({ content: piece }));
  (turn.toolCalls ?? []).forEach((call, index) => {
    body.push(
      chunk({
        tool_calls: [
          { index, id: call.id, type: 'function', function: { name: call.name, arguments: '' } },
        ],
      }),
    );
    const args = serializeArguments(call.arguments, turn.truncateArgumentsAt);
    for (let at = 0; at < args.length; at += ARGUMENT_PIECE) {
      body.push(
        chunk({
          tool_calls: [{ index, function: { arguments: args.slice(at, at + ARGUMENT_PIECE) } }],
        }),
      );
    }
  });

  const tail: string[] = [];
  const finish = finishReasonOf(turn);
  if (finish !== null) tail.push(chunk({}, finish));
  if (turn.usage) {
    tail.push(
      sse({
        id: ctx.id,
        object: 'chat.completion.chunk',
        created: CREATED,
        model: ctx.model,
        choices: [],
        usage: usageBody(turn.usage),
      }),
    );
  }
  tail.push('data: [DONE]\n\n');

  if (turn.closeWithoutFinish) return { frames: body, ending: 'close' };
  if (turn.omitDone) return { frames: [...body, ...tail.slice(0, -1)], ending: 'close' };
  if (turn.errorFrameAt !== undefined) {
    const error = sse({ error: { message: 'fake provider error', type: 'fake_error' } });
    return { frames: [...body.slice(0, turn.errorFrameAt), error], ending: 'close' };
  }
  if (turn.destroyAfter !== undefined) {
    return { frames: [...body, ...tail].slice(0, turn.destroyAfter), ending: 'destroy' };
  }
  return { frames: [...body, ...tail], ending: 'close' };
}

/** The non-streaming completion body of a turn. */
export function renderCompletion(turn: Turn, ctx: ReplyContext): string {
  const content = asList(turn.content).join('');
  const reasoning = asList(turn.reasoning).join('');
  const toolCalls = (turn.toolCalls ?? []).map((call) => ({
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: serializeArguments(call.arguments, turn.truncateArgumentsAt),
    },
  }));
  return JSON.stringify({
    id: ctx.id,
    object: 'chat.completion',
    created: CREATED,
    model: ctx.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content === '' && toolCalls.length > 0 ? null : content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReasonOf(turn),
      },
    ],
    ...(turn.usage ? { usage: usageBody(turn.usage) } : {}),
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface StreamHooks {
  /** Called with every frame right before it is written. */
  onFrame: (frame: string) => void;
  /** Called once, when the stream closed, was destroyed or was cancelled by the client. */
  onEnd: () => void;
}

/** Turns a plan into the response body, pacing frames by `delay` and ending as planned. */
export function openStream(
  plan: StreamPlan,
  delay: Turn['delay'],
  hooks: StreamHooks,
): ReadableStream<Uint8Array> {
  let next = 0;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    hooks.onEnd();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= plan.frames.length) {
        if (plan.ending === 'destroy') {
          // Give the last frame a moment to leave before the connection drops.
          await sleep(10);
          end();
          controller.error(new Error('fake-llm: connection destroyed'));
          return;
        }
        end();
        controller.close();
        return;
      }
      const wait = next === 0 ? (delay?.firstChunkMs ?? delay?.chunkMs) : delay?.chunkMs;
      if (wait) await sleep(wait);
      const frame = plan.frames[next++];
      if (frame === undefined) return;
      hooks.onFrame(frame);
      controller.enqueue(encoder.encode(frame));
    },
    cancel() {
      end();
    },
  });
}
