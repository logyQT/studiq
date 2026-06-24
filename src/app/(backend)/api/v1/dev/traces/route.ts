import { NextRequest } from 'next/server';
import { agentTraceService, type TraceFilters } from '@/server/services/agent-trace.service';
import { SERVER_SESSION_ID } from '@/lib/server-session';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response(JSON.stringify({ error: 'Only available in development mode' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(req.url);

  const rawSession = searchParams.get('serverSessionId') || 'current';
  const serverSessionId =
    rawSession === 'current' ? SERVER_SESSION_ID : rawSession === 'all' ? undefined : rawSession;

  const filters: TraceFilters = {
    serverSessionId,
    conversationId: searchParams.get('conversationId') || undefined,
    eventType: searchParams.get('eventType') || undefined,
    label: searchParams.get('label') || undefined,
    agentName: searchParams.get('agentName') || undefined,
    limit: Math.min(parseInt(searchParams.get('limit') || '100', 10), 2000),
    offset: parseInt(searchParams.get('offset') || '0', 10),
    sort: (searchParams.get('sort') as 'asc' | 'desc') || 'desc',
  };

  const { events, total } = agentTraceService.getByFilters(filters);
  const dbStatus = agentTraceService.getStatus();

  return new Response(
    JSON.stringify(
      { events, total, serverSessionId: SERVER_SESSION_ID, dbStatus, filters },
      null,
      2,
    ),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
