import { FlashcardGenRequestSchema } from '@/server/models/ai-command.model';
import { aiCommandService } from '@/server/services/ai-command.service';
import type { RequestContext } from '@/lib/request-context';

const LOG_PREFIX = '[AiCommandController]';

export interface FlashcardGenStreamCallbacks {
  onThink: (trace: string) => void;
  onFlashcards: (data: { deckName: string; flashcards: unknown[] }) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export interface FlashcardChatStreamCallbacks {
  onThink: (trace: string) => void;
  onToken: (text: string) => void;
  onFlashcards: (data: { deckName: string; flashcards: unknown[] }) => void;
  onComplete: (summary: string) => void;
  onError: (message: string) => void;
}

export class AiCommandController {
  async generateFlashcards(
    body: unknown,
    ctx: RequestContext,
    callbacks: FlashcardGenStreamCallbacks,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} generateFlashcards called`);
    const parsed = FlashcardGenRequestSchema.safeParse(body);
    if (!parsed.success) {
      console.error(`${LOG_PREFIX} Invalid request body:`, parsed.error.issues);
      callbacks.onError('Invalid request body');
      return;
    }

    try {
      const result = await aiCommandService.generateFlashcards(parsed.data.text, undefined, undefined, ctx, {
        onThink: callbacks.onThink,
      });
      console.log(`${LOG_PREFIX} emit ${result.flashcards.length} flashcards`);
      callbacks.onFlashcards({ deckName: result.deckName, flashcards: result.flashcards });
      callbacks.onComplete();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error';
      console.error(`${LOG_PREFIX} Error:`, msg);
      callbacks.onError(msg);
    }
  }

  async chat(
    text: string,
    file: { data: string; mimeType: string } | undefined,
    conversationId: string | undefined,
    ctx: RequestContext,
    callbacks: FlashcardChatStreamCallbacks,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} chat called, text="${text.slice(0, 80)}", hasFile=${!!file}, conversationId=${conversationId ?? 'none'}`);
    try {
      const result = await aiCommandService.chat(text, file, conversationId, ctx, {
        onThink: callbacks.onThink,
      });
      console.log(`${LOG_PREFIX} result type=${result.type}`);

      if (result.type === 'flashcards') {
        console.log(`${LOG_PREFIX} emit ${result.flashcards.length} flashcards, deckName="${result.deckName}"`);
        callbacks.onFlashcards({ deckName: result.deckName, flashcards: result.flashcards });
        callbacks.onComplete('');
      } else {
        callbacks.onComplete(result.content);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error';
      console.error(`${LOG_PREFIX} Error:`, msg);
      callbacks.onError(msg);
    }
  }
}

export const aiCommandController = new AiCommandController();
