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
          onThought: (data) => send('thought', data),
          onThinking: (text) => send('thinking', { text }),
          onToken: (token) => send('token', { text: token }),
          onToolCall: (data) => send('tool_call', data),
          onToolResult: (data) => send('tool_result', data),
          onFlashcards: (data) => send('flashcards', data),
          onQuestion: (data) => send('question', data),
          onComplete: (summary) => {
            send('complete', { message: summary });
            controller.close();
          },
          onError: (message) => {
            send('error', { message });
            controller.close();
          },
        });
      } else {
        const isFlashcard = isFlashcardKeyword || context === 'flashcards';
        console.log(`${LOG_PREFIX} Routing: flashcardKeyword=${isFlashcardKeyword}, context=${context ?? 'none'}, hasFile=${!!file} → ${isFlashcard ? 'flashcard' : 'chat'}`);

        if (isFlashcard) {
          await aiCommandController.chat(text, file, conversationId, ctx, {
            onThink: (trace) => send('thinking', { text: trace }),
            onToken: () => {},
            onFlashcards: (data) => send('flashcards', data),
            onComplete: (summary) => {
              send('complete', { message: summary });
              controller.close();
            },
            onError: (message) => {
              send('error', { message });
              controller.close();
            },
          });
        } else {
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
