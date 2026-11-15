import { z } from 'zod';

/**
 * Schemas for what the fake server writes and what the app sends, so the tests
 * read the wire through a parse instead of a type assertion.
 */

const usageSchema = z.record(z.string(), z.number());

export const chunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.record(z.string(), z.unknown()),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: usageSchema.optional(),
});
export type Chunk = z.infer<typeof chunkSchema>;

export const errorFrameSchema = z.object({
  error: z.object({ type: z.string(), message: z.string() }),
});

const toolCallDeltaSchema = z.object({
  tool_calls: z.array(
    z.object({
      index: z.number(),
      id: z.string().optional(),
      function: z.object({ name: z.string().optional(), arguments: z.string().optional() }),
    }),
  ),
});

export const completionSchema = z.object({
  object: z.literal('chat.completion'),
  choices: z.tuple([
    z.object({
      message: z.object({
        content: z.string().nullable(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              function: z.object({ name: z.string(), arguments: z.string() }),
            }),
          )
          .optional(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ]),
  usage: usageSchema.optional(),
});

/** What the engine reads out of a request, as far as the tests care. */
export const requestSchema = z.object({
  stream: z.boolean().optional(),
  stream_options: z.unknown().optional(),
  tools: z.array(z.unknown()).optional(),
  messages: z.array(z.object({ role: z.string() })),
});

/** The payload of every SSE frame, with the terminator kept as the string `[DONE]`. */
export function frames(text: string): unknown[] {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame): unknown => {
      const data = frame.replace(/^data: /, '');
      if (data === '[DONE]') return data;
      const parsed: unknown = JSON.parse(data);
      return parsed;
    });
}

/** The chat-completion chunks of a stream, in order; `[DONE]` and error frames are skipped. */
export function chunksOf(text: string): Chunk[] {
  return frames(text).flatMap((frame) => {
    const parsed = chunkSchema.safeParse(frame);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Every tool-call delta of a stream, flattened. */
export function toolDeltas(chunks: Chunk[]): { name?: string; arguments: string }[] {
  return chunks.flatMap((chunk) =>
    chunk.choices.flatMap((choice) => {
      const parsed = toolCallDeltaSchema.safeParse(choice.delta);
      return parsed.success
        ? parsed.data.tool_calls.map((call) => ({
            name: call.function.name,
            arguments: call.function.arguments ?? '',
          }))
        : [];
    }),
  );
}
