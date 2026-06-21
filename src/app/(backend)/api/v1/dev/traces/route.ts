import { NextRequest } from 'next/server';
import { agentTraceService } from '@/server/services/agent-trace.service';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response(JSON.stringify({ error: 'Only available in development mode' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversationId');
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 2000);

  let events = conversationId
    ? agentTraceService.getByConversation(conversationId)
    : agentTraceService.getAll();

  events = events.slice(-limit);

  return new Response(JSON.stringify({ events, total: events.length }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
