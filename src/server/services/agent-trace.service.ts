export interface TraceEvent {
  id: string;
  timestamp: string;
  conversationId?: string;
  agentName: string;
  iteration?: number;
  eventType: 'step' | 'tool_call' | 'tool_result' | 'llm_request' | 'llm_response' | 'error' | 'retry';
  label: string;
  data: Record<string, unknown>;
}

interface SqliteDatabase {
  run(sql: string, params?: unknown[]): void;
}

export class AgentTraceService {
  private events: TraceEvent[] = [];
  private db: SqliteDatabase | null = null;

  constructor(persistPath?: string) {
    if (persistPath) {
      try {
        const { Database } = require('bun:sqlite') as { Database: new (path: string) => SqliteDatabase };
        this.db = new Database(persistPath);
        this.db.run(`CREATE TABLE IF NOT EXISTS traces (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          conversationId TEXT,
          agentName TEXT NOT NULL,
          iteration INTEGER,
          eventType TEXT NOT NULL,
          label TEXT NOT NULL,
          data TEXT
        )`);
        this.db.run('CREATE INDEX IF NOT EXISTS idx_traces_conversation ON traces(conversationId)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_traces_event_type ON traces(eventType)');
      } catch {
        this.db = null;
      }
    }
  }

  log(event: Omit<TraceEvent, 'id' | 'timestamp'>): TraceEvent {
    const full: TraceEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.events.push(full);
    if (this.db) {
      try {
        this.db.run(
          'INSERT INTO traces (id, timestamp, conversationId, agentName, iteration, eventType, label, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [full.id, full.timestamp, full.conversationId ?? null, full.agentName, full.iteration ?? null, full.eventType, full.label, JSON.stringify(full.data)],
        );
      } catch {
        // persist failure is non-critical
      }
    }
    return full;
  }

  getByConversation(conversationId: string): TraceEvent[] {
    return this.events.filter((e) => e.conversationId === conversationId);
  }

  getAll(): TraceEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    if (this.db) {
      try {
        this.db.run('DELETE FROM traces');
      } catch {
        // non-critical
      }
    }
  }
}

const GLOBAL_KEY = '__agentTraceService';

function getGlobalTraceService(): AgentTraceService {
  if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as AgentTraceService;
  }
  const service = new AgentTraceService(
    process.env.NODE_ENV === 'development' ? '.dev/traces.db' : undefined,
  );
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = service;
  }
  return service;
}

export const agentTraceService = getGlobalTraceService();
