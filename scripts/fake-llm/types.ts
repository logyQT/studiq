/**
 * Shapes shared by the fake inference engine and its fixtures.
 *
 * The engine knows HTTP, SSE and the chat-completions wire format. Nothing in
 * `scripts/fake-llm/*.ts` may name a product concept (tools, entities, copy):
 * those belong in the fixture files under `cases/` and in the specs. The unit
 * test `fake-llm-contract.test.ts` enforces that.
 */

/** Wire-level facts of a request that a fixture may key on. */
export interface Match {
  /** Substring of the first `user` message. */
  firstUserContains?: string;
  /** Substring of the last `user` message. */
  lastUserContains?: string;
  /** Substring of the concatenated `system` / `developer` messages. */
  systemContains?: string;
  /** The last message is a `tool` result. */
  hasToolResult?: boolean;
  /** The request declares at least one tool (an outer call, not a nested one). */
  hasTools?: boolean;
  /** Exact number of messages in the request. */
  messageCount?: number;
  /** Exact `model` value of the request. */
  model?: string;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';

export interface ToolCall {
  id: string;
  name: string;
  /**
   * An object is serialized with `JSON.stringify`. A string is sent verbatim,
   * which is how truncated or garbage arguments are expressed.
   */
  arguments: string | Record<string, unknown>;
}

export interface Delay {
  /** Pause between two SSE frames, in milliseconds. */
  chunkMs?: number;
  /** Pause before the first frame (falls back to `chunkMs`). */
  firstChunkMs?: number;
}

export interface Usage {
  input: number;
  output: number;
}

/**
 * One scripted model response. `match` is a guard, not a selector: a request
 * that does not satisfy it is an engine error (`turn-mismatch`), never a
 * silent fallback.
 */
export interface Turn {
  match?: Match;
  /** A string is one chunk; an array is one chunk per element. */
  content?: string | string[];
  reasoning?: string | string[];
  toolCalls?: ToolCall[];
  /**
   * `null` sends `[DONE]` without any `finish_reason`. Omitted means `tool_calls`
   * when the turn has tool calls and `stop` otherwise.
   */
  finish?: FinishReason | null;
  /** Omit to reproduce a provider that reports no usage. */
  usage?: Usage;
  /** Guard on the request's `stream` flag; the response shape follows the request. */
  stream?: boolean;

  // ── faults ───────────────────────────────────────────────────────────────
  /** Answer with this status and body instead of a completion. */
  http?: { status: number; body?: unknown };
  /** Cut every tool call's serialized arguments after this many UTF-8 bytes. */
  truncateArgumentsAt?: number;
  /** Replace the stream after this many body frames with an `{"error": …}` frame. */
  errorFrameAt?: number;
  /** End the stream without `finish_reason` and without `[DONE]`. */
  closeWithoutFinish?: boolean;
  /** Send the finish reason (and usage) but end the stream without `[DONE]`. */
  omitDone?: boolean;
  /** Reset the connection after this many frames. */
  destroyAfter?: number;
  delay?: Delay;
}

export interface Fixture {
  /** `<CASE>:<slug>`, unique across the fixtures directory. */
  key: string;
  case: string;
  match: Match;
  /** Requests served before the engine reports `overrun` (default 40). */
  maxTurns?: number;
  /** Served in order; the last turn repeats. */
  turns: Turn[];
}

export type Outcome =
  | 'ok'
  | 'http-fault'
  | 'unmatched'
  | 'ambiguous'
  | 'overrun'
  | 'turn-mismatch'
  | 'fault-not-applicable'
  | 'bad-request';

export interface JournalEntry {
  id: number;
  outcome: Outcome;
  fixture: string | null;
  /** Hash of the first user message: what keeps parallel tests apart. */
  conversation: string | null;
  turn: number | null;
  fault: string | null;
  request: unknown;
  /** The exact bytes written to the client, concatenated. */
  wire: string;
  durationMs: number;
}
