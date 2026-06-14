import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { chatController } from '@/server/controllers/ai-chat.controller';
import type { RequestContext } from '@/lib/request-context';
import type { UserRole } from '@/types';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const ctx: RequestContext = {
    userId: user.id,
    universityId: user.app_metadata?.university_id ?? null,
    role: user.app_metadata?.role as UserRole,
    url: req.url,
    method: req.method,
  };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      await chatController.chat(body, ctx, {
        onToken: (token) => send('token', { text: token }),
        onResult: (type, data) => send('result', { type, data }),
        onComplete: (summary) => {
          send('complete', { message: summary });
          controller.close();
        },
        onUsage: (usage) => send('usage', usage),
        onError: (message) => {
          send('error', { message });
          controller.close();
        },
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
