import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { chatController } from '@/server/controllers/ai-chat.controller';
import { aiCommandController } from '@/server/controllers/ai-command.controller';
import { aiAgentController } from '@/server/controllers/ai-agent.controller';
import { hasFlashcardKeyword } from '@/server/services/ai-utils';
import { FEATURE_FLAG_AGENTIC } from '@/lib/feature-flags';
import type { RequestContext } from '@/lib/request-context';
import type { UserRole } from '@/types';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const LOG_PREFIX = '[ChatRoute]';

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

  const text = (body as Record<string, unknown>)?.text;
  if (typeof text !== 'string') {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }
  const hasFile = !!(body as Record<string, unknown>)?.file;
  if (text.trim().length === 0 && !hasFile) {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        clearTimeout(streamTimeout);
        try { controller.close(); } catch { /* already closed */ }
      };
      const streamTimeout = setTimeout(() => {
        console.error(`${LOG_PREFIX} Stream timeout — closing after 5min`);
        safeClose();
      }, 300_000);

      const send = (event: string, data: unknown) => {
        console.log(`${LOG_PREFIX} SSE → event=${event}, data=${JSON.stringify(data).slice(0, 200)}`);
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      const isFlashcardKeyword = hasFlashcardKeyword(text);
      const context = (body as Record<string, unknown>)?.context as string | undefined;
      const file = (body as Record<string, unknown>)?.file as { data: string; mimeType: string } | undefined;
      const conversationId = (body as Record<string, unknown>)?.conversationId as string | undefined;

      if (FEATURE_FLAG_AGENTIC) {
        console.log(`${LOG_PREFIX} Routing: agent pipeline (FEATURE_FLAG_AGENTIC=true), conversationId=${conversationId ?? 'none'}`);

        await aiAgentController.process(text, file, conversationId, ctx, {
          onThought: (data: unknown) => send('thought', data),
          onThinking: (text: string) => send('thinking', { text }),
          onToken: (token: string) => send('token', { text: token }),
          onToolCall: (data: unknown) => send('tool_call', data),
          onToolResult: (data: unknown) => send('tool_result', data),
          onFlashcards: (data: unknown) => send('flashcards', data),
          onQuestion: (data: unknown) => send('question', data),
          onComplete: (summary: unknown) => {
            send('complete', { message: summary });
            safeClose();
          },
          onError: (message: string) => {
            send('error', { message });
            safeClose();
          },
        });
      } else {
        const isFlashcard = isFlashcardKeyword || context === 'flashcards';
        console.log(`${LOG_PREFIX} Routing: flashcardKeyword=${isFlashcardKeyword}, context=${context ?? 'none'}, hasFile=${!!file} → ${isFlashcard ? 'flashcard' : 'chat'}`);

        if (isFlashcard) {
          await aiCommandController.chat(text, file, conversationId, ctx, {
            onThink: (trace: string) => send('thinking', { text: trace }),
            onToken: () => {},
            onFlashcards: (data: unknown) => send('flashcards', data),
            onComplete: (summary: unknown) => {
              send('complete', { message: summary });
              safeClose();
            },
            onError: (message: string) => {
              send('error', { message });
              safeClose();
            },
          });
        } else {
          await chatController.chat(body, ctx, {
            onToken: (token: string) => send('token', { text: token }),
            onResult: (type: string, data: unknown) => send('result', { type, data }),
            onComplete: (summary: unknown) => {
              send('complete', { message: summary });
              safeClose();
            },
            onUsage: (usage: unknown) => send('usage', usage),
            onError: (message: string) => {
              send('error', { message });
              safeClose();
            },
          });
        }
      }
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
