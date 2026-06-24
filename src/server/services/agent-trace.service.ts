import { SERVER_SESSION_ID } from '@/lib/server-session';
import { mkdirSync } from 'fs';

export interface TraceEvent {
  id: string;
  timestamp: string;
  serverSessionId: string;
  conversationId?: string;
  agentName: string;
  iteration?: number;
  eventType:
    | 'step'
    | 'tool_call'
    | 'tool_result'
    | 'llm_request'
    | 'llm_response'
    | 'error'
    | 'retry';
  label: string;
  data: Record<string, unknown>;
}

export interface TraceFilters {
  serverSessionId?: string;
  conversationId?: string;
  eventType?: string;
  label?: string;
  agentName?: string;
  limit?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
}

interface SqliteDatabase {
  run(sql: string, params?: unknown[]): void;
  query(sql: string): {
    all(params?: unknown[]): Array<Record<string, unknown>>;
    get(params?: unknown[]): Record<string, unknown> | undefined;
  };
}

export class AgentTraceService {
  private db: SqliteDatabase | null = null;
  private _dbInit: Promise<SqliteDatabase | null> | null = null;

  private async getDb(): Promise<SqliteDatabase | null> {
    if (this.db) return this.db;
    if (this._dbInit) return this._dbInit;
    this._dbInit = this.initDb();
    return this._dbInit;
  }

  private async initDb(): Promise<SqliteDatabase | null> {
    try {
      mkdirSync('.dev', { recursive: true });
      const { Database } = await import('bun:sqlite');
      const db = new Database('.dev/traces.db');
      db.run(`CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        serverSessionId TEXT NOT NULL DEFAULT '',
        conversationId TEXT,
        agentName TEXT NOT NULL,
        iteration INTEGER,
        eventType TEXT NOT NULL,
        label TEXT NOT NULL,
        data TEXT
      )`);
      db.run('CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(serverSessionId)');
      db.run('CREATE INDEX IF NOT EXISTS idx_traces_conversation ON traces(conversationId)');
      db.run('CREATE INDEX IF NOT EXISTS idx_traces_event_type ON traces(eventType)');
      this.db = db as unknown as SqliteDatabase;
      return this.db;
    } catch {
      return null;
    }
  }

  async log(
    event: Omit<TraceEvent, 'id' | 'timestamp' | 'serverSessionId'>,
  ): Promise<TraceEvent | null> {
    const full: TraceEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      serverSessionId: SERVER_SESSION_ID,
      ...event,
    };

    const db = await this.getDb();
    if (!db) return null;

    try {
      db.run(
        'INSERT INTO traces (id, timestamp, serverSessionId, conversationId, agentName, iteration, eventType, label, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          full.id,
          full.timestamp,
          full.serverSessionId,
          full.conversationId ?? null,
          full.agentName,
          full.iteration ?? null,
          full.eventType,
          full.label,
          JSON.stringify(full.data),
        ],
      );
    } catch {
      return null;
    }

    return full;
  }

  getByFilters(filters: TraceFilters): { events: TraceEvent[]; total: number } {
    const db = this.db;
    if (!db) return { events: [], total: 0 };

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.serverSessionId && filters.serverSessionId !== 'all') {
      conditions.push('serverSessionId = ?');
      params.push(filters.serverSessionId);
    }
    if (filters.conversationId) {
      conditions.push('conversationId = ?');
      params.push(filters.conversationId);
    }
    if (filters.eventType) {
      conditions.push('eventType = ?');
      params.push(filters.eventType);
    }
    if (filters.label) {
      conditions.push('label LIKE ?');
      params.push(`%${filters.label}%`);
    }
    if (filters.agentName) {
      conditions.push('agentName = ?');
      params.push(filters.agentName);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = filters.sort === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(filters.limit || 100, 2000);
    const offset = filters.offset || 0;

    try {
      const countRow = db.query(`SELECT COUNT(*) as cnt FROM traces ${where}`).all(params);
      const total = (countRow[0] as { cnt?: number })?.cnt ?? 0;

      const rows = db
        .query(`SELECT * FROM traces ${where} ORDER BY timestamp ${order} LIMIT ? OFFSET ?`)
        .all([...params, limit, offset]);

      const events: TraceEvent[] = rows.map((r) => ({
        id: String(r.id),
        timestamp: String(r.timestamp),
        serverSessionId: String(r.serverSessionId),
        conversationId: r.conversationId != null ? String(r.conversationId) : undefined,
        agentName: String(r.agentName),
        iteration: r.iteration != null ? Number(r.iteration) : undefined,
        eventType: r.eventType as TraceEvent['eventType'],
        label: String(r.label),
        data: typeof r.data === 'string' ? JSON.parse(r.data) : (r.data ?? {}),
      }));

      return { events, total };
    } catch {
      return { events: [], total: 0 };
    }
  }

  getByConversation(conversationId: string): TraceEvent[] {
    return this.getByFilters({ conversationId, limit: 2000 }).events;
  }

  getAll(serverSessionId?: string): TraceEvent[] {
    return this.getByFilters({ serverSessionId: serverSessionId || 'all', limit: 2000 }).events;
  }

  async clear(): Promise<void> {
    const db = await this.getDb();
    if (!db) return;
    try {
      db.run('DELETE FROM traces');
    } catch {
      // non-critical
    }
  }

  getStatus(): 'ok' | 'not_available' {
    return this.db ? 'ok' : 'not_available';
  }
}

const GLOBAL_KEY = '__agentTraceService';

function getGlobalTraceService(): AgentTraceService {
  if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as AgentTraceService;
  }
  const service = new AgentTraceService();
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = service;
  }
  return service;
}

export const agentTraceService = getGlobalTraceService();
