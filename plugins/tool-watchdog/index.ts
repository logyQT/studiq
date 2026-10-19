/**
 * tool-watchdog — abort tool calls that stop making progress.
 *
 * Why: the Code Mode sandbox has no timers, so models occasionally "wait" with
 * `await new Promise(() => {})`. That never resolves and the tool call hangs
 * until a human aborts it, which stalls unattended runs.
 *
 * How: OpenCode fires `execute.before` when a tool starts and `execute.after`
 * when it finishes (success or error). A hung call never fires `after`, so a
 * real timer started in `before` is enough to detect it. On timeout the session
 * is interrupted; by default it also resumes so the run continues on its own.
 *
 * Note: Code Mode inner calls (`tools.grafana.*`, browser, …) run inside a
 * single `execute` part, so budgets are keyed on the outer tool name. Long work
 * should use `shell`, which has its own timeout and a `create.before` cap here.
 *
 * Configure with plugin options in `opencode.jsonc`; see README.md.
 */

interface WatchdogOptions {
  /** Master switch. */
  enabled?: boolean;
  /** Budget for a Code Mode `execute` call, ms. */
  executeMs?: number;
  /** Budget for any tool without a more specific rule, ms. */
  defaultMs?: number;
  /** Budget for local file tools (read/write/edit/glob/grep), ms. */
  fsMs?: number;
  /** Budget for MCP-backed tools, ms. */
  mcpMs?: number;
  /** Budget for browser tools, ms. */
  browserMs?: number;
  /** Budget for delegated `task` calls, ms. 0 disables (never abort). */
  taskMs?: number;
  /** Upper bound applied to every shell command's own timeout, ms. 0 disables. */
  shellCapMs?: number;
  /**
   * false (default): interrupt, then send a continue prompt so the run resumes.
   * true: interrupt with `continue: true` and rely on the server to resume —
   * observed to end the run as `interrupted` instead of continuing.
   */
  resume?: boolean;
  /** Minimum time between interrupts for one session, ms. */
  cooldownMs?: number;
  /** Maximum interrupts per session per hour. */
  maxPerHour?: number;
  /** Session ids to ignore. */
  skipSessions?: string[];
}

type ResolvedOptions = Required<Omit<WatchdogOptions, 'skipSessions'>> & { skipSessions: string[] };

const DEFAULTS: ResolvedOptions = {
  enabled: true,
  executeMs: 15_000,
  defaultMs: 60_000,
  fsMs: 15_000,
  mcpMs: 45_000,
  browserMs: 45_000,
  taskMs: 0,
  shellCapMs: 300_000,
  resume: false,
  cooldownMs: 30_000,
  maxPerHour: 6,
  skipSessions: [],
};

const CONTINUE_TEXT =
  'The previous tool call exceeded its time budget and was aborted. Continue from the last completed step; do not retry the aborted call with the same approach.';

const FS_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'list',
  'ls',
  'webfetch',
  'todoread',
  'todowrite',
]);

/** Pick the budget for a tool name; 0 means "never abort". */
function budgetFor(tool: string, opts: ResolvedOptions): number {
  if (tool === 'execute') return opts.executeMs;
  if (tool === 'task') return opts.taskMs;
  if (tool === 'shell' || tool === 'bash') return 0; // handled by the shell cap
  if (FS_TOOLS.has(tool)) return opts.fsMs;
  if (tool.startsWith('browser')) return opts.browserMs;
  if (tool.startsWith('grafana') || tool.startsWith('mcp') || tool.includes('_')) {
    return opts.mcpMs;
  }
  return opts.defaultMs;
}

/* ── defensive accessors: hook payloads vary between releases ───────────── */

function readSessionId(event: unknown): string | undefined {
  const e = event as Record<string, unknown> | undefined;
  const v = e?.sessionID ?? e?.sessionId ?? e?.session;
  return typeof v === 'string' ? v : undefined;
}

function readToolName(event: unknown): string | undefined {
  const e = event as Record<string, unknown> | undefined;
  const v = e?.tool ?? e?.name;
  return typeof v === 'string' ? v : undefined;
}

function readCallKey(event: unknown): string {
  const e = event as Record<string, unknown> | undefined;
  const id = e?.callID ?? e?.callId ?? e?.id;
  if (typeof id === 'string') return id;
  return `${readSessionId(event) ?? '?'}:${readToolName(event) ?? '?'}`;
}

interface ToolWatchdogContext {
  options?: WatchdogOptions;
  permission?: { list(input: { sessionID: string }): Promise<unknown> };
  session: {
    interrupt(input: { sessionID: string; continue: boolean }): Promise<void>;
    prompt(input: { sessionID: string; text: string; delivery?: string }): Promise<unknown>;
  };
  tool: {
    hook(
      name: 'execute.before' | 'execute.after',
      callback: (event: unknown) => void,
    ): Promise<{ dispose(): Promise<void> } | undefined>;
  };
  shell?: {
    hook(
      name: 'create.before',
      callback: (event: { timeout?: number }) => void,
    ): Promise<{ dispose(): Promise<void> } | undefined>;
  };
}

interface Inflight {
  timer: ReturnType<typeof setTimeout>;
  tool: string;
  sessionID: string;
  budget: number;
}

export default {
  id: 'qa.tool-watchdog',
  async setup(ctx: ToolWatchdogContext) {
    const opts: ResolvedOptions = { ...DEFAULTS, ...(ctx.options ?? {}) };
    if (!opts.enabled) return;

    const inflight = new Map<string, Inflight>();
    const rate = new Map<string, { count: number; resetAt: number; lastAt: number }>();
    const registrations: Array<{ dispose(): Promise<void> } | undefined> = [];

    const log = (message: string, meta: Record<string, unknown> = {}) => {
      // eslint-disable-next-line no-console
      console.warn(`[tool-watchdog] ${message}`, JSON.stringify(meta));
    };

    const allowed = (sessionID: string): boolean => {
      const now = Date.now();
      let r = rate.get(sessionID);
      if (!r || now > r.resetAt) {
        r = { count: 0, resetAt: now + 3_600_000, lastAt: 0 };
        rate.set(sessionID, r);
      }
      if (now - r.lastAt < opts.cooldownMs) return false;
      return r.count < opts.maxPerHour;
    };

    const fire = async (rec: Inflight) => {
      try {
        if (ctx.permission) {
          const pending = await ctx.permission.list({ sessionID: rec.sessionID });
          const list = Array.isArray(pending)
            ? pending
            : ((pending as { data?: unknown[] })?.data ?? []);
          if (list.length > 0) {
            log('skipped: permission pending', { sessionID: rec.sessionID });
            return;
          }
        }
        if (!allowed(rec.sessionID)) {
          log('skipped: rate limited', { sessionID: rec.sessionID });
          return;
        }
        const r = rate.get(rec.sessionID);
        if (r) {
          r.count += 1;
          r.lastAt = Date.now();
        }

        log('aborting stalled call', {
          sessionID: rec.sessionID,
          tool: rec.tool,
          budgetMs: rec.budget,
        });

        if (opts.resume) {
          await ctx.session.interrupt({ sessionID: rec.sessionID, continue: true });
        } else {
          await ctx.session.interrupt({ sessionID: rec.sessionID, continue: false });
          await ctx.session.prompt({
            sessionID: rec.sessionID,
            text: CONTINUE_TEXT,
            delivery: 'queue',
          });
        }
      } catch (error) {
        log('error while aborting', { error: String(error) });
      }
    };

    registrations.push(
      await ctx.tool.hook('execute.before', (event) => {
        const sessionID = readSessionId(event);
        const tool = readToolName(event) ?? 'unknown';
        if (!sessionID || opts.skipSessions.includes(sessionID)) return;
        const budget = budgetFor(tool, opts);
        if (budget <= 0) return;
        const key = readCallKey(event);
        const timer = setTimeout(() => void fire({ timer, tool, sessionID, budget }), budget);
        inflight.set(key, { timer, tool, sessionID, budget });
      }),
    );

    registrations.push(
      await ctx.tool.hook('execute.after', (event) => {
        const key = readCallKey(event);
        const rec = inflight.get(key);
        if (rec) {
          clearTimeout(rec.timer);
          inflight.delete(key);
        }
      }),
    );

    if (ctx.shell && opts.shellCapMs > 0) {
      registrations.push(
        await ctx.shell.hook('create.before', (event) => {
          if (typeof event.timeout === 'number') {
            event.timeout = Math.min(event.timeout, opts.shellCapMs);
          }
        }),
      );
    }

    return () => {
      for (const rec of inflight.values()) clearTimeout(rec.timer);
      inflight.clear();
      for (const registration of registrations) void registration?.dispose();
    };
  },
};
