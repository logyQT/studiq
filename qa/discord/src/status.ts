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

function age(ms: number): string {
  if (!ms || Date.now() - ms < 60_000) return 'now';
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

export class StatusPublisher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private busy = false;
  private snapshot: DashboardSnapshot = { envs: [], fetchedAt: 0, ok: false };
  private readonly envClients = new Map<number, Client>();
  private readonly lastPresence = new Map<string, { sig: string; at: number }>();
  private lastContent = '';
  private lastEditAt = 0;
  private lastSendAt = 0;
  private channel: TextChannel | null = null;
  private managerChannel: TextChannel | null = null;
  private managerChannelErrorAt = 0;
  private channelErrorAt = 0;
  private fetchErrorAt = 0;
  private lastManagerSig = '';
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
      if (!fetched || !fetched.isTextBased()) return null;
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

  private buildContent(): string {
    const lines = this.snapshot.envs.map((env) => {
      const scenario = env.scenario ? env.scenario.slice(0, 42) : 'no session';
      return `${env.state.padEnd(7)} | ${env.label} · ${scenario} · ${env.pending} pending · ${age(env.lastActivity)}`;
    });
    lines.push('');
    lines.push(`dashboard: ${this.config.dashboardUrl}/`);
    return lines.join('\n');
  }

  private async resolveChannel(): Promise<TextChannel | null> {
    if (this.channel) return this.channel;
    try {
      const fetched = await this.managerClient.channels.fetch(this.config.dashboardChannelId);
      if (!fetched || !fetched.isTextBased()) {
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
