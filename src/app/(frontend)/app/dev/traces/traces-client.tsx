'use client';

import { useState, useEffect, useCallback } from 'react';

interface TraceEvent {
  id: string;
  timestamp: string;
  serverSessionId: string;
  conversationId?: string;
  agentName: string;
  iteration?: number;
  eventType: string;
  label: string;
  data: Record<string, unknown>;
}

interface Filters {
  serverSessionId: string;
  conversationId: string;
  eventType: string;
  label: string;
  agentName: string;
  limit: number;
  offset: number;
}

const EVENT_COLORS: Record<string, string> = {
  step: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  tool_call: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  tool_result: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  llm_request: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  llm_response: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  retry: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
};

export default function TracesClient() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [sessionId, setSessionId] = useState<string>('');
  const [dbStatus, setDbStatus] = useState<string>('');
  const [filters, setFilters] = useState<Filters>({
    serverSessionId: 'current',
    conversationId: '',
    eventType: '',
    label: '',
    agentName: '',
    limit: 100,
    offset: 0,
  });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('serverSessionId', filters.serverSessionId);
      if (filters.conversationId) params.set('conversationId', filters.conversationId);
      if (filters.eventType) params.set('eventType', filters.eventType);
      if (filters.label) params.set('label', filters.label);
      if (filters.agentName) params.set('agentName', filters.agentName);
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));

      const res = await fetch(`/api/v1/dev/traces?${params}`);
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
      setSessionId(data.serverSessionId || '');
      setDbStatus(data.dbStatus || 'unknown');
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTraces();
  }, [fetchTraces]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchTraces, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchTraces]);

  const updateFilter = (key: keyof Filters, value: string | number) => {
    setFilters((prev) => ({ ...prev, [key]: value, offset: 0 }));
  };

  const totalPages = Math.ceil(total / filters.limit);
  const currentPage = Math.floor(filters.offset / filters.limit) + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Traces</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {sessionId}
            <span
              className={`ml-2 inline-block w-2 h-2 rounded-full ${
                dbStatus === 'ok'
                  ? 'bg-green-500'
                  : dbStatus === 'not_available'
                    ? 'bg-red-500'
                    : 'bg-gray-400'
              }`}
              title={`DB: ${dbStatus}`}
            />
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto
          </label>
          <button
            onClick={fetchTraces}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? '...' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-0.5">Session</label>
          <select
            value={filters.serverSessionId}
            onChange={(e) => updateFilter('serverSessionId', e.target.value)}
            className="w-full h-8 text-xs rounded-md border bg-background px-2"
          >
            <option value="current">Current</option>
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-0.5">Conversation</label>
          <input
            value={filters.conversationId}
            onChange={(e) => updateFilter('conversationId', e.target.value)}
            placeholder="Filter by conversation..."
            className="w-full h-8 text-xs rounded-md border bg-background px-2"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-0.5">Type</label>
          <select
            value={filters.eventType}
            onChange={(e) => updateFilter('eventType', e.target.value)}
            className="w-full h-8 text-xs rounded-md border bg-background px-2"
          >
            <option value="">All</option>
            <option value="step">step</option>
            <option value="tool_call">tool_call</option>
            <option value="tool_result">tool_result</option>
            <option value="llm_request">llm_request</option>
            <option value="llm_response">llm_response</option>
            <option value="error">error</option>
            <option value="retry">retry</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-0.5">Label</label>
          <input
            value={filters.label}
            onChange={(e) => updateFilter('label', e.target.value)}
            placeholder="Search label..."
            className="w-full h-8 text-xs rounded-md border bg-background px-2"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-0.5">Agent</label>
          <input
            value={filters.agentName}
            onChange={(e) => updateFilter('agentName', e.target.value)}
            placeholder="Filter by agent..."
            className="w-full h-8 text-xs rounded-md border bg-background px-2"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-0.5">Limit</label>
          <input
            type="number"
            min={10}
            max={2000}
            value={filters.limit}
            onChange={(e) => updateFilter('limit', parseInt(e.target.value) || 100)}
            className="w-full h-8 text-xs rounded-md border bg-background px-2"
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {events.length > 0 ? filters.offset + 1 : 0}-{filters.offset + events.length} of{' '}
        {total}
      </div>

      <div className="space-y-1">
        {events.map((event) => (
          <div key={event.id}>
            <button
              onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border bg-background/50 hover:bg-muted/50 transition-colors text-left"
            >
              <span className="font-mono text-muted-foreground shrink-0 w-16 text-right">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${EVENT_COLORS[event.eventType] || 'bg-gray-100 text-gray-800'}`}
              >
                {event.eventType}
              </span>
              <span className="flex-1 truncate">{event.label}</span>
              {event.conversationId && (
                <span className="font-mono text-muted-foreground/60 shrink-0 text-[10px]">
                  {event.conversationId.slice(0, 8)}...
                </span>
              )}
              <span className="text-muted-foreground/40">
                {expandedId === event.id ? '▾' : '▸'}
              </span>
            </button>
            {expandedId === event.id && (
              <pre className="ml-4 mt-0.5 p-2 text-[10px] rounded-md bg-muted/30 border overflow-x-auto max-h-48">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {events.length === 0 && !loading && (
          <div className="text-center text-sm text-muted-foreground py-8">No traces found.</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <button
            disabled={filters.offset === 0}
            onClick={() =>
              setFilters((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))
            }
            className="px-3 py-1 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={filters.offset + filters.limit >= total}
            onClick={() => setFilters((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
            className="px-3 py-1 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
