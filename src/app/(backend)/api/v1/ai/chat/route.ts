import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { chatController } from '@/server/controllers/ai-chat.controller';
import { aiCommandController } from '@/server/controllers/ai-command.controller';
import type { RequestContext } from '@/lib/request-context';
import type { UserRole } from '@/types';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const LOG_PREFIX = '[ChatRoute]';

const FLASHCARD_KEYWORDS = [
  'flashcard', 'flash card', 'study card', 'index card', 'cue card',
  'flashcards', 'study cards', 'index cards',
  'fiszka', 'fiszki', 'fiszkę', 'fiszce', 'fiszek',
  'fiszkom', 'fiszkami', 'fiszkach',
  'notatka', 'notatki', 'notatkę', 'notatce', 'notatek',
  'notatkom', 'notatkami', 'notatkach',
  'karta', 'karty', 'kartę', 'karcie', 'kart',
  'kartom', 'kartami', 'kartach',
  'ściąga', 'ściągę', 'ściągi', 'ściąg', 'ściągą',
  'ściągom', 'ściągami', 'ściągach',
  'powtórka', 'powtórki', 'powtórkę', 'powtórce', 'powtórek',
  'powtórkom', 'powtórkami', 'powtorkach',
  'zapamiętaj', 'zapamiętać', 'zapamiętywanie', 'zapamiętywać',
  'przypominajka',
];

function hasFlashcardKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FLASHCARD_KEYWORDS.some((kw) => lower.includes(kw));
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
      const isFlashcard = isFlashcardKeyword || context === 'flashcards';
      console.log(`${LOG_PREFIX} Routing: flashcardKeyword=${isFlashcardKeyword}, context=${context ?? 'none'}, hasFile=${!!file}, conversationId=${conversationId ?? 'none'} → ${isFlashcard ? 'flashcard' : 'chat'}`);

      if (isFlashcard) {
        await aiCommandController.chat(text, file, conversationId, ctx, {
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
