import { log } from '@/lib/logger';
import { getModelsConfig } from '@/server/config/models.config';
import type { GeneratedFlashcard } from '@/server/providers/LLMProvider';
import { getProvider } from '@/server/providers/providerRegistry';
import { pdfService } from './pdf.service';

export interface GenerationCallbacks {
  onFlashcards: (flashcards: GeneratedFlashcard[]) => void;
  onProgress: (processed: number, total: number) => void;
  onComplete: (suggestedDeckName: string) => void;
  onError: (message: string) => void;
}

/**
 * @deprecated Use AiCommandService.generateFlashcards() with tool calling instead.
 * This service is kept temporarily for large PDF chunking support.
 */
export class FlashcardGenerationService {
  /**
   * @deprecated Use AiCommandService.generateFlashcards() with tool calling instead.
   */
  async generateStreaming(
    fileBuffer: Buffer,
    filename: string,
    language: string,
    callbacks: GenerationCallbacks,
  ): Promise<void> {
    log.ai.warn(
      '[DEPRECATED] FlashcardGenerationService.generateStreaming is deprecated. Use AiCommandService.generateFlashcards() instead.',
    );
    const config = getModelsConfig();
    log.ai.info('Config', {
      metadata: { provider: config.provider, model: config.modelName, baseUrl: config.baseUrl },
    });

    let provider;
    try {
      provider = getProvider(config);
    } catch (error) {
      log.ai.error('Failed to initialize provider', { metadata: { error } });
      callbacks.onError(
        error instanceof Error ? error.message : 'Failed to initialize LLM provider',
      );
      return;
    }

    let text: string;
    try {
      text = await pdfService.extractText(fileBuffer);
    } catch (error) {
      log.pdf.error('PDF extraction failed', { metadata: { error } });
      callbacks.onError('Failed to extract text from PDF');
      return;
    }

    if (!text) {
      callbacks.onError('No text could be extracted from the PDF');
      return;
    }

    const chunks = pdfService.chunkText(text);
    const totalChunks = chunks.length;

    const allFlashcards: GeneratedFlashcard[] = [];
    const topicCounts = new Map<string, number>();

    for (let i = 0; i < chunks.length; i++) {
      callbacks.onProgress(i + 1, totalChunks);

      try {
        const chunkCards = await provider.generateFlashcardsFromChunk(chunks[i], language);
        // TODO: retry chunk on parse failure (up to N times), emit SSE 'retry' event so frontend can show "LLM struggled with chunk X, retrying..." — see todowrite item

        for (const card of chunkCards) {
          allFlashcards.push(card);
          const topic = card.suggestedTopic || 'General';
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }

        callbacks.onFlashcards(chunkCards);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        log.ai.error(`Chunk ${i + 1}/${totalChunks} failed`, { metadata: { error } });
        callbacks.onError(`Chunk ${i + 1}/${totalChunks} failed: ${msg}`);
        return;
      }
    }

    const suggestedDeckName = pdfService.suggestDeckName(filename, topicCounts);
    callbacks.onComplete(suggestedDeckName);
  }
}

export const flashcardGenerationService = new FlashcardGenerationService();
