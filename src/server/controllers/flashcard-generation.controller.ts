import { flashcardGenerationService } from '@/server/services/flashcard-generation.service';
import type { RequestContext } from '@/lib/request-context';
import type { GeneratedFlashcard } from '@/server/providers/LLMProvider';

export interface GenerationStreamCallbacks {
  onFlashcards: (flashcards: GeneratedFlashcard[]) => void;
  onProgress: (processed: number, total: number) => void;
  onComplete: (suggestedDeckName: string) => void;
  onError: (message: string) => void;
}

export class FlashcardGenerationController {
  async generateFromPdf(
    body: { file: Buffer; filename: string; language: string },
    ctx: RequestContext,
    callbacks: GenerationStreamCallbacks,
  ): Promise<void> {
    const { file, filename, language } = body;

    if (language !== 'en' && language !== 'pl') {
      callbacks.onError('Language must be "en" or "pl"');
      return;
    }

    if (!file || file.length === 0) {
      callbacks.onError('No file provided');
      return;
    }

    await flashcardGenerationService.generateStreaming(
      file,
      filename,
      language,
      callbacks,
    );
  }
}

export const flashcardGenerationController = new FlashcardGenerationController();
