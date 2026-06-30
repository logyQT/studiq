'use client';

import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

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
  const handlersRef = useRef<Handler[]>([]);

  const _subKey = useMemo(
    () => builder.subscriptions.map((s) => `${s.table}:${s.event}:${s.filter}`).join(','),
    [builder.subscriptions],
  );

  useEffect(() => {
    handlersRef.current = builder.subscriptions.map((s) => s.handler);

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
    return () => {
      supabase.removeChannel(ch);
    };
  }, [builder.name, builder.subscriptions]);
}

export type { Handler, ListenOptions, RealtimeEvent };
export { channel, useRealtimeChannel };
