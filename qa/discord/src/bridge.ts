import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { AttachmentBuilder, type Attachment, type Client, type TextChannel } from 'discord.js';
import type { Config } from './config';
import type { Logger } from './log';
import type { OpencodeClient } from './opencode';
import type { StateStore } from './state';

const POLL_MS = 3_000;
const SESSION_REFRESH_MS = 5_000;
const MAX_CHUNK = 1_900;
const REPORT_AS_FILE_OVER = 6_000;
// Discord attachments are downloaded here so agents can `read` them: the model
// never sees a Discord CDN URL, and image-only messages used to be dropped.
const INBOX_DIR = process.env.QA_INBOX_DIR || '/workspaces/studiq/.qa-inbox';
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export interface BridgeOptions {
  label: string;
  channelId: string;
  directory: string;
  manager: boolean;
  overseer?: boolean;
  sessionFile?: string;
}

export class Bridge {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private busy = false;
  private channel: TextChannel | null = null;
  private sessionId: string | null = null;
  private lastSessionCheck = 0;
  private lastErrorAt = 0;
  private channelErrorAt = 0;

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
    private readonly state: StateStore,
    private readonly opencode: OpencodeClient,
    private readonly client: Client,
    private readonly opts: BridgeOptions,
  ) {}

  get session(): string | null {
    return this.sessionId;
  }

  setSession(id: string | null): void {
    this.sessionId = id;
  }

  async start(): Promise<void> {
    await this.resolveChannel();
    await this.syncSession(true);
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
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
      await this.syncSession(false);
      if (this.sessionId) await this.relayMessages(this.sessionId);
    } catch (err) {
      const now = Date.now();
      if (now - this.lastErrorAt > 30_000) {
        this.lastErrorAt = now;
        this.log.warn(
          this.opts.label,
          `poll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      this.busy = false;
      this.schedule(POLL_MS);
    }
  }

  private async resolveChannel(): Promise<TextChannel | null> {
    if (this.channel) return this.channel;
    try {
      const fetched = await this.client.channels.fetch(this.opts.channelId);
      if (!fetched?.isTextBased()) {
        this.log.error(this.opts.label, `channel ${this.opts.channelId} is not a text channel`);
        return null;
      }
      this.channel = fetched as TextChannel;
      return this.channel;
    } catch (err) {
      const now = Date.now();
      if (now - this.channelErrorAt > 60_000) {
        this.channelErrorAt = now;
        this.log.warn(
          this.opts.label,
          `cannot fetch channel: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }
  }

  /**
   * Keep the bridge pointed at the slot's current session. On a change we seed the
   * new session's backlog as "seen" so a dispatch never dumps history into Discord.
   */
  private async syncSession(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastSessionCheck < SESSION_REFRESH_MS && this.sessionId) return;
    this.lastSessionCheck = now;

    let next: string | null = null;
    if (this.opts.sessionFile) {
      try {
        next = JSON.parse(readFileSync(this.opts.sessionFile, 'utf8')).session ?? null;
      } catch {
        next = null;
      }
    } else if (this.opts.manager) {
      next = this.state.managerSessionId ?? null;
    } else {
      const session = await this.opencode.resolveSession(this.opts.directory).catch(() => null);
      next = session?.id ?? null;
    }

    if (next !== this.sessionId) {
      const previous = this.sessionId;
      this.sessionId = next;
      if (next) {
        // Any session driven through Discord is an autonomous round: the
        // operator is not at the TUI to answer a blocking question.
        await this.opencode.markAutonomous(next).catch(() => undefined);
        if (previous) {
          // A new session appeared (e.g. dispatch). Seed only messages older
          // than the grace window so a reply that arrived before we noticed
          // the session is relayed instead of being mistaken for history.
          const seeded = await this.seedOlderThan(next, Date.now() - 120_000);
          this.log.info(
            this.opts.label,
            `session ${previous} -> ${next} (seeded ${seeded} older; relaying newer)`,
          );
        } else {
          const seeded = await this.seed(next);
          this.log.info(this.opts.label, `attached to session ${next} (seeded ${seeded})`);
        }
      } else {
        this.log.info(this.opts.label, 'no session in this slot');
      }
    }
  }

  private async seedOlderThan(sessionId: string, cutoff: number): Promise<number> {
    const messages = await this.opencode.messages(sessionId, 50).catch(() => []);
    const old = messages.filter((m) => (m.time?.created ?? 0) < cutoff).map((m) => m.id);
    this.state.markSeen(sessionId, old);
    this.state.save();
    return old.length;
  }

  private async seed(sessionId: string): Promise<number> {
    const messages = await this.opencode.messages(sessionId, 50).catch(() => []);
    this.state.markSeen(
      sessionId,
      messages.map((m) => m.id),
    );
    this.state.save();
    return messages.length;
  }

  private async relayMessages(sessionId: string): Promise<void> {
    const channel = await this.resolveChannel();
    if (!channel) return;

    const messages = await this.opencode.messages(sessionId, 50);
    const fresh = messages
      .filter((m) => !this.state.seen(sessionId, m.id))
      .filter((m) => m.type === 'assistant' && (m.time?.completed ?? 0) > 0)
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));

    for (const message of fresh) {
      if (this.stopped) return;
      await this.relayOne(sessionId, message.id, message.content);
      this.state.markSeen(sessionId, [message.id]);
      this.state.save();
    }
  }

  private async relayOne(
    sessionId: string,
    messageId: string,
    content: NonNullable<Awaited<ReturnType<OpencodeClient['messages']>>[number]['content']>,
  ): Promise<void> {
    const channel = await this.resolveChannel();
    if (!channel) return;

    const texts = content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text!.trim())
      .filter(Boolean);

    for (const text of texts) {
      await this.postText(channel, text);
    }

    const shots = this.screenshotPaths(content);
    for (const shot of shots.slice(0, 3)) {
      if (!this.state.markShot(shot)) continue;
      this.state.save();
      try {
        const name = basename(shot);
        await channel.send({
          content: `screenshot · ${this.opts.label}`,
          files: [new AttachmentBuilder(shot, { name })],
          allowedMentions: { parse: [] },
        });
        this.log.info(this.opts.label, `relayed screenshot ${name} from ${messageId}`);
      } catch (err) {
        this.log.warn(
          this.opts.label,
          `screenshot relay failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private screenshotPaths(
    content: Array<{ type: string; state?: unknown; text?: string }>,
  ): string[] {
    const haystack = content
      .filter((part) => part.type === 'tool' || part.type === 'file')
      .map((part) => JSON.stringify(part))
      .join('\n');
    const found = new Set<string>();
    for (const match of haystack.matchAll(/(\/[^\s"'`()[\]{}]+\.png)/g)) {
      const absolute = resolve(match[1]);
      if (!absolute.startsWith(`${resolve(this.config.shotsDir)}/`)) continue;
      if (!existsSync(absolute)) continue;
      try {
        if (!statSync(absolute).isFile()) continue;
      } catch {
        continue;
      }
      found.add(absolute);
    }
    return [...found];
  }

  private async postText(channel: TextChannel, text: string): Promise<void> {
    if (this.config.dryRun) {
      this.log.info(
        this.opts.label,
        `[dry-run] would post ${text.length} chars: ${text.slice(0, 120).replace(/\n/g, ' ')}`,
      );
      return;
    }

    if (text.length > REPORT_AS_FILE_OVER) {
      const name = `${this.opts.label}-report-${Date.now()}.md`;
      await channel.send({
        content: `${this.opts.label} report (${text.length} chars)`,
        files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name })],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const body = this.opts.overseer
      ? text.replace(/@(operator|logy)\b/gi, `<@${this.config.ownerId}>`)
      : text;
    const mentions = this.opts.overseer
      ? { users: [this.config.ownerId] }
      : { parse: [] as never[] };
    for (const chunk of chunkText(body, MAX_CHUNK)) {
      await channel.send({ content: chunk, allowedMentions: mentions });
    }
  }

  /** Download a Discord attachment into the shared inbox so agents can `read` it. */
  private async saveAttachment(att: Attachment): Promise<string | null> {
    if (!att.size || att.size > MAX_ATTACHMENT_BYTES) return null;
    try {
      const res = await fetch(att.url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(INBOX_DIR, { recursive: true });
      const safe = (att.name || 'attachment')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+/, '')
        .slice(-80);
      const file = join(INBOX_DIR, `${Date.now()}-${safe}`);
      await writeFile(file, buf);
      void this.pruneInbox();
      return file;
    } catch {
      return null;
    }
  }

  /** Best-effort: keep the shared inbox from growing without bound. */
  private async pruneInbox(): Promise<void> {
    try {
      const { readdir, stat, unlink } = await import('node:fs/promises');
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const name of await readdir(INBOX_DIR)) {
        const path = join(INBOX_DIR, name);
        const info = await stat(path);
        if (info.isFile() && info.mtimeMs < cutoff) await unlink(path);
      }
    } catch {
      /* pruning is cosmetic */
    }
  }

  /** Discord -> agent. Queues instead of interrupting when the agent is busy. */
  async sendToAgent(text: string, author: string, attachments: Attachment[] = []): Promise<void> {
    const channel = await this.resolveChannel();
    if (!channel) return;

    const saved: string[] = [];
    for (const att of attachments) {
      const path = await this.saveAttachment(att);
      if (path) {
        saved.push(
          `${path} (${att.name ?? 'file'}${att.contentType ? `, ${att.contentType}` : ''})`,
        );
      }
    }
    const message = saved.length
      ? `${text ? `${text}\n\n` : ''}${saved.map((s) => `[attachment saved: ${s}]`).join('\n')}\n\n` +
        'Read the saved path with the read tool to see the picture/document.'
      : text;

    if (!this.sessionId) {
      if (this.config.dryRun) {
        this.log.info(this.opts.label, `[dry-run] no session; would reply to ${author}`);
        return;
      }
      await channel.send({
        content: 'No QA session in this slot yet — ask the manager to dispatch one.',
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (this.config.dryRun) {
      this.log.info(
        this.opts.label,
        `[dry-run] would prompt ${this.sessionId}: ${message.slice(0, 120)}`,
      );
      return;
    }

    try {
      const active = await this.opencode.activeSessions().catch(() => new Set<string>());
      // `steer` injects into the running turn so the agent sees it now; `queue`
      // waits for the turn to end, which reads as "the message went nowhere".
      const delivery = active.has(this.sessionId) ? 'steer' : undefined;
      await this.opencode.prompt(this.sessionId, message, delivery);
      this.log.info(
        this.opts.label,
        `${delivery === 'steer' ? 'steered' : 'sent'} message from ${author} (${message.length} chars, ${saved.length} attachment(s))`,
      );
    } catch (err) {
      this.log.error(
        this.opts.label,
        `prompt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await channel
        .send({
          content: `Could not deliver that message: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}`,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
    }
  }
}

export function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
