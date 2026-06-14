import { FlashcardGenRequestSchema } from '@/server/models/ai-command.model';
import { aiCommandService } from '@/server/services/ai-command.service';
import type { RequestContext } from '@/lib/request-context';

export interface FlashcardGenStreamCallbacks {
  onThink: (trace: string) => void;
  onFlashcards: (flashcards: unknown) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export class AiCommandController {
  async generateFlashcards(
    body: unknown,
    ctx: RequestContext,
    callbacks: FlashcardGenStreamCallbacks,
  ): Promise<void> {
    const parsed = FlashcardGenRequestSchema.safeParse(body);
    if (!parsed.success) {
      callbacks.onError('Invalid request body');
      return;
    }

    try {
      const result = await aiCommandService.generateFlashcards(parsed.data.text, ctx);

      for (const trace of result.thinkingTraces) {
        callbacks.onThink(trace);
      }

      callbacks.onFlashcards(result.flashcards);
      callbacks.onComplete();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error';
      callbacks.onError(msg);
    }
  }
}

export const aiCommandController = new AiCommandController();
