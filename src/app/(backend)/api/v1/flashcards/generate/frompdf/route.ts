import type { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import { toNextResponse } from '@/lib/http-utils';
import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { flashcardGenerationController } from '@/server/controllers';
import type { GeneratedFlashcard } from '@/server/providers/LLMProvider';
import type { UserRole } from '@/types';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  log.api.warn(
    '[DEPRECATED] POST /api/v1/flashcards/generate/frompdf is deprecated. Use POST /api/v1/ai/chat with context="flashcards" instead.',
  );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const role = user.app_metadata?.role as UserRole;
  const ctx: RequestContext = {
    traceId: crypto.randomUUID(),
    userId: user.id,
    activeOrgId: req.cookies.get('active_org_id')?.value ?? null,
    role,
    url: req.url,
    method: req.method,
  };

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }

  const fileField = formData.get('file') as File | null;
  const language = (formData.get('language') as string | null) || 'en';

  if (!fileField) {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }

  if (!fileField.name.toLowerCase().endsWith('.pdf')) {
    return toNextResponse({ success: false, statusCode: 422, error: 'UNPROCESSABLE_ENTITY' });
  }

  log.api.info(
    `Starting generation: file=${fileField.name}, size=${fileField.size}, language=${language}`,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        const buffer = Buffer.from(await fileField.arrayBuffer());

        await flashcardGenerationController.generateFromPdf(
          { file: buffer, filename: fileField.name, language },
          ctx,
          {
            onFlashcards: (flashcards: GeneratedFlashcard[]) => {
              send('flashcards', flashcards);
            },
            onProgress: (processed: number, total: number) => {
              send('progress', { processedChunks: processed, totalChunks: total });
            },
            onComplete: (suggestedDeckName: string) => {
              send('complete', { suggestedDeckName });
              controller.close();
            },
            onError: (message: string) => {
              send('error', { message });
              controller.close();
            },
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        const errorId = crypto.randomUUID?.() ?? Date.now().toString(36);

        log.api.error(`[errorId=${errorId}] Unhandled error`, { metadata: { error } });

        if (error instanceof AppError) {
          send('error', { message });
        } else {
          send('error', { message: `Internal server error (ref: ${errorId})` });
        }
        controller.close();
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
