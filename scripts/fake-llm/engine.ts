import { createHash } from 'node:crypto';
import { activeStreamFaults } from './fixtures';
import { Journal } from './journal';
import { faultOf, openStream, planStream, renderCompletion } from './stream';
import type { Fixture, JournalEntry, Match, Outcome, Turn } from './types';

const DEFAULT_MAX_TURNS = 40;

/** What the engine reads from a chat-completions request. */
export interface Wire {
  model: string | null;
  stream: boolean;
  system: string;
  firstUser: string;
  lastUser: string;
  hasToolResult: boolean;
  hasTools: boolean;
  messageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Message content is a string or a list of parts; only text parts count. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/** Reads the wire-level facts out of a request body; `null` when it is not a chat request. */
function readWire(body: unknown): Wire | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const messages = body.messages.filter(isRecord);
  const withRole = (...roles: string[]) => messages.filter((m) => roles.includes(String(m.role)));
  const users = withRole('user');
  const last = messages[messages.length - 1];
  return {
    model: typeof body.model === 'string' ? body.model : null,
    stream: body.stream === true,
    system: withRole('system', 'developer')
      .map((m) => textOf(m.content))
      .join('\n'),
    firstUser: textOf(users[0]?.content),
    lastUser: textOf(users[users.length - 1]?.content),
    hasToolResult: last !== undefined && last.role === 'tool',
    hasTools: Array.isArray(body.tools) && body.tools.length > 0,
    messageCount: messages.length,
  };
}

/** Every field a match names must hold; an empty match holds for everything. */
function matches(match: Match, wire: Wire): boolean {
  if (match.firstUserContains !== undefined && !wire.firstUser.includes(match.firstUserContains))
    return false;
  if (match.lastUserContains !== undefined && !wire.lastUser.includes(match.lastUserContains))
    return false;
  if (match.systemContains !== undefined && !wire.system.includes(match.systemContains))
    return false;
  if (match.hasToolResult !== undefined && match.hasToolResult !== wire.hasToolResult) return false;
  if (match.hasTools !== undefined && match.hasTools !== wire.hasTools) return false;
  if (match.messageCount !== undefined && match.messageCount !== wire.messageCount) return false;
  if (match.model !== undefined && match.model !== wire.model) return false;
  return true;
}

/** More named fields means a more specific match. */
const specificity = (match: Match): number => Object.keys(match).length;

const conversationKey = (wire: Wire): string =>
  createHash('sha256').update(wire.firstUser).digest('hex').slice(0, 16);

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export class FakeLlm {
  readonly journal = new Journal();
  /** Requests served so far, per conversation and fixture. */
  private counters = new Map<string, Map<string, number>>();

  constructor(private readonly fixtures: readonly Fixture[]) {}

  /** Forgets every counter and journal entry; call it between tests. */
  reset(): void {
    this.counters.clear();
    this.journal.reset();
  }

  async handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === '/healthz' && method === 'GET') {
      return json(200, { status: 'ok', fixtures: this.fixtures.length });
    }
    if (pathname === '/v1/models' && method === 'GET') {
      return json(200, {
        object: 'list',
        data: [{ id: 'qa-fake', object: 'model', owned_by: 'fake-llm' }],
      });
    }
    if (pathname === '/__admin/reset' && method === 'POST') {
      this.reset();
      return json(200, { status: 'reset' });
    }
    if (pathname === '/__admin/journal' && method === 'GET') {
      return json(200, { entries: this.journal.list() });
    }
    const entryMatch = /^\/__admin\/journal\/(\d+)$/.exec(pathname);
    if (entryMatch && method === 'GET') {
      const entry = this.journal.get(Number(entryMatch[1]));
      return entry ? json(200, entry) : json(404, { error: { message: 'no such journal entry' } });
    }
    if (pathname === '/v1/chat/completions' && method === 'POST') {
      return this.completion(request);
    }
    return json(404, { error: { message: `no route for ${method} ${pathname}` } });
  }

  private async completion(request: Request): Promise<Response> {
    const startedAt = performance.now();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.refuse('bad-request', 400, 'the request body is not valid JSON', {
        request: null,
      });
    }
    const wire = readWire(body);
    if (!wire) {
      return this.refuse('bad-request', 400, 'expected a chat-completions body with messages', {
        request: body,
      });
    }

    // A nested call (no tools) retries three times on a 5xx, so it gets a 400.
    const failStatus = wire.hasTools ? 500 : 400;
    const fail = (outcome: Outcome, message: string, extra: Partial<JournalEntry> = {}) =>
      this.refuse(outcome, failStatus, message, { request: body, ...extra });

    const candidates = this.fixtures.filter((fixture) => matches(fixture.match, wire));
    const best = Math.max(0, ...candidates.map((fixture) => specificity(fixture.match)));
    const top = candidates.filter((fixture) => specificity(fixture.match) === best);
    const fixture = top[0];
    if (!fixture) {
      return fail('unmatched', 'no fixture matches this request');
    }
    if (top.length > 1) {
      return fail('ambiguous', `fixtures ${top.map((f) => f.key).join(', ')} match equally well`);
    }

    const conversation = conversationKey(wire);
    const perFixture = this.counters.get(conversation) ?? new Map<string, number>();
    this.counters.set(conversation, perFixture);
    const turnIndex = perFixture.get(fixture.key) ?? 0;
    perFixture.set(fixture.key, turnIndex + 1);

    const known = { fixture: fixture.key, conversation, turn: turnIndex };
    if (turnIndex >= (fixture.maxTurns ?? DEFAULT_MAX_TURNS)) {
      return fail(
        'overrun',
        `${fixture.key} was asked ${turnIndex + 1} times (maxTurns ${fixture.maxTurns ?? DEFAULT_MAX_TURNS})`,
        known,
      );
    }

    const turn = fixture.turns[Math.min(turnIndex, fixture.turns.length - 1)];
    if (!turn) return fail('unmatched', `${fixture.key} has no turns`, known);
    if (turn.match && !matches(turn.match, wire)) {
      return fail(
        'turn-mismatch',
        `turn ${turnIndex} of ${fixture.key} expects ${JSON.stringify(turn.match)}`,
        known,
      );
    }
    if (turn.stream !== undefined && turn.stream !== wire.stream) {
      return fail(
        'turn-mismatch',
        `turn ${turnIndex} of ${fixture.key} expects stream ${turn.stream}`,
        known,
      );
    }
    const fault = faultOf(turn);
    if (!wire.stream && activeStreamFaults(turn).length > 0) {
      return fail('fault-not-applicable', `${fault} only applies to a streaming reply`, {
        ...known,
        fault,
      });
    }

    return this.reply(turn, wire, { ...known, fault, request: body }, startedAt);
  }

  private async reply(
    turn: Turn,
    wire: Wire,
    start: Pick<JournalEntry, 'fixture' | 'conversation' | 'turn' | 'fault' | 'request'>,
    startedAt: number,
  ): Promise<Response> {
    if (turn.http) {
      const entry = this.journal.open({ outcome: 'http-fault', ...start });
      const body = turn.http.body ?? {
        error: { message: 'fake provider error', type: 'fake_error' },
      };
      entry.wire = JSON.stringify(body);
      entry.durationMs = performance.now() - startedAt;
      return json(turn.http.status, body);
    }

    const entry = this.journal.open({ outcome: 'ok', ...start });
    const ctx = { id: `chatcmpl-qa-${entry.id}`, model: wire.model ?? 'qa-fake' };

    if (!wire.stream) {
      const wait = turn.delay?.firstChunkMs ?? turn.delay?.chunkMs;
      if (wait) await new Promise<void>((resolve) => setTimeout(resolve, wait));
      const body = renderCompletion(turn, ctx);
      entry.wire = body;
      entry.durationMs = performance.now() - startedAt;
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }

    const stream = openStream(planStream(turn, ctx), turn.delay, {
      onFrame: (frame) => {
        entry.wire += frame;
      },
      onEnd: () => {
        entry.durationMs = performance.now() - startedAt;
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  }

  /** An engine-level failure: journaled, and loud on the wire so a spec cannot miss it. */
  private refuse(
    outcome: Outcome,
    status: number,
    message: string,
    details: Partial<JournalEntry>,
  ): Response {
    const entry = this.journal.open({
      outcome,
      fixture: details.fixture ?? null,
      conversation: details.conversation ?? null,
      turn: details.turn ?? null,
      fault: details.fault ?? null,
      request: details.request ?? null,
    });
    const body = {
      error: { message: `fake-llm: ${message}`, type: 'fake_llm_error', code: outcome },
    };
    entry.wire = JSON.stringify(body);
    return json(status, body, { 'x-fake-llm-outcome': outcome });
  }
}
