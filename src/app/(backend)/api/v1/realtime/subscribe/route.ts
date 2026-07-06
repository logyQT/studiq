import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { withAuth } from '@/lib/with-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const channelName = searchParams.get('channel') || `sse-${ctx.traceId}`;
    const tables = searchParams.getAll('table');
    const events = searchParams.getAll('event');
    const filters = searchParams.getAll('filter');

    if (tables.length === 0) {
      return NextResponse.json(
        { success: false, statusCode: 422, error: 'UNPROCESSABLE_ENTITY' },
        { status: 422 },
      );
    }

    const supabase = createServiceClient();

    const stream = new ReadableStream({
      start(controller) {
        const channel = supabase.channel(channelName);

        for (let i = 0; i < tables.length; i++) {
          const table = tables[i];
          const event = (events[i] || '*') as 'INSERT' | 'UPDATE' | 'DELETE' | '*';
          const filter = filters[i];

          channel.on(
            'postgres_changes',
            {
              event,
              schema: 'public',
              table,
              ...(filter ? { filter } : {}),
            },
            (payload) => {
              const data = JSON.stringify({ index: i, payload });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
          );
        }

        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            controller.enqueue(new TextEncoder().encode('event: subscribed\ndata: {}\n\n'));
          }
        });

        const heartbeat = setInterval(() => {
          controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
        }, 30000);

        req.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          supabase.removeChannel(channel);
        });
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });
}
