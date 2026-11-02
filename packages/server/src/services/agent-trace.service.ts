import { mkdirSync } from 'node:fs';
import type { Database as BunSqliteDatabase, Statement as BunSqliteStatement } from 'bun:sqlite';
import { isRecord } from '@studiq/server/lib/record';
import { SERVER_SESSION_ID } from '@studiq/server/lib/server-session';

const TRACE_EVENT_TYPES = [
  'step',
  'tool_call',
  'tool_result',
  'llm_request',
  'llm_response',
  'error',
  'retry',
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

function isTraceEventType(value: unknown): value is TraceEventType {
  return typeof value === 'string' && (TRACE_EVENT_TYPES as readonly string[]).includes(value);
}

/** SQLite hands back loose values; text columns are read as text. */
function asText(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

/** A JSON column that must contain an object (arrays/scalars are treated as empty). */
function asDataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) ? value : {};
}

export interface TraceEvent {
  id: string;
  timestamp: string;
  serverSessionId: string;
  conversationId?: string;
  agentName: string;
  iteration?: number;
  eventType: TraceEventType;
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

/** The slice of `bun:sqlite` this tracer touches, typed by bun's own definitions. */
interface SqliteDatabase {
  run: BunSqliteDatabase['run'];
  query(sql: string): Pick<BunSqliteStatement, 'all' | 'get'>;
}

export class AgentTraceService {
  private db: SqliteDatabase | null = null;
  private dbInit: Promise<SqliteDatabase | null> | null = null;

  private async getDb(): Promise<SqliteDatabase | null> {
    if (this.db) return this.db;
    if (this.dbInit) return this.dbInit;
    this.dbInit = this.initDb();
    return this.dbInit;
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
      this.db = db;
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
      const [countRow] = db.query(`SELECT COUNT(*) as cnt FROM traces ${where}`).all(params);
      const total = isRecord(countRow) && typeof countRow.cnt === 'number' ? countRow.cnt : 0;

      const rows = db
        .query(`SELECT * FROM traces ${where} ORDER BY timestamp ${order} LIMIT ? OFFSET ?`)
        .all([...params, limit, offset]);

      const events: TraceEvent[] = rows.flatMap((row) => {
        if (!isRecord(row)) return [];
        return [
          {
            id: asText(row.id),
            timestamp: asText(row.timestamp),
            serverSessionId: asText(row.serverSessionId),
            conversationId: typeof row.conversationId === 'string' ? row.conversationId : undefined,
            agentName: asText(row.agentName),
            iteration: row.iteration != null ? Number(row.iteration) : undefined,
            eventType: isTraceEventType(row.eventType) ? row.eventType : 'step',
            label: asText(row.label),
            data:
              typeof row.data === 'string'
                ? asDataRecord(JSON.parse(row.data))
                : asDataRecord(row.data),
          },
        ];
      });

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
  // Kept on `globalThis` so a dev-mode module reload reuses the same tracer.
  const existing: unknown = Reflect.get(globalThis, GLOBAL_KEY);
  if (existing instanceof AgentTraceService) return existing;

  const service = new AgentTraceService();
  Reflect.set(globalThis, GLOBAL_KEY, service);
  return service;
}

export const agentTraceService = getGlobalTraceService();
