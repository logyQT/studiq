import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Delay, FinishReason, Fixture, Match, ToolCall, Turn, Usage } from './types';

/** A fixture file that does not satisfy the contract: names the file and the path inside it. */
export class FixtureError extends Error {
  constructor(source: string, path: string, message: string) {
    super(`${source}: ${path}: ${message}`);
    this.name = 'FixtureError';
  }
}

const FINISH_REASONS: readonly string[] = [
  'stop',
  'tool_calls',
  'length',
  'content_filter',
  'error',
];

const MATCH_KEYS = [
  'firstUserContains',
  'lastUserContains',
  'systemContains',
  'hasToolResult',
  'hasTools',
  'messageCount',
  'model',
] as const;

const TURN_KEYS = [
  'match',
  'content',
  'reasoning',
  'toolCalls',
  'finish',
  'usage',
  'stream',
  'http',
  'truncateArgumentsAt',
  'errorFrameAt',
  'closeWithoutFinish',
  'omitDone',
  'destroyAfter',
  'delay',
] as const;

/** Faults that shape an SSE stream; they make no sense for a non-streaming reply. */
export const STREAM_ONLY_FAULTS = [
  'errorFrameAt',
  'closeWithoutFinish',
  'omitDone',
  'destroyAfter',
] as const;

const KEY_PATTERN = /^[A-Za-z0-9-]+:[a-z0-9][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Reader {
  constructor(private readonly source: string) {}

  fail(path: string, message: string): never {
    throw new FixtureError(this.source, path, message);
  }

  record(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) return this.fail(path, 'expected an object');
    return value;
  }

  /** Rejects keys outside `allowed`, so a typo fails at boot instead of matching nothing. */
  known(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key))
        this.fail(`${path}.${key}`, `unknown field (allowed: ${allowed.join(', ')})`);
    }
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string' || value === '')
      return this.fail(path, 'expected a non-empty string');
    return value;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') return this.fail(path, 'expected a boolean');
    return value;
  }

  count(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return this.fail(path, 'expected a non-negative integer');
    }
    return value;
  }

  text(value: unknown, path: string): string | string[] {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value.map(String);
    }
    return this.fail(path, 'expected a string or an array of strings');
  }
}

function readMatch(r: Reader, value: unknown, path: string): Match {
  const raw = r.record(value, path);
  r.known(raw, MATCH_KEYS, path);
  const match: Match = {};
  if (raw.firstUserContains !== undefined)
    match.firstUserContains = r.string(raw.firstUserContains, `${path}.firstUserContains`);
  if (raw.lastUserContains !== undefined)
    match.lastUserContains = r.string(raw.lastUserContains, `${path}.lastUserContains`);
  if (raw.systemContains !== undefined)
    match.systemContains = r.string(raw.systemContains, `${path}.systemContains`);
  if (raw.hasToolResult !== undefined)
    match.hasToolResult = r.boolean(raw.hasToolResult, `${path}.hasToolResult`);
  if (raw.hasTools !== undefined) match.hasTools = r.boolean(raw.hasTools, `${path}.hasTools`);
  if (raw.messageCount !== undefined)
    match.messageCount = r.count(raw.messageCount, `${path}.messageCount`);
  if (raw.model !== undefined) match.model = r.string(raw.model, `${path}.model`);
  return match;
}

function readToolCalls(r: Reader, value: unknown, path: string): ToolCall[] {
  if (!Array.isArray(value) || value.length === 0)
    return r.fail(path, 'expected a non-empty array');
  return value.map((item: unknown, index) => {
    const at = `${path}[${index}]`;
    const raw = r.record(item, at);
    r.known(raw, ['id', 'name', 'arguments'], at);
    const args = raw.arguments;
    if (typeof args !== 'string' && !isRecord(args)) {
      return r.fail(`${at}.arguments`, 'expected an object or a raw string');
    }
    return {
      id: r.string(raw.id, `${at}.id`),
      name: r.string(raw.name, `${at}.name`),
      arguments: args,
    };
  });
}

function readUsage(r: Reader, value: unknown, path: string): Usage {
  const raw = r.record(value, path);
  r.known(raw, ['input', 'output'], path);
  return {
    input: r.count(raw.input, `${path}.input`),
    output: r.count(raw.output, `${path}.output`),
  };
}

function readDelay(r: Reader, value: unknown, path: string): Delay {
  const raw = r.record(value, path);
  r.known(raw, ['chunkMs', 'firstChunkMs'], path);
  const delay: Delay = {};
  if (raw.chunkMs !== undefined) delay.chunkMs = r.count(raw.chunkMs, `${path}.chunkMs`);
  if (raw.firstChunkMs !== undefined)
    delay.firstChunkMs = r.count(raw.firstChunkMs, `${path}.firstChunkMs`);
  return delay;
}

function readFinish(r: Reader, value: unknown, path: string): FinishReason | null {
  if (value === null) return null;
  if (typeof value === 'string' && FINISH_REASONS.includes(value)) {
    // `includes` narrowed `value` to a string only; the list above is the union.
    return value as FinishReason;
  }
  return r.fail(path, `expected null or one of ${FINISH_REASONS.join(', ')}`);
}

function readTurn(r: Reader, value: unknown, path: string): Turn {
  const raw = r.record(value, path);
  r.known(raw, TURN_KEYS, path);
  const turn: Turn = {};
  if (raw.match !== undefined) turn.match = readMatch(r, raw.match, `${path}.match`);
  if (raw.content !== undefined) turn.content = r.text(raw.content, `${path}.content`);
  if (raw.reasoning !== undefined) turn.reasoning = r.text(raw.reasoning, `${path}.reasoning`);
  if (raw.toolCalls !== undefined)
    turn.toolCalls = readToolCalls(r, raw.toolCalls, `${path}.toolCalls`);
  if (raw.finish !== undefined) turn.finish = readFinish(r, raw.finish, `${path}.finish`);
  if (raw.usage !== undefined) turn.usage = readUsage(r, raw.usage, `${path}.usage`);
  if (raw.stream !== undefined) turn.stream = r.boolean(raw.stream, `${path}.stream`);
  if (raw.truncateArgumentsAt !== undefined)
    turn.truncateArgumentsAt = r.count(raw.truncateArgumentsAt, `${path}.truncateArgumentsAt`);
  if (raw.errorFrameAt !== undefined)
    turn.errorFrameAt = r.count(raw.errorFrameAt, `${path}.errorFrameAt`);
  if (raw.closeWithoutFinish !== undefined)
    turn.closeWithoutFinish = r.boolean(raw.closeWithoutFinish, `${path}.closeWithoutFinish`);
  if (raw.omitDone !== undefined) turn.omitDone = r.boolean(raw.omitDone, `${path}.omitDone`);
  if (raw.destroyAfter !== undefined)
    turn.destroyAfter = r.count(raw.destroyAfter, `${path}.destroyAfter`);
  if (raw.delay !== undefined) turn.delay = readDelay(r, raw.delay, `${path}.delay`);
  if (raw.http !== undefined) {
    const http = r.record(raw.http, `${path}.http`);
    r.known(http, ['status', 'body'], `${path}.http`);
    const status = r.count(http.status, `${path}.http.status`);
    if (status < 400 || status > 599) r.fail(`${path}.http.status`, 'expected a 4xx or 5xx status');
    turn.http = http.body === undefined ? { status } : { status, body: http.body };
  }

  const streamFaults = STREAM_ONLY_FAULTS.filter((name) => turn[name] !== undefined);
  if (streamFaults.length > 1)
    r.fail(path, `at most one stream fault per turn, got ${streamFaults.join(', ')}`);
  if (turn.stream === false && streamFaults.length > 0) {
    r.fail(path, `${streamFaults.join(', ')} needs a streaming reply, but stream is false`);
  }
  if (
    turn.http &&
    (turn.content !== undefined ||
      turn.toolCalls ||
      streamFaults.length > 0 ||
      turn.truncateArgumentsAt !== undefined)
  ) {
    r.fail(
      `${path}.http`,
      'an http fault replaces the whole reply; drop the content and the other faults',
    );
  }
  if (turn.truncateArgumentsAt !== undefined && !turn.toolCalls) {
    r.fail(`${path}.truncateArgumentsAt`, 'needs toolCalls');
  }
  return turn;
}

/**
 * Validates one parsed fixture file; `source` is only used in error messages.
 *
 * @public Only the unit tests call it directly (they load this module by file URL).
 */
export function parseFixture(value: unknown, source: string): Fixture {
  const r = new Reader(source);
  const raw = r.record(value, '$');
  r.known(raw, ['key', 'case', 'match', 'maxTurns', 'turns'], '$');

  const key = r.string(raw.key, '$.key');
  if (!KEY_PATTERN.test(key))
    r.fail('$.key', 'expected "<CASE>:<slug>", e.g. "CASE-01:happy-path"');
  const caseId = r.string(raw.case, '$.case');
  if (key.split(':')[0] !== caseId)
    r.fail('$.case', `must equal the key prefix "${key.split(':')[0]}"`);

  const match = readMatch(r, raw.match, '$.match');
  if (Object.keys(match).length === 0) {
    r.fail('$.match', 'an empty match would catch every request; name at least one field');
  }
  if (!Array.isArray(raw.turns) || raw.turns.length === 0)
    r.fail('$.turns', 'expected a non-empty array');
  const turns = (raw.turns as unknown[]).map((turn, index) =>
    readTurn(r, turn, `$.turns[${index}]`),
  );

  const fixture: Fixture = { key, case: caseId, match, turns };
  if (raw.maxTurns !== undefined) {
    const maxTurns = r.count(raw.maxTurns, '$.maxTurns');
    if (maxTurns < 1) r.fail('$.maxTurns', 'expected at least 1');
    fixture.maxTurns = maxTurns;
  }
  return fixture;
}

/** Loads every `*.json` file of `dir`, sorted by name; a duplicate key is an error. */
export function loadFixtures(dir: string): Fixture[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const fixtures: Fixture[] = [];
  const seen = new Map<string, string>();
  for (const name of files) {
    const source = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(source, 'utf8'));
    } catch (error) {
      throw new FixtureError(
        source,
        '$',
        `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const fixture = parseFixture(parsed, source);
    const first = seen.get(fixture.key);
    if (first)
      throw new FixtureError(source, '$.key', `duplicate key "${fixture.key}" (also in ${first})`);
    seen.set(fixture.key, source);
    fixtures.push(fixture);
  }
  return fixtures;
}
