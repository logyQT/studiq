import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import type { GeneratedFlashcard } from '@/server/providers/LLMProvider';
import { flashcardGenerationService } from '@/server/services';

export interface GenerationStreamCallbacks {
  onFlashcards: (flashcards: GeneratedFlashcard[]) => void;
  onProgress: (processed: number, total: number) => void;
  onComplete: (suggestedDeckName: string) => void;
  onError: (message: string) => void;
}

/**
 * @deprecated Use AiCommandController.chat() with tool calling instead.
 * This controller is kept temporarily for the frompdf endpoint.
 */
export class FlashcardGenerationController {
  /**
   * @deprecated Use AiCommandService.generateFlashcards() with tool calling instead.
   */
  async generateFromPdf(
    body: { file: Buffer; filename: string; language: string },
    _ctx: RequestContext,
    callbacks: GenerationStreamCallbacks,
  ): Promise<void> {
    log.ai.warn(
      '[DEPRECATED] FlashcardGenerationController.generateFromPdf is deprecated. Use AiCommandService.generateFlashcards() instead.',
    );
    const { file, filename, language } = body;

    if (language !== 'en' && language !== 'pl') {
      callbacks.onError('Language must be "en" or "pl"');
      return;
    }

    if (!file || file.length === 0) {
      callbacks.onError('No file provided');
      return;
    }

    await flashcardGenerationService.generateStreaming(file, filename, language, callbacks);
  }
}

export const flashcardGenerationController = new FlashcardGenerationController();
