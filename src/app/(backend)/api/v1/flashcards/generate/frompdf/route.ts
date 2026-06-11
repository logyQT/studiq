import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { AppError } from '@/lib/errors';
import { flashcardGenerationController } from '@/server/controllers';
import type { RequestContext } from '@/lib/request-context';
import type { UserRole } from '@/types';
import type { GeneratedFlashcard } from '@/server/providers/LLMProvider';

const LOG_PREFIX = '[API /flashcards/generate/frompdf]';

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

  console.log(`${LOG_PREFIX} Starting generation: file=${fileField.name}, size=${fileField.size}, language=${language}`);

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

        console.error(`${LOG_PREFIX} [errorId=${errorId}] Unhandled error:`, error);

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
      'Connection': 'keep-alive',
    },
  });
}
