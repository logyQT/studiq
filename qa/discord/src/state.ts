import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface RuntimeState {
  version: 1;
  managerSessionId?: string;
  dashboardMessageId?: string;
  /** sessionID -> message IDs already relayed */
  seen: Record<string, string[]>;
  /** screenshot paths already uploaded */
  seenShots: string[];
  lastDashboardEdit?: number;
  /** channelId -> last presence signature, for debouncing */
  presences: Record<string, string>;
}

const MAX_SEEN = 400;
const MAX_SHOTS = 500;

function empty(): RuntimeState {
  return { version: 1, seen: {}, seenShots: [], presences: {} };
}

export class StateStore {
  private data: RuntimeState;

  constructor(private path: string) {
    this.data = empty();
    if (!existsSync(path)) return;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RuntimeState>;
      this.data = {
        ...empty(),
        ...parsed,
        version: 1,
        seen: parsed.seen ?? {},
        seenShots: parsed.seenShots ?? [],
        presences: parsed.presences ?? {},
      };
    } catch {
      // A corrupt state file must not stop the bots; start clean.
      this.data = empty();
    }
  }

  get managerSessionId(): string | undefined {
    return this.data.managerSessionId;
  }
  set managerSessionId(id: string | undefined) {
    this.data.managerSessionId = id;
    this.save();
  }

  get dashboardMessageId(): string | undefined {
    return this.data.dashboardMessageId;
  }
  set dashboardMessageId(id: string | undefined) {
    this.data.dashboardMessageId = id;
    this.save();
  }

  get lastDashboardEdit(): number {
    return this.data.lastDashboardEdit ?? 0;
  }
  set lastDashboardEdit(ts: number) {
    this.data.lastDashboardEdit = ts;
  }

  seen(sessionId: string, messageId: string): boolean {
    return this.data.seen[sessionId]?.includes(messageId) ?? false;
  }

  markSeen(sessionId: string, messageIds: string[]): void {
    const list = this.data.seen[sessionId] ?? [];
    for (const id of messageIds) if (!list.includes(id)) list.push(id);
    this.data.seen[sessionId] = list.slice(-MAX_SEEN);
  }

  markShot(path: string): boolean {
    if (this.data.seenShots.includes(path)) return false;
    this.data.seenShots.push(path);
    this.data.seenShots = this.data.seenShots.slice(-MAX_SHOTS);
    return true;
  }

  presence(channelId: string): string | undefined {
    return this.data.presences[channelId];
  }

  setPresence(channelId: string, signature: string, persist = true): void {
    this.data.presences[channelId] = signature;
    if (persist) this.save();
  }

  save(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
