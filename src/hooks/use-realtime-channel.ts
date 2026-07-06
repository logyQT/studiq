'use client';

import { useEffect, useMemo, useRef } from 'react';

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface ListenOptions {
  event?: RealtimeEvent;
  filter?: string;
}

interface PostgresChangesPayload {
  event_type: 'INSERT' | 'UPDATE' | 'DELETE';
  schema: string;
  table: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  commit_timestamp: string;
  errors: string[] | null;
}

type Handler = (payload: PostgresChangesPayload) => void;

class RealtimeBuilder {
  readonly name: string;
  readonly subscriptions: Array<{
    table: string;
    event: RealtimeEvent;
    filter?: string;
    handler: Handler;
  }> = [];

  constructor(name: string) {
    this.name = name;
  }

  listen(table: string, handler: Handler, opts?: ListenOptions): this {
    this.subscriptions.push({
      table,
      handler,
      event: opts?.event ?? '*',
      filter: opts?.filter,
    });
    return this;
  }
}

function channel(name: string): RealtimeBuilder {
  return new RealtimeBuilder(name);
}

function useRealtimeChannel(builder: RealtimeBuilder): void {
  const handlersRef = useRef<Handler[]>([]);

  const { tables, events, filters } = useMemo(() => {
    const tables: string[] = [];
    const events: string[] = [];
    const filters: (string | undefined)[] = [];
    for (const s of builder.subscriptions) {
      tables.push(s.table);
      events.push(s.event);
      filters.push(s.filter);
    }
    return { tables, events, filters };
  }, [builder.subscriptions]);

  handlersRef.current = builder.subscriptions.map((s) => s.handler);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('channel', builder.name);
    for (let i = 0; i < tables.length; i++) {
      params.append('table', tables[i]);
      params.append('event', events[i]);
      if (filters[i]) params.append('filter', filters[i]!);
    }

    const eventSource = new EventSource(`/api/v1/realtime/subscribe?${params}`);

    eventSource.onmessage = (event) => {
      try {
        const { index, payload } = JSON.parse(event.data);
        if (typeof index === 'number' && handlersRef.current[index]) {
          handlersRef.current[index](payload);
        }
      } catch {
        // Ignore malformed events
      }
    };

    return () => {
      eventSource.close();
    };
  }, [builder.name, tables, events, filters]);
}

export type { Handler, ListenOptions, RealtimeEvent };
export { channel, useRealtimeChannel };
