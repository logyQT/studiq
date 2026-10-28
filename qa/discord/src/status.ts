import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ActivityType, type Client, type TextChannel } from 'discord.js';
import type { Config } from './config';
import type { Logger } from './log';
import type { StateStore } from './state';

export type SlotState = 'free' | 'busy' | 'waiting';

export interface EnvSnapshot {
  n: number;
  label: string;
  state: SlotState;
  pending: number;
  scenario: string;
  sessionId: string;
  lastActivity: number;
}

export interface DashboardSnapshot {
  envs: EnvSnapshot[];
  fetchedAt: number;
  ok: boolean;
}

const STATE_MAP: Record<string, SlotState> = { free: 'free', busy: 'busy', decision: 'waiting' };
const PRESENCE_STATUS = { free: 'online', busy: 'dnd', waiting: 'idle' } as const;

/** Stage order and short labels for the dashboard digest. */
const STAGE_ORDER = [
  'designing',
  'design_ready',
  'implementing',
  'reviewing',
  'changes_requested',
  'qa_testing',
  'qa_failed',
  'approved',
  'pr_open',
  'blocked',
  'needs_design',
];
const STAGE_LABEL: Record<string, string> = {
  designing: 'designing',
  design_ready: 'ready to build',
  implementing: 'implementing',
  reviewing: 'reviewing',
  changes_requested: 'changes needed',
  qa_testing: 'QA',
  qa_failed: 'QA failed',
  approved: 'approved',
  pr_open: 'awaiting review',
  blocked: 'blocked',
  needs_design: 'needs design',
};

function relative(ms: number): string {
  if (!ms) return '—';
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

export class StatusPublisher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private busy = false;
  private snapshot: DashboardSnapshot = { envs: [], fetchedAt: 0, ok: false };
  private readonly envClients = new Map<number, Client>();
  private readonly lastPresence = new Map<string, { sig: string; at: number }>();
  private lastContent = '';
  private qaManagerNote: string | null = null;
  private lastEditAt = 0;
  private lastSendAt = 0;
  private channel: TextChannel | null = null;
  private managerChannel: TextChannel | null = null;
  private managerChannelErrorAt = 0;
  private channelErrorAt = 0;
  private fetchErrorAt = 0;
  private lastManagerSig = '';
  private lastPruneAt = 0;
  private readonly lastEnvs = new Map<
    string,
    { state: string; scenario: string; sessionId: string; pending: number }
  >();
  private baseline = false;
  private eventSink?: (text: string) => Promise<void>;

  setEventSink(sink: (text: string) => Promise<void>): void {
    this.eventSink = sink;
  }

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
    private readonly state: StateStore,
    private readonly managerClient: Client,
    envClients: Map<number, Client>,
  ) {
    this.envClients = envClients;
  }

  start(): void {
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  current(): DashboardSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<void> {
    await this.tick();
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      await this.poll();
      await this.refreshQaManagerNote();
      this.pruneShots();
      await this.announceTransitions();
      this.applyPresence();
      await this.updateDashboardMessage();
    } catch (err) {
      this.reportFetchError(err);
    } finally {
      this.busy = false;
      this.schedule(this.config.statusMs);
    }
  }

  private async poll(): Promise<void> {
    const res = await fetch(`${this.config.dashboardUrl}/api/dashboard/state`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`dashboard state HTTP ${res.status}`);
    const body = (await res.json()) as {
      envs?: Array<{
        name?: string;
        directory?: string;
        session?: { id?: string; title?: string; updated?: number } | null;
        agent?: { state?: string; pending?: number; lastActivity?: number } | null;
      }>;
    };

    const envs: EnvSnapshot[] = [];
    for (const slot of this.config.slots) {
      const name = `qa-env-${slot.n}`;
      const raw = body.envs?.find((e) => e.name === name);
      const rawState = raw?.agent?.state ?? 'free';
      envs.push({
        n: slot.n,
        label: slot.label,
        state: STATE_MAP[rawState] ?? 'free',
        pending: Number(raw?.agent?.pending ?? 0),
        scenario: String(raw?.session?.title ?? ''),
        sessionId: String(raw?.session?.id ?? ''),
        lastActivity: Number(raw?.agent?.lastActivity ?? raw?.session?.updated ?? 0),
      });
    }
    this.snapshot = { envs, fetchedAt: Date.now(), ok: true };
  }

  /** Push slot transitions into #manager so the manager does not need to poll. */
  private async announceTransitions(): Promise<void> {
    if (!this.snapshot.ok) return;
    if (!this.baseline) {
      this.captureEnvs();
      this.baseline = true;
      return;
    }

    const lines: string[] = [];
    const actionable: string[] = [];
    for (const env of this.snapshot.envs) {
      const prev = this.lastEnvs.get(env.label);
      if (!prev) continue;
      if (prev.state !== env.state) {
        const detail = env.scenario ? ` · ${env.scenario}` : '';
        const pending = env.state === 'waiting' ? ` · ${env.pending} pending` : '';
        const verb =
          env.state === 'free' && prev.state === 'busy'
            ? 'finished'
            : `${prev.state} → ${env.state}`;
        const line = `${env.label}: ${verb}${detail}${pending}`;
        lines.push(line);
        if (env.state === 'waiting' || (env.state === 'free' && prev.state === 'busy')) {
          actionable.push(line);
        }
      } else if (env.state === 'busy' && env.scenario && prev.scenario !== env.scenario) {
        lines.push(`${env.label}: started · ${env.scenario}`);
      }
    }
    this.captureEnvs();
    if (lines.length === 0) return;

    if (this.config.dryRun) {
      this.log.debug('status', `[dry-run] events:\n${lines.join('\n')}`);
      return;
    }

    if (actionable.length > 0 && this.eventSink) {
      try {
        await this.eventSink(
          `[automated events]\n${actionable.join('\n')}\n` +
            'Act on these (sync decisions, report, dispatch, or unstick). ' +
            'If nothing is needed, reply briefly.',
        );
      } catch (err) {
        this.log.warn(
          'status',
          `event wake failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const channel = await this.resolveManagerChannel();
    if (!channel) return;
    try {
      await channel.send({
        content: lines.join('\n').slice(0, 1_900),
        allowedMentions: { parse: [] },
      });
      this.log.info('status', `posted ${lines.length} transition(s) to #manager`);
    } catch (err) {
      this.log.warn(
        'status',
        `event post failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private captureEnvs(): void {
    this.lastEnvs.clear();
    for (const env of this.snapshot.envs) {
      this.lastEnvs.set(env.label, {
        state: env.state,
        scenario: env.scenario,
        sessionId: env.sessionId,
        pending: env.pending,
      });
    }
  }

  private async resolveManagerChannel(): Promise<TextChannel | null> {
    if (this.managerChannel) return this.managerChannel;
    try {
      const fetched = await this.managerClient.channels.fetch(this.config.manager.channelId);
      if (!fetched?.isTextBased()) return null;
      this.managerChannel = fetched as TextChannel;
      return this.managerChannel;
    } catch (err) {
      const now = Date.now();
      if (now - this.managerChannelErrorAt > 60_000) {
        this.managerChannelErrorAt = now;
        this.log.warn(
          'status',
          `cannot fetch #manager: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }
  }

  private reportFetchError(err: unknown): void {
    const now = Date.now();
    if (now - this.fetchErrorAt < 60_000) return;
    this.fetchErrorAt = now;
    this.log.warn(
      'status',
      `dashboard poll failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  private applyPresence(): void {
    if (!this.snapshot.ok) return;
    const now = Date.now();

    for (const env of this.snapshot.envs) {
      const client = this.envClients.get(env.n);
      if (!client?.user) continue;
      const sig = `${env.state}|${env.label}`;
      const prev = this.lastPresence.get(env.label);
      if (prev?.sig === sig && now - prev.at < 60_000) continue;
      this.lastPresence.set(env.label, { sig, at: now });
      if (this.config.dryRun) {
        this.log.debug('status', `[dry-run] presence ${env.label}: ${env.state} | ${env.label}`);
        continue;
      }
      try {
        client.user.setPresence({
          status: PRESENCE_STATUS[env.state],
          activities: [{ name: `${env.state} | ${env.label}`, type: ActivityType.Custom }],
        });
      } catch (err) {
        this.log.warn(
          'status',
          `presence ${env.label} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const counts = this.counts();
    const text = `${counts.busy} busy · ${counts.waiting} waiting · ${counts.free} free`;
    if (!this.managerClient.user) return;
    if (text === this.lastManagerSig) return;
    this.lastManagerSig = text;
    if (this.config.dryRun) {
      this.log.debug('status', `[dry-run] manager presence: ${text}`);
      return;
    }
    try {
      this.managerClient.user.setPresence({
        status: counts.busy > 0 ? 'dnd' : counts.waiting > 0 ? 'idle' : 'online',
        activities: [{ name: text, type: ActivityType.Custom }],
      });
    } catch (err) {
      this.log.warn(
        'status',
        `manager presence failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private counts(): { busy: number; waiting: number; free: number } {
    const c = { busy: 0, waiting: 0, free: 0 };
    for (const env of this.snapshot.envs) c[env.state] += 1;
    return c;
  }

  /** One line for the QA-suite loop: manager, workers, open PRs into qa-suite. */
  private qaSuiteManagerId(): string | null {
    const dir = process.env.QA_FIX_DIR ?? '/workspaces/studiq/.qa-fix';
    try {
      return JSON.parse(readFileSync(join(dir, 'qa-suite-manager.json'), 'utf8')).session ?? null;
    } catch {
      return null;
    }
  }

  /** What the QA-suite manager last said — the dashboard should show it working. */
  private async refreshQaManagerNote(): Promise<void> {
    const sid = this.qaSuiteManagerId();
    if (!sid) {
      this.qaManagerNote = null;
      return;
    }
    try {
      const auth = `Basic ${Buffer.from(
        `${this.config.opencode.user}:${this.config.opencode.password}`,
      ).toString('base64')}`;
      const res = await fetch(
        `${this.config.opencode.url}/api/session/${sid}/message?limit=3&order=desc&type=assistant`,
        { headers: { Authorization: auth }, signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        data?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      const text = (body.data ?? [])
        .map((m) =>
          (m.content ?? [])
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join(''),
        )
        .find((t) => t.trim());
      const clean = text
        ?.replace(/^[#>*\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      this.qaManagerNote = clean ? clean.slice(0, 160) : null;
    } catch {
      /* keep the previous note */
    }
  }

  private qaSuiteLine(): string | null {
    const manager = this.qaSuiteManagerId();

    const workers = this.snapshot.envs
      .filter((env) => env.scenario.startsWith('[QA-SUITE]') && env.state !== 'free')
      .map((env) => env.scenario.replace('[QA-SUITE]', '').split('—')[0].trim())
      .filter(Boolean);

    let prs: Array<{ number: number; headRefName: string }> = [];
    try {
      const raw = execFileSync(
        'gh',
        [
          'pr',
          'list',
          '--base',
          'qa-suite',
          '--state',
          'open',
          '--limit',
          '30',
          '--json',
          'number,headRefName',
        ],
        { encoding: 'utf8', timeout: 15_000 },
      );
      prs = (JSON.parse(raw) as Array<{ number: number; headRefName: string }>).filter((pr) =>
        /^qa\/[A-Z][A-Z0-9]*-[A-Z0-9]+$/.test(pr.headRefName),
      );
    } catch {
      /* gh unavailable or rate-limited */
    }

    if (!manager && workers.length === 0) return null;

    const prList = prs
      .slice(0, 5)
      .map((pr) => `#${pr.number} ${pr.headRefName.replace(/^qa\//, '')}`)
      .join(', ');
    const head = [
      `**QA suite** — ${manager ? `manager ${manager.slice(0, 11)}…` : 'manager not started'}`,
      workers.length ? `${workers.length} worker${workers.length === 1 ? '' : 's'}` : 'no workers',
      prs.length ? `${prs.length} PR${prs.length === 1 ? '' : 's'}: ${prList}` : 'no PRs yet',
    ].join(' · ');
    return this.qaManagerNote ? `${head}\n> ${this.qaManagerNote}` : head;
  }

  private buildContent(): string {
    const counts = this.counts();
    const pipeline = this.pipelineInfo();
    const envLines = this.snapshot.envs.map((env) => {
      // a finished session keeps its title in the dashboard payload; showing it on a
      // free slot reads as stale work, so free means idle
      const scenario =
        env.state === 'free' ? 'idle' : env.scenario ? env.scenario.slice(0, 42) : 'no session';
      return `${env.state.padEnd(7)} | ${env.label} · ${scenario} · ${env.pending} pending · ${relative(env.lastActivity)}`;
    });
    const head =
      `**Caretaker** — ${counts.busy} busy · ${counts.free} free` +
      (pipeline
        ? ` · ${pipeline.active} active · ${pipeline.parked} parked · ${pipeline.merged} merged`
        : '');

    // Discord trims leading whitespace, so the blank first line is anchored by a
    // zero-width space: the message opens with an empty line, as requested.
    const lines: string[] = ['\u200b', head, ...envLines];

    const qa = this.qaSuiteLine();
    if (qa) lines.push('', qa);

    const usage = this.usageBlock();
    if (usage) lines.push('', `**${usage.title}**`, '```', ...usage.lines, '```');

    if (pipeline && pipeline.rows.length) {
      const summary = pipeline.summary ? ` — ${pipeline.summary}` : '';
      lines.push('', `**Pipeline**${summary}`, '```', ...pipeline.rows, '```');
    } else if (pipeline) {
      lines.push('', '**Pipeline** — no active work');
    }
    if (pipeline && pipeline.parkedLine) {
      lines.push('', `**Parked** — ${pipeline.parkedLine} (decided, not started)`);
    }

    lines.push('', `dashboard: ${this.config.dashboardUrl}/`);
    return lines.join('\n').slice(0, 1_900);
  }

  /**
   * Keep dashboard/shots under its hard cap. browser-core prunes at capture time,
   * but the MCP/CLI processes already running keep their loaded code, so the
   * long-lived bridge enforces the same cap on a timer (once a minute).
   */
  private pruneShots(): void {
    const now = Date.now();
    if (now - this.lastPruneAt < 60_000) return;
    this.lastPruneAt = now;
    const max = Math.max(1, Number(process.env.SHOTS_MAX ?? 1000));
    try {
      const files = readdirSync(this.config.shotsDir)
        .filter((name) => name.toLowerCase().endsWith('.png'))
        .map((name) => {
          const path = join(this.config.shotsDir, name);
          try {
            return { path, mtime: statSync(path).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { path: string; mtime: number } => entry !== null)
        .sort((a, b) => a.mtime - b.mtime);
      let removed = 0;
      while (files.length > max) {
        const oldest = files.shift();
        if (!oldest) break;
        unlinkSync(oldest.path);
        removed += 1;
      }
      if (removed > 0) this.log.info('status', `pruned ${removed} old screenshots (cap ${max})`);
    } catch (err) {
      this.log.warn(
        'status',
        `screenshot prune failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Open issues by stage, from the same state file the manager tooling writes. */
  private pipelineInfo(): {
    open: number;
    merged: number;
    active: number;
    parked: number;
    rows: string[];
    summary: string;
    parkedLine: string;
  } | null {
    const path = resolve(this.config.liveRoot, '../../.qa-fix/state.json');
    try {
      if (!existsSync(path)) return null;
      const state = JSON.parse(readFileSync(path, 'utf8')) as {
        issues?: Record<string, { stage?: string; pr?: number | null; attempt?: number | null }>;
      };
      const issues = Object.entries(state.issues ?? {}).map(([number, rec]) => ({
        number: Number(number),
        stage: String(rec.stage ?? 'queued'),
        pr: rec.pr ?? null,
        attempt: Number(rec.attempt ?? 1),
      }));
      const merged = issues.filter((issue) => issue.stage === 'done').length;
      const PARKED = new Set(['design_ready', 'needs_design', 'blocked']);
      const open = issues.filter((issue) => issue.stage !== 'done');
      const active = open.filter((issue) => !PARKED.has(issue.stage));
      const parked = open.filter((issue) => PARKED.has(issue.stage));
      const rank = (stage: string): number => {
        const at = STAGE_ORDER.indexOf(stage);
        return at === -1 ? STAGE_ORDER.length : at;
      };
      const rows = active
        .sort((a, b) => rank(a.stage) - rank(b.stage) || a.number - b.number)
        .slice(0, 10)
        .map((issue) => {
          const stage = (STAGE_LABEL[issue.stage] ?? issue.stage).padEnd(16);
          const pr = (issue.pr ? `#${issue.pr}` : '—').padEnd(6);
          return `#${String(issue.number).padEnd(5)}${stage}${pr}r${issue.attempt}`;
        });
      const counts = new Map<string, number>();
      for (const issue of active) counts.set(issue.stage, (counts.get(issue.stage) ?? 0) + 1);
      const summary = [...counts.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]))
        .map(([stage, n]) => `${n} ${STAGE_LABEL[stage] ?? stage}`)
        .join(' · ');
      const parkedCounts = new Map<string, number>();
      for (const issue of parked)
        parkedCounts.set(issue.stage, (parkedCounts.get(issue.stage) ?? 0) + 1);
      const parkedLine = [...parkedCounts.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]))
        .map(([stage, n]) => `${n} ${STAGE_LABEL[stage] ?? stage}`)
        .join(' · ');
      return {
        open: open.length,
        merged,
        active: active.length,
        parked: parked.length,
        rows,
        summary,
        parkedLine,
      };
    } catch {
      return null;
    }
  }

  /** The OpenCode Go allowance, written by `qa/tools/qa-usage` on its own schedule. */
  private usageBlock(): { title: string; lines: string[] } | null {
    const path = resolve(this.config.liveRoot, '../../.qa-fix/usage.json');
    try {
      if (!existsSync(path)) return null;
      const snapshot = JSON.parse(readFileSync(path, 'utf8')) as {
        block?: string[];
        line?: string;
        fetchedAt?: number;
      };
      const block = snapshot.block?.length ? snapshot.block : snapshot.line ? [snapshot.line] : [];
      if (!block.length) return null;
      const [title, ...lines] = block;
      const stale = Date.now() - Number(snapshot.fetchedAt ?? 0) > 30 * 60 * 1000;
      return {
        title,
        lines: stale ? [...lines, '(stale - watcher not reporting)'] : lines,
      };
    } catch {
      return null;
    }
  }

  private async resolveChannel(): Promise<TextChannel | null> {
    if (this.channel) return this.channel;
    try {
      const fetched = await this.managerClient.channels.fetch(this.config.dashboardChannelId);
      if (!fetched?.isTextBased()) {
        this.log.error(
          'status',
          `dashboard channel ${this.config.dashboardChannelId} is not a text channel`,
        );
        return null;
      }
      this.channel = fetched as TextChannel;
      return this.channel;
    } catch (err) {
      const now = Date.now();
      if (now - this.channelErrorAt > 60_000) {
        this.channelErrorAt = now;
        this.log.warn(
          'status',
          `cannot fetch #dashboard: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }
  }

  private async updateDashboardMessage(): Promise<void> {
    if (!this.snapshot.ok) return;
    const content = this.buildContent();
    const now = Date.now();
    const tooSoon = now - this.lastEditAt < 10_000;

    if (this.config.dryRun) {
      if (content !== this.lastContent) {
        this.log.debug('status', `[dry-run] #dashboard would say:\n${content}`);
        this.lastContent = content;
      }
      return;
    }

    const channel = await this.resolveChannel();
    if (!channel) return;

    const existingId = this.state.dashboardMessageId;
    if (existingId) {
      if (tooSoon && content === this.lastContent) return;
      try {
        const message = await channel.messages.fetch(existingId);
        if (message.content === content) {
          this.lastContent = content;
          return;
        }
        if (tooSoon) return;
        await message.edit({ content });
        this.lastContent = content;
        this.lastEditAt = Date.now();
        this.state.lastDashboardEdit = this.lastEditAt;
        return;
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code !== 10008) {
          this.log.warn(
            'status',
            `dashboard edit failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        // 10008 Unknown Message — someone deleted it; fall through and repost.
        this.state.dashboardMessageId = undefined;
      }
    }

    if (now - this.lastSendAt < 10_000) return;
    try {
      const sent = await channel.send({ content, allowedMentions: { parse: [] } });
      this.state.dashboardMessageId = sent.id;
      this.lastContent = content;
      this.lastSendAt = Date.now();
      this.lastEditAt = Date.now();
      this.state.lastDashboardEdit = this.lastEditAt;
      this.log.info('status', `posted live #dashboard message (${sent.id})`);
    } catch (err) {
      this.log.warn(
        'status',
        `dashboard post failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
