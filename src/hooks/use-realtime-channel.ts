import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface ListenOptions {
  event?: RealtimeEvent;
  filter?: string;
}

type Handler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;

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
  const handlersRef = useRef(builder.subscriptions.map((s) => s.handler));
  handlersRef.current = builder.subscriptions.map((s) => s.handler);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel(builder.name);

    for (let i = 0; i < builder.subscriptions.length; i++) {
      const sub = builder.subscriptions[i];
      const idx = i;
      ch.on(
        'postgres_changes',
        {
          event: sub.event,
          schema: 'public',
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        },
        (payload) => {
          handlersRef.current[idx](payload);
        },
      );
    }

    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder.name, JSON.stringify(builder.subscriptions.map((s) => ({ table: s.table, event: s.event, filter: s.filter })))]);
}

export { channel, useRealtimeChannel };
export type { RealtimeEvent, ListenOptions, Handler };
